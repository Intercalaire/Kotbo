/**
 * Panneau de l'hôtel des ventes (`/market`), sur le modèle du hub `/rpg`.
 *
 * Tout passe par un seul message : l'étal (boutique à prix fixe ou enchères), la fiche d'une
 * annonce, ses propres annonces et la mise en vente. Il remplace les six sous-commandes qui
 * demandaient de retrouver un objet par autocomplétion puis d'en retaper le prix.
 *
 * Les `customId` suivent la forme `mkt:<action>:<propriétaire>:<arguments>` et restent sous
 * les 100 caractères de Discord : un identifiant d'objet et un identifiant d'exemplaire en
 * prennent déjà cinquante.
 */

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  ModalBuilder,
  SectionBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  StringSelectMenuBuilder,
  TextDisplayBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type Client,
  type Guild,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
} from 'discord.js';
import prisma from '../../utils/db.js';
import { truncate } from '../../utils/embeds.js';
import { getEffectiveLocale } from '../../utils/i18n.js';
import * as m from '../../lib/paraglide/messages.js';
import { isModuleEnabled } from '../core/moduleGate.js';
import { getOrCreateEconomyConfig } from '../features/economyService.js';
import { formatEnchant, type EnchantStack } from '../features/rpg/rpgEnchantments.js';
import { icon, rarityIcon, RPG_COLORS } from '../features/rpg/rpgIcons.js';
import {
  BAG_CATEGORIES,
  bagCategoryLabel,
  ensureOwner,
  itemStatLine,
  optionDescription,
  optionEmoji,
  replyPanelError,
  respond,
  shopCategoryLabel,
  withNote,
  type BagCategory,
  type Locale,
  type PanelRow,
  type PanelView,
} from '../features/rpgPanelService.js';
import {
  buyListing,
  cancelListing,
  createListing,
  getMarketListing,
  getMarketListings,
  getMarketSellableCopies,
  getRecentSales,
  getSuggestedPrice,
  LISTING_DURATION_RANGE,
  placeBid,
  type MarketListing,
} from './marketplaceService.js';
import { parsePositiveInt } from './marketplacePolicy.js';

const LISTINGS_PER_PAGE = 5;
const SELLABLE_PER_PAGE = 25;
const DEFAULT_DURATION_HOURS = 24;

type MarketTab = 'shop' | 'auction' | 'mine';
const MARKET_TABS: MarketTab[] = ['shop', 'auction', 'mine'];

type MarketState = { tab: MarketTab; category: BagCategory; page: number };

const DEFAULT_STATE: MarketState = { tab: 'shop', category: 'all', page: 0 };

/** `rest` porte l'onglet, la famille d'objet puis la page. */
function parseMarketState(rest: string[]): MarketState {
  const tab = MARKET_TABS.includes(rest[0] as MarketTab) ? (rest[0] as MarketTab) : 'shop';
  const category = BAG_CATEGORIES.includes(rest[1] as BagCategory) ? (rest[1] as BagCategory) : 'all';
  const page = Math.max(0, Number.parseInt(rest[2] ?? '0', 10) || 0);
  return { tab, category, page };
}

function stateSuffix(state: MarketState): string {
  return `${state.tab}:${state.category}:${state.page}`;
}

function viewId(ownerId: string, state: MarketState): string {
  return `mkt:view:${ownerId}:${stateSuffix(state)}`;
}

type MarketRoute = { action: string; ownerId: string; rest: string[] };

function parseMarketRoute(customId: string): MarketRoute | null {
  if (!customId.startsWith('mkt:')) return null;
  const [, action, ownerId, ...rest] = customId.split(':');
  if (!action || !ownerId) return null;
  return { action, ownerId, rest };
}

function copyName(item: { emoji: string; name: string } | null, upgrade: number): string {
  if (!item) return '📦 ?';
  return upgrade > 0 ? `${item.emoji} ${item.name} **+${upgrade}**` : `${item.emoji} ${item.name}`;
}

function enchantLine(enchants: EnchantStack[]): string {
  return enchants.length > 0 ? enchants.map(formatEnchant).join(' · ') : '';
}

function relative(date: Date): string {
  return `<t:${Math.floor(date.getTime() / 1000)}:R>`;
}

/**
 * Noms affichés des vendeurs. Une mention ne notifierait personne (les rendus du panneau
 * coupent les mentions), mais elle s'affiche « @utilisateur inconnu » pour un membre absent
 * du cache du client : le nom est donc résolu ici, la mention ne servant qu'en dernier recours.
 */
async function sellerNames(guild: Guild | null, userIds: string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const unique = [...new Set(userIds)];
  if (guild && unique.length > 0) {
    const members = await guild.members.fetch({ user: unique }).catch(() => null);
    for (const id of unique) {
      const member = members?.get(id) ?? guild.members.cache.get(id);
      if (member) names.set(id, member.displayName);
    }
  }
  for (const id of unique) if (!names.has(id)) names.set(id, `<@${id}>`);
  return names;
}

/** Prix affiché d'une annonce : le prix fixe, ou l'enchère en cours et sa mise de départ. */
function priceLine(listing: MarketListing, currencyEmoji: string, locale: Locale): string {
  if (listing.type === 'AUCTION') {
    return listing.currentBid
      ? m.mkt_price_auction_bid({ bid: listing.currentBid, emoji: currencyEmoji }, { locale })
      : m.mkt_price_auction_start({ price: listing.price, emoji: currencyEmoji }, { locale });
  }
  return listing.quantity > 1
    ? m.mkt_price_fixed_lot({ price: listing.price, emoji: currencyEmoji, unit: Math.round(listing.price / listing.quantity) }, { locale })
    : m.mkt_price_fixed({ price: listing.price, emoji: currencyEmoji }, { locale });
}

function listingLine(listing: MarketListing, seller: string, currencyEmoji: string, locale: Locale): string {
  const item = listing.item;
  const stats = item ? itemStatLine(item, locale) : '';
  const meta = item ? `${rarityIcon(item.rarity)} ${shopCategoryLabel(item.type, locale)}` : '';
  return [
    `${copyName(item, listing.upgrade)} ×${listing.quantity}`,
    enchantLine(listing.enchants) || null,
    stats || null,
    priceLine(listing, currencyEmoji, locale),
    `-# ${meta} · ${m.mkt_listing_seller({ seller }, { locale })} · ${m.mkt_listing_expires({ when: relative(listing.expiresAt) }, { locale })}`,
  ].filter((line): line is string => line !== null).join('\n');
}

function tabLabel(tab: MarketTab, locale: Locale): string {
  switch (tab) {
    case 'auction': return m.mkt_tab_auction({}, { locale });
    case 'mine': return m.mkt_tab_mine({}, { locale });
    default: return m.mkt_tab_shop({}, { locale });
  }
}

function tabsRow(ownerId: string, state: MarketState, locale: Locale): ActionRowBuilder<ButtonBuilder> {
  const tabButton = (tab: MarketTab, emoji: string) => new ButtonBuilder()
    .setCustomId(viewId(ownerId, { tab, category: state.category, page: 0 }))
    .setLabel(tabLabel(tab, locale))
    .setEmoji(emoji)
    .setStyle(state.tab === tab ? ButtonStyle.Primary : ButtonStyle.Secondary);

  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    tabButton('shop', icon('rpgShop')),
    tabButton('auction', '🔨'),
    tabButton('mine', icon('rpgBag')),
    new ButtonBuilder()
      .setCustomId(`mkt:sellpick:${ownerId}:0`)
      .setLabel(m.mkt_btn_sell({}, { locale }))
      .setEmoji(icon('rpgSell'))
      .setStyle(ButtonStyle.Success),
  );
}

function navRow(ownerId: string, state: MarketState, pageCount: number, locale: Locale): ActionRowBuilder<ButtonBuilder> {
  const row = new ActionRowBuilder<ButtonBuilder>();
  if (pageCount > 1) {
    row.addComponents(
      new ButtonBuilder()
        // Suffixés : en page 2, « précédent » viserait sinon le même identifiant que l'onglet.
        .setCustomId(`${viewId(ownerId, { ...state, page: state.page - 1 })}:p`)
        .setLabel(m.rpg_shop_prev({}, { locale }))
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(state.page <= 0),
      new ButtonBuilder()
        .setCustomId(`mkt:noop:${ownerId}`)
        .setLabel(`${state.page + 1} / ${pageCount}`)
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true),
      new ButtonBuilder()
        .setCustomId(`${viewId(ownerId, { ...state, page: state.page + 1 })}:n`)
        .setLabel(m.rpg_shop_next({}, { locale }))
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(state.page >= pageCount - 1),
    );
  }
  row.addComponents(
    new ButtonBuilder()
      .setCustomId(`${viewId(ownerId, state)}:r`)
      .setLabel(m.mkt_btn_refresh({}, { locale }))
      .setEmoji(icon('rpgRefresh'))
      .setStyle(ButtonStyle.Secondary),
    // Le bouton relève du hub RPG : c'est lui qui le route, le marché n'a rien à en savoir.
    new ButtonBuilder()
      .setCustomId(`rpg:nav:${ownerId}:hub`)
      .setLabel(m.mkt_btn_rpg({}, { locale }))
      .setEmoji(icon('rpgBack'))
      .setStyle(ButtonStyle.Secondary),
  );
  return row;
}

function disabledView(ownerId: string, locale: Locale): PanelView {
  const container = new ContainerBuilder().setAccentColor(RPG_COLORS.trade);
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `## ${m.mkt_title({}, { locale })}\n${m.mkt_disabled({}, { locale })}`,
  ));
  const back = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`rpg:nav:${ownerId}:hub`)
      .setLabel(m.mkt_btn_rpg({}, { locale }))
      .setEmoji(icon('rpgBack'))
      .setStyle(ButtonStyle.Secondary),
  );
  return { embeds: [], components: [back], container };
}

/**
 * Étal du marché : les annonces de l'onglet choisi, cinq par page, chacune avec son vendeur,
 * son prix et un bouton qui mène à sa fiche. L'onglet « mes annonces » ajoute les ventes
 * conclues récemment.
 */
export async function buildMarketView(
  guildId: string,
  ownerId: string,
  guild: Guild | null,
  locale: Locale,
  state: MarketState = DEFAULT_STATE,
): Promise<PanelView> {
  if (!(await isModuleEnabled(guildId, 'marketplace'))) return disabledView(ownerId, locale);

  const [config, profile] = await Promise.all([
    getOrCreateEconomyConfig(guildId),
    prisma.rpgProfile.findUnique({ where: { guildId_userId: { guildId, userId: ownerId } }, select: { balance: true } }),
  ]);

  const mine = state.tab === 'mine';
  const query = (page: number) => getMarketListings(guildId, {
    type: mine ? undefined : state.tab === 'auction' ? 'AUCTION' : 'FIXED_PRICE',
    itemType: state.category === 'all' ? undefined : state.category,
    sellerId: mine ? ownerId : undefined,
    page,
    pageSize: LISTINGS_PER_PAGE,
  });
  let { listings, total } = await query(state.page);
  const pageCount = Math.max(1, Math.ceil(total / LISTINGS_PER_PAGE));
  const current = { ...state, page: Math.min(state.page, pageCount - 1) };
  // La dernière annonce de la page a pu partir entre-temps : on retombe sur la dernière page.
  if (current.page !== state.page) ({ listings, total } = await query(current.page));
  const names = await sellerNames(guild, listings.map((listing) => listing.sellerId));

  const container = new ContainerBuilder().setAccentColor(RPG_COLORS.trade);
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `## ${icon('rpgShop')} ${m.mkt_title({}, { locale })}\n`
    + m.mkt_summary({ balance: profile?.balance ?? 0, emoji: config.currencyEmoji }, { locale }),
  ));
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `### ${tabLabel(current.tab, locale)} · ${bagCategoryLabel(current.category, locale)} (${total})`,
  ));

  if (listings.length === 0) {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
      `*${mine ? m.mkt_empty_mine({}, { locale }) : m.mkt_empty({}, { locale })}*`,
    ));
  }

  for (const listing of listings) {
    const own = listing.sellerId === ownerId;
    const button = own
      ? new ButtonBuilder()
        .setCustomId(`mkt:cancel:${ownerId}:${listing.id}:${stateSuffix(current)}`)
        .setLabel(m.mkt_btn_withdraw({}, { locale }))
        .setStyle(ButtonStyle.Danger)
      : new ButtonBuilder()
        .setCustomId(`mkt:open:${ownerId}:${listing.id}:${stateSuffix(current)}`)
        .setLabel(listing.type === 'AUCTION' ? m.mkt_btn_bid({}, { locale }) : m.mkt_btn_buy({}, { locale }))
        .setStyle(listing.type === 'AUCTION' ? ButtonStyle.Primary : ButtonStyle.Success);

    container.addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(
          truncate(listingLine(listing, names.get(listing.sellerId) ?? listing.sellerId, config.currencyEmoji, locale), 500),
        ))
        .setButtonAccessory(button),
    );
  }

  if (mine) {
    const sales = await getRecentSales(guildId, ownerId, 5);
    if (sales.length > 0) {
      container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `### ${m.mkt_recent_sales({}, { locale })}\n`
        + sales.map((sale) => `${copyName(sale.item, sale.upgrade)} ×${sale.quantity} · **${sale.price}** ${config.currencyEmoji} · ${relative(sale.createdAt)}`).join('\n'),
      ));
    }
  }

  const components: PanelRow[] = [tabsRow(ownerId, current, locale)];
  components.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`mkt:cat:${ownerId}:${current.tab}`)
      .setPlaceholder(m.rpg_inventory_category_placeholder({}, { locale }))
      .addOptions(BAG_CATEGORIES.map((category) => ({
        label: truncate(bagCategoryLabel(category, locale), 100),
        value: category,
        default: category === current.category,
      }))),
  ));
  components.push(navRow(ownerId, current, pageCount, locale));

  return { embeds: [], components, container };
}

/**
 * Fiche d'une annonce : l'objet en entier, son vendeur, son prix comparé au prix moyen du
 * marché, et l'achat ou l'enchère à confirmer. Aucun achat ne part d'un seul clic depuis
 * l'étal : un objet à plusieurs milliers de pièces s'achète sur un écran qui en montre tout.
 */
async function buildListingView(
  guildId: string,
  ownerId: string,
  guild: Guild | null,
  listingId: string,
  locale: Locale,
  back: MarketState,
): Promise<PanelView> {
  const [listing, config, profile] = await Promise.all([
    getMarketListing(guildId, listingId),
    getOrCreateEconomyConfig(guildId),
    prisma.rpgProfile.findUnique({ where: { guildId_userId: { guildId, userId: ownerId } }, select: { balance: true } }),
  ]);

  if (!listing || listing.expiresAt < new Date() || !listing.item) {
    return withNote(await buildMarketView(guildId, ownerId, guild, locale, back), m.mkt_listing_gone({}, { locale }));
  }

  const item = listing.item;
  const [names, average] = await Promise.all([
    sellerNames(guild, [listing.sellerId]),
    getSuggestedPrice(guildId, listing.itemId, listing.upgrade),
  ]);

  const container = new ContainerBuilder().setAccentColor(RPG_COLORS.trade);
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent([
    `## ${copyName(item, listing.upgrade)} ×${listing.quantity}`,
    `-# ${rarityIcon(item.rarity)} ${shopCategoryLabel(item.type, locale)}${item.levelRequired > 0 ? ` · ${m.rpg_item_level_required({ level: item.levelRequired }, { locale })}` : ''}`,
    item.description ? `*${truncate(item.description, 400)}*` : null,
    itemStatLine(item, locale) || null,
    enchantLine(listing.enchants) || null,
  ].filter((line): line is string => line !== null).join('\n')));

  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
  const minBid = (listing.currentBid ?? listing.price) + 1;
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent([
    priceLine(listing, config.currencyEmoji, locale),
    listing.type === 'AUCTION' ? m.mkt_detail_min_bid({ min: minBid, emoji: config.currencyEmoji }, { locale }) : null,
    average.source === 'market'
      ? m.mkt_detail_average({ price: average.unitPrice * listing.quantity, emoji: config.currencyEmoji, count: average.samples }, { locale })
      : null,
    m.mkt_listing_seller({ seller: names.get(listing.sellerId) ?? listing.sellerId }, { locale })
      + ` · ${m.mkt_listing_expires({ when: relative(listing.expiresAt) }, { locale })}`,
    `-# ${m.mkt_detail_balance({ balance: profile?.balance ?? 0, emoji: config.currencyEmoji }, { locale })}`,
  ].filter((line): line is string => line !== null).join('\n')));

  const own = listing.sellerId === ownerId;
  const row = new ActionRowBuilder<ButtonBuilder>();
  if (own) {
    row.addComponents(new ButtonBuilder()
      .setCustomId(`mkt:cancel:${ownerId}:${listing.id}:${stateSuffix(back)}`)
      .setLabel(m.mkt_btn_withdraw({}, { locale }))
      .setStyle(ButtonStyle.Danger));
  } else if (listing.type === 'AUCTION') {
    row.addComponents(new ButtonBuilder()
      .setCustomId(`mkt:bidopen:${ownerId}:${listing.id}:${stateSuffix(back)}`)
      .setLabel(m.mkt_btn_bid_amount({ min: minBid }, { locale }))
      .setEmoji('🔨')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(listing.bidderId === ownerId));
  } else {
    row.addComponents(new ButtonBuilder()
      .setCustomId(`mkt:buy:${ownerId}:${listing.id}:${stateSuffix(back)}`)
      .setLabel(m.mkt_btn_confirm_buy({ price: listing.price }, { locale }))
      .setEmoji(icon('coins'))
      .setStyle(ButtonStyle.Success)
      .setDisabled((profile?.balance ?? 0) < listing.price));
  }
  row.addComponents(new ButtonBuilder()
    .setCustomId(viewId(ownerId, back))
    .setLabel(m.mkt_btn_back({}, { locale }))
    .setEmoji(icon('rpgBack'))
    .setStyle(ButtonStyle.Secondary));

  if (listing.bidderId === ownerId) {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${m.mkt_detail_you_lead({}, { locale })}`));
  }

  return { embeds: [], components: [row], container };
}

/**
 * Premier écran de la mise en vente : ce que le joueur peut vendre, ses exemplaires
 * ordinaires d'un côté, chaque exemplaire forgé à part avec son niveau.
 */
async function buildSellPickView(guildId: string, ownerId: string, locale: Locale, page: number): Promise<PanelView> {
  const copies = await getMarketSellableCopies(guildId, ownerId);
  const pageCount = Math.max(1, Math.ceil(copies.length / SELLABLE_PER_PAGE));
  const current = Math.min(Math.max(0, page), pageCount - 1);
  const shown = copies.slice(current * SELLABLE_PER_PAGE, current * SELLABLE_PER_PAGE + SELLABLE_PER_PAGE);

  const container = new ContainerBuilder().setAccentColor(RPG_COLORS.trade);
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    `## ${icon('rpgSell')} ${m.mkt_sell_title({}, { locale })}\n${copies.length > 0 ? m.mkt_sell_pick_desc({}, { locale }) : m.mkt_sell_nothing({}, { locale })}`,
  ));

  const components: PanelRow[] = [];
  if (shown.length > 0) {
    components.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`mkt:sellsel:${ownerId}`)
        .setPlaceholder(m.mkt_sell_placeholder({}, { locale }))
        .addOptions(shown.map((copy) => ({
          label: truncate(`${copy.item.name}${copy.upgrade > 0 ? ` +${copy.upgrade}` : ''} ×${copy.available}`, 100),
          value: `${copy.item.id}:${copy.instanceId ?? '-'}`,
          description: optionDescription(
            [shopCategoryLabel(copy.item.type, locale), copy.enchants.length > 0 ? enchantLine(copy.enchants) : null]
              .filter(Boolean).join(' · '),
          ),
          emoji: optionEmoji(copy.item.emoji),
        }))),
    ));
  }

  const row = new ActionRowBuilder<ButtonBuilder>();
  if (pageCount > 1) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`mkt:sellpick:${ownerId}:${current - 1}`)
        .setLabel(m.rpg_shop_prev({}, { locale }))
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(current <= 0),
      new ButtonBuilder()
        .setCustomId(`mkt:sellpick:${ownerId}:${current + 1}`)
        .setLabel(m.rpg_shop_next({}, { locale }))
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(current >= pageCount - 1),
    );
  }
  row.addComponents(new ButtonBuilder()
    .setCustomId(viewId(ownerId, DEFAULT_STATE))
    .setLabel(m.mkt_btn_back({}, { locale }))
    .setEmoji(icon('rpgBack'))
    .setStyle(ButtonStyle.Secondary));
  components.push(row);

  return { embeds: [], components, container };
}

/**
 * Second écran de la mise en vente : l'exemplaire choisi et le prix moyen du marché, avec
 * les deux façons de vendre. La fenêtre de saisie s'ouvre pré-remplie avec ce prix.
 */
async function buildSellSetupView(
  guildId: string,
  ownerId: string,
  locale: Locale,
  itemId: string,
  instanceId: string | null,
): Promise<PanelView> {
  const copies = await getMarketSellableCopies(guildId, ownerId);
  const copy = copies.find((candidate) => candidate.item.id === itemId && candidate.instanceId === instanceId);
  if (!copy) return withNote(await buildSellPickView(guildId, ownerId, locale, 0), m.mkt_sell_gone({}, { locale }));

  const [config, suggested] = await Promise.all([
    getOrCreateEconomyConfig(guildId),
    getSuggestedPrice(guildId, itemId, copy.upgrade),
  ]);

  const container = new ContainerBuilder().setAccentColor(RPG_COLORS.trade);
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent([
    `## ${copyName(copy.item, copy.upgrade)}`,
    `-# ${rarityIcon(copy.item.rarity)} ${shopCategoryLabel(copy.item.type, locale)} · ${m.mkt_sell_available({ count: copy.available }, { locale })}`,
    itemStatLine(copy.item, locale) || null,
    enchantLine(copy.enchants) || null,
  ].filter((line): line is string => line !== null).join('\n')));
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(
    suggested.source === 'market'
      ? m.mkt_sell_suggested_market({ price: suggested.unitPrice, emoji: config.currencyEmoji, count: suggested.samples }, { locale })
      : m.mkt_sell_suggested_shop({ price: suggested.unitPrice, emoji: config.currencyEmoji }, { locale }),
  ));

  const copyRef = `${itemId}:${instanceId ?? '-'}`;
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`mkt:sellopen:${ownerId}:F:${copyRef}`)
      .setLabel(m.mkt_btn_sell_fixed({}, { locale }))
      .setEmoji(icon('rpgShop'))
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`mkt:sellopen:${ownerId}:A:${copyRef}`)
      .setLabel(m.mkt_btn_sell_auction({}, { locale }))
      .setEmoji('🔨')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`mkt:sellpick:${ownerId}:0`)
      .setLabel(m.mkt_btn_back({}, { locale }))
      .setEmoji(icon('rpgBack'))
      .setStyle(ButtonStyle.Secondary),
  );

  return { embeds: [], components: [row], container };
}

async function openSellModal(
  interaction: ButtonInteraction,
  guildId: string,
  ownerId: string,
  locale: Locale,
  rest: string[],
): Promise<void> {
  const [mode, itemId, rawInstance] = rest;
  const instanceId = rawInstance && rawInstance !== '-' ? rawInstance : null;
  const copies = await getMarketSellableCopies(guildId, ownerId);
  const copy = copies.find((candidate) => candidate.item.id === itemId && candidate.instanceId === instanceId);
  if (!copy) {
    await replyPanelError(interaction, new Error(m.mkt_sell_gone({}, { locale })), locale);
    return;
  }
  const suggested = await getSuggestedPrice(guildId, copy.item.id, copy.upgrade);
  const auction = mode === 'A';

  const modal = new ModalBuilder()
    .setCustomId(`mkt:sellsubmit:${ownerId}:${auction ? 'A' : 'F'}:${itemId}:${instanceId ?? '-'}`)
    .setTitle(truncate(auction ? m.mkt_modal_auction_title({}, { locale }) : m.mkt_modal_fixed_title({}, { locale }), 45));

  const priceInput = new TextInputBuilder()
    .setCustomId('prix')
    .setLabel(truncate(auction ? m.mkt_modal_start_price({}, { locale }) : m.mkt_modal_unit_price({}, { locale }), 45))
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(12)
    .setValue(String(suggested.unitPrice));
  const rows = [new ActionRowBuilder<TextInputBuilder>().addComponents(priceInput)];

  // Un exemplaire forgé se vend seul : lui demander une quantité serait proposer l'impossible.
  if (!copy.instanceId && copy.available > 1) {
    rows.push(new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId('quantite')
        .setLabel(truncate(m.mkt_modal_quantity({ max: copy.available }, { locale }), 45))
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(6)
        .setValue('1'),
    ));
  }
  rows.push(new ActionRowBuilder<TextInputBuilder>().addComponents(
    new TextInputBuilder()
      .setCustomId('duree')
      .setLabel(truncate(m.mkt_modal_duration({ max: LISTING_DURATION_RANGE.max }, { locale }), 45))
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(3)
      .setValue(String(DEFAULT_DURATION_HOURS)),
  ));

  modal.addComponents(...rows);
  await interaction.showModal(modal);
}

async function handleSellSubmit(
  interaction: ModalSubmitInteraction,
  guildId: string,
  ownerId: string,
  locale: Locale,
  rest: string[],
): Promise<void> {
  const [mode, itemId, rawInstance] = rest;
  const instanceId = rawInstance && rawInstance !== '-' ? rawInstance : undefined;
  const unitPrice = parsePositiveInt(interaction.fields.getTextInputValue('prix'));
  const quantityField = interaction.fields.fields.has('quantite') ? interaction.fields.getTextInputValue('quantite') : '1';
  const quantity = instanceId ? 1 : parsePositiveInt(quantityField);
  const hours = parsePositiveInt(interaction.fields.getTextInputValue('duree'));

  if (!unitPrice || !quantity || !hours) {
    await replyPanelError(interaction, new Error(m.mkt_invalid_number({}, { locale })), locale);
    return;
  }

  const type = mode === 'A' ? 'AUCTION' : 'FIXED_PRICE';
  const result = await createListing(guildId, ownerId, {
    itemId,
    instanceId,
    quantity,
    // Le prix d'une annonce couvre tout le lot : c'est ce que l'acheteur paie d'un coup.
    price: unitPrice * quantity,
    type,
    durationHours: hours,
  });
  if (!result.success) {
    await replyPanelError(interaction, new Error(result.error ?? m.mkt_generic_error({}, { locale })), locale);
    return;
  }

  const view = await buildMarketView(guildId, ownerId, interaction.guild, locale, { tab: 'mine', category: 'all', page: 0 });
  await respond(interaction, withNote(view, m.mkt_sell_done({ price: unitPrice * quantity }, { locale })));
}

async function openBidModal(interaction: ButtonInteraction, guildId: string, ownerId: string, locale: Locale, rest: string[]): Promise<void> {
  const [listingId, ...back] = rest;
  const listing = await getMarketListing(guildId, listingId);
  if (!listing || listing.type !== 'AUCTION') {
    await replyPanelError(interaction, new Error(m.mkt_listing_gone({}, { locale })), locale);
    return;
  }
  const minBid = (listing.currentBid ?? listing.price) + 1;

  const modal = new ModalBuilder()
    .setCustomId(`mkt:bidsubmit:${ownerId}:${listingId}:${back.join(':')}`)
    .setTitle(truncate(m.mkt_modal_bid_title({}, { locale }), 45))
    .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId('montant')
        .setLabel(truncate(m.mkt_modal_bid_amount({ min: minBid }, { locale }), 45))
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(12)
        .setValue(String(minBid)),
    ));
  await interaction.showModal(modal);
}

async function handleBidSubmit(interaction: ModalSubmitInteraction, guildId: string, ownerId: string, locale: Locale, rest: string[]): Promise<void> {
  const [listingId, ...back] = rest;
  const amount = parsePositiveInt(interaction.fields.getTextInputValue('montant'));
  if (!amount) {
    await replyPanelError(interaction, new Error(m.mkt_invalid_number({}, { locale })), locale);
    return;
  }

  const result = await placeBid(guildId, ownerId, listingId, amount);
  if (!result.success) {
    await replyPanelError(interaction, new Error(result.error ?? m.mkt_generic_error({}, { locale })), locale);
    return;
  }
  const view = await buildListingView(guildId, ownerId, interaction.guild, listingId, locale, parseMarketState(back));
  await respond(interaction, withNote(view, m.mkt_bid_done({ amount }, { locale })));
}

async function handleBuy(interaction: ButtonInteraction, guildId: string, ownerId: string, locale: Locale, rest: string[]): Promise<void> {
  const [listingId, ...back] = rest;
  const result = await buyListing(guildId, ownerId, listingId);
  if (!result.success || !result.listing) {
    await replyPanelError(interaction, new Error(result.error ?? m.mkt_generic_error({}, { locale })), locale);
    return;
  }
  const view = await buildMarketView(guildId, ownerId, interaction.guild, locale, parseMarketState(back));
  await respond(interaction, withNote(view, m.mkt_buy_done({ price: result.listing.price }, { locale })));
}

async function handleCancel(interaction: ButtonInteraction, guildId: string, ownerId: string, locale: Locale, rest: string[]): Promise<void> {
  const [listingId, ...back] = rest;
  const result = await cancelListing(guildId, ownerId, listingId);
  if (!result.success) {
    await replyPanelError(interaction, new Error(result.error ?? m.mkt_generic_error({}, { locale })), locale);
    return;
  }
  const view = await buildMarketView(guildId, ownerId, interaction.guild, locale, parseMarketState(back));
  await respond(interaction, withNote(view, m.mkt_withdraw_done({}, { locale })));
}

/** Actions acquittées avant tout travail, comme dans le hub RPG : Discord n'attend que trois secondes. */
const DEFERRED_ACTIONS = new Set(['view', 'open', 'buy', 'cancel', 'sellpick', 'sellsetup']);

async function marketGate(
  interaction: ButtonInteraction | StringSelectMenuInteraction | ModalSubmitInteraction,
  customId: string,
): Promise<{ route: MarketRoute; guildId: string; locale: Locale } | null> {
  const route = parseMarketRoute(customId);
  if (!route || !interaction.guildId) return null;
  const locale = await getEffectiveLocale(interaction);
  if (!(await ensureOwner(interaction, route.ownerId, locale))) return null;
  if (!(await isModuleEnabled(interaction.guildId, 'marketplace'))) {
    await replyPanelError(interaction, new Error(m.mkt_disabled({}, { locale })), locale);
    return null;
  }
  return { route, guildId: interaction.guildId, locale };
}

export async function handleMarketButton(_client: Client, customId: string, interaction: ButtonInteraction): Promise<void> {
  const gate = await marketGate(interaction, customId);
  if (!gate) return;
  const { route: { action, ownerId, rest }, guildId, locale } = gate;

  try {
    if (DEFERRED_ACTIONS.has(action)) await interaction.deferUpdate();

    switch (action) {
      case 'view': await respond(interaction, await buildMarketView(guildId, ownerId, interaction.guild, locale, parseMarketState(rest))); return;
      case 'open': await respond(interaction, await buildListingView(guildId, ownerId, interaction.guild, rest[0], locale, parseMarketState(rest.slice(1)))); return;
      case 'buy': await handleBuy(interaction, guildId, ownerId, locale, rest); return;
      case 'cancel': await handleCancel(interaction, guildId, ownerId, locale, rest); return;
      case 'bidopen': await openBidModal(interaction, guildId, ownerId, locale, rest); return;
      case 'sellpick': await respond(interaction, await buildSellPickView(guildId, ownerId, locale, Number.parseInt(rest[0] ?? '0', 10) || 0)); return;
      case 'sellopen': await openSellModal(interaction, guildId, ownerId, locale, rest); return;
      // Depuis la fiche d'un objet du sac /rpg : la mise en vente de cet exemplaire précis.
      case 'sellsetup': await respond(interaction, await buildSellSetupView(guildId, ownerId, locale, rest[0], rest[1] && rest[1] !== '-' ? rest[1] : null)); return;
      default: return;
    }
  } catch (err) {
    await replyPanelError(interaction, err, locale);
  }
}

export async function handleMarketSelect(_client: Client, customId: string, interaction: StringSelectMenuInteraction): Promise<void> {
  const gate = await marketGate(interaction, customId);
  if (!gate) return;
  const { route: { action, ownerId, rest }, guildId, locale } = gate;

  try {
    await interaction.deferUpdate();
    const picked = interaction.values[0] ?? '';

    switch (action) {
      case 'cat': {
        const tab = MARKET_TABS.includes(rest[0] as MarketTab) ? (rest[0] as MarketTab) : 'shop';
        await respond(interaction, await buildMarketView(guildId, ownerId, interaction.guild, locale, parseMarketState([tab, picked, '0'])));
        return;
      }
      case 'sellsel': {
        const [itemId, rawInstance] = picked.split(':');
        await respond(interaction, await buildSellSetupView(guildId, ownerId, locale, itemId, rawInstance && rawInstance !== '-' ? rawInstance : null));
        return;
      }
      default: return;
    }
  } catch (err) {
    await replyPanelError(interaction, err, locale);
  }
}

export async function handleMarketModal(_client: Client, customId: string, interaction: ModalSubmitInteraction): Promise<void> {
  const gate = await marketGate(interaction, customId);
  if (!gate) return;
  const { route: { action, ownerId, rest }, guildId, locale } = gate;

  try {
    switch (action) {
      case 'sellsubmit': await handleSellSubmit(interaction, guildId, ownerId, locale, rest); return;
      case 'bidsubmit': await handleBidSubmit(interaction, guildId, ownerId, locale, rest); return;
      default: return;
    }
  } catch (err) {
    await replyPanelError(interaction, err, locale);
  }
}
