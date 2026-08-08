import {
  SlashCommandBuilder,
  MessageFlags,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { errorContainer, kotboContainer } from '../../utils/embeds.js';
import { E } from '../../utils/emojis.js';
import {
  createListing,
  buyListing,
  placeBid,
  cancelListing,
  getActiveListings,
  getMyListings,
  getMarketplaceListingChoices,
  getMarketplaceSellableItems,
} from '../../services/economy/marketplaceService.js';
import type { SlashCommandDefinition } from '../../commands.js';
import { separator, v2Message } from '@arcscord/components';
import { getEffectiveLocale } from '../../utils/i18n.js';
import * as m from '../../lib/paraglide/messages.js';

const data = new SlashCommandBuilder()
  .setName('market')
  .setDescription('Hôtel des ventes - achetez et vendez des objets')
  .addSubcommand((sub) =>
    sub.setName('sell')
      .setDescription('Mettre un objet en vente')
      .addStringOption((opt) => opt.setName('objet').setDescription('Objet à mettre en vente').setRequired(true).setAutocomplete(true))
      .addIntegerOption((opt) => opt.setName('prix').setDescription('Prix en coins').setRequired(true).setMinValue(1))
      .addIntegerOption((opt) => opt.setName('quantité').setDescription('Quantité').setMinValue(1))
      .addStringOption((opt) => opt.setName('type').setDescription('Type de vente').addChoices(
        { name: 'Prix fixe', value: 'FIXED_PRICE' },
        { name: 'Enchère', value: 'AUCTION' },
      ))
      .addIntegerOption((opt) => opt.setName('durée').setDescription('Durée en heures').setMinValue(1).setMaxValue(168)))
  .addSubcommand((sub) =>
    sub.setName('buy')
      .setDescription('Acheter un objet au prix fixe')
      .addStringOption((opt) => opt.setName('annonce').setDescription('Annonce à acheter').setRequired(true).setAutocomplete(true)))
  .addSubcommand((sub) =>
    sub.setName('bid')
      .setDescription('Enchérir sur un objet')
      .addStringOption((opt) => opt.setName('annonce').setDescription('Annonce sur laquelle enchérir').setRequired(true).setAutocomplete(true))
      .addIntegerOption((opt) => opt.setName('montant').setDescription('Montant de l\'enchère').setRequired(true).setMinValue(1)))
  .addSubcommand((sub) =>
    sub.setName('cancel')
      .setDescription('Annuler une annonce')
      .addStringOption((opt) => opt.setName('annonce').setDescription('Annonce à annuler').setRequired(true).setAutocomplete(true)))
  .addSubcommand((sub) =>
    sub.setName('list')
      .setDescription('Voir les annonces actives'))
  .addSubcommand((sub) =>
    sub.setName('my')
      .setDescription('Voir mes annonces'));

async function autocomplete(interaction: AutocompleteInteraction) {
  const guildId = interaction.guildId;
  if (!guildId) {
    await interaction.respond([]);
    return;
  }

  const subcommand = interaction.options.getSubcommand();
  const focusedValue = interaction.options.getFocused().toLowerCase();
  const userId = interaction.user.id;

  try {
    if (subcommand === 'sell') {
      const inventory = await getMarketplaceSellableItems(guildId, userId);
      const choices = inventory
        .filter((entry) => {
          const search = `${entry.item.name} ${entry.item.id}`.toLowerCase();
          return search.includes(focusedValue);
        })
        .slice(0, 25)
        .map((entry) => ({
          name: `${entry.item.emoji} ${entry.item.name} · x${entry.quantity}`.slice(0, 100),
          value: entry.item.id,
        }));
      await interaction.respond(choices);
      return;
    }

    if (subcommand === 'buy' || subcommand === 'bid' || subcommand === 'cancel') {
      const listings = await getMarketplaceListingChoices(guildId, userId, subcommand);
      const choices = listings
        .filter((listing) => {
          const search = `${listing.item?.name ?? ''} ${listing.itemId} ${listing.id}`.toLowerCase();
          return search.includes(focusedValue);
        })
        .slice(0, 25)
        .map((listing) => ({
          name: `${listing.item?.emoji ?? '📦'} ${listing.item?.name ?? listing.itemId} · x${listing.quantity} · ${listing.currentBid ?? listing.price} coins`.slice(0, 100),
          value: listing.id,
        }));
      await interaction.respond(choices);
      return;
    }

    await interaction.respond([]);
  } catch {
    await interaction.respond([]);
  }
}

async function execute(interaction: ChatInputCommandInteraction) {
  const subcommand = interaction.options.getSubcommand();
  const guildId = interaction.guildId!;
  const userId = interaction.user.id;
  const locale = await getEffectiveLocale(interaction);

  if (subcommand === 'sell') {
    const itemId = interaction.options.getString('objet', true);
    const price = interaction.options.getInteger('prix', true);
    const quantity = interaction.options.getInteger('quantité') ?? 1;
    const type = (interaction.options.getString('type') ?? 'FIXED_PRICE') as 'FIXED_PRICE' | 'AUCTION';
    const duration = interaction.options.getInteger('durée') ?? 24;

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const result = await createListing(guildId, userId, { itemId, quantity, price, type, durationHours: duration });

    if (!result.success) {
      await interaction.editReply(v2Message(
        errorContainer(m.b3_market_sell_error_title({}, { locale }), result.error),
      ));
      return;
    }

    await interaction.editReply(v2Message(
      kotboContainer({
        color: 'success',
        title: m.b3_market_sell_success_title({ success: E.success }, { locale }),
        fields: [
          m.b3_market_sell_success_body({ itemId, quantity, dot: E.dot, mode: type === 'FIXED_PRICE' ? m.b3_market_mode_fixed({}, { locale }) : m.b3_market_mode_auction({}, { locale }), price, coins: E.coins, duration, id: result.listing.id }, { locale }),
        ],
        footerTitle: m.b3_market_footer({}, { locale }),
      }),
    ));
  }

  if (subcommand === 'buy') {
    const listingId = interaction.options.getString('annonce', true);

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const result = await buyListing(guildId, userId, listingId);

    if (!result.success || !result.listing) {
      await interaction.editReply(v2Message(
        errorContainer(m.b3_market_buy_error_title({}, { locale }), result.error),
      ));
      return;
    }

    const purchased = result.listing;

    await interaction.editReply(v2Message(
      kotboContainer({
        color: 'success',
        title: m.b3_market_buy_success_title({ success: E.success }, { locale }),
        fields: [
          m.b3_market_buy_success_body({ itemId: purchased.itemId, quantity: purchased.quantity, price: purchased.price, coins: E.coins, sellerId: purchased.sellerId }, { locale }),
        ],
        footerTitle: m.b3_market_footer({}, { locale }),
      }),
    ));
  }

  if (subcommand === 'bid') {
    const listingId = interaction.options.getString('annonce', true);
    const amount = interaction.options.getInteger('montant', true);

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const result = await placeBid(guildId, userId, listingId, amount);

    if (!result.success) {
      await interaction.editReply(v2Message(
        errorContainer(m.b3_market_bid_error_title({}, { locale }), result.error),
      ));
      return;
    }

    await interaction.editReply(v2Message(
      kotboContainer({
        color: 'success',
        title: m.b3_market_bid_success_title({ success: E.success }, { locale }),
        fields: [
          m.b3_market_bid_success_body({ amount, coins: E.coins, itemId: result.listing?.itemId ?? m.b3_market_item_fallback({}, { locale }) }, { locale }),
        ],
        footerTitle: m.b3_market_footer({}, { locale }),
      }),
    ));
  }

  if (subcommand === 'cancel') {
    const listingId = interaction.options.getString('annonce', true);

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const result = await cancelListing(guildId, userId, listingId);

    if (!result.success) {
      await interaction.editReply(v2Message(
        errorContainer('Annulation impossible', result.error),
      ));
      return;
    }

    await interaction.editReply(v2Message(
      kotboContainer({
        color: 'success',
        title: `${E.success} Annonce annulée`,
        fields: [
          `L'annonce pour **${result.listing?.itemId ?? 'objet'}** a bien été annulée et l'objet a été retourné dans votre inventaire.`,
        ],
        footerTitle: 'Marché',
      }),
    ));
  }

  if (subcommand === 'list') {
    await interaction.deferReply();
    const { listings } = await getActiveListings(guildId);

    if (listings.length === 0) {
      await interaction.editReply(v2Message(
        kotboContainer({
          color: 'dark',
          title: `${E.trophy} Hôtel des ventes`,
          fields: [`${E.info} Aucune annonce active pour le moment.`],
          footerTitle: 'Marché',
        }),
      ));
      return;
    }

    const lines = listings.map((l: any) => {
      const typeLabel = l.type === 'AUCTION' ? '🔨 [Enchère]' : '💰';
      const endsAt = new Date(l.expiresAt).toLocaleDateString('fr-FR', { hour: '2-digit', minute: '2-digit' });
      return `${typeLabel} \`${l.id}\` **${l.item?.emoji ?? '📦'} ${l.item?.name ?? l.itemId}** x${l.quantity} - Vendeur: <@${l.sellerId}> - **${l.price}** ${E.coins} (fin le ${endsAt})`;
    });

    await interaction.editReply(v2Message(
      kotboContainer({
        color: 'primary',
        title: `${E.trophy} Hôtel des ventes`,
        fields: [
          separator({ divider: true, spacing: 'small' }),
          lines.join('\n'),
        ],
        footerTitle: 'Marché',
      }),
    ));
  }

  if (subcommand === 'my') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const listings = await getMyListings(guildId, userId);

    if (listings.length === 0) {
      await interaction.editReply(v2Message(
        kotboContainer({
          color: 'dark',
          title: `${E.profile} Mes annonces`,
          fields: [`${E.info} Vous n'avez aucune annonce en cours.`],
          footerTitle: 'Marché',
        }),
      ));
      return;
    }

    const statusIcons: Record<string, string> = {
      ACTIVE: E.online,
      SOLD: E.success,
      CANCELLED: E.error,
      EXPIRED: E.clock,
    };

    const lines = listings.map((l: any) => {
      const icon = statusIcons[l.status] ?? E.dot;
      return `${icon} \`${l.id}\` **${l.item?.emoji ?? '📦'} ${l.item?.name ?? l.itemId}** x${l.quantity} - ${l.price} ${E.coins}`;
    });

    await interaction.editReply(v2Message(
      kotboContainer({
        color: 'primary',
        title: `${E.profile} Mes annonces`,
        fields: [
          separator({ divider: true, spacing: 'small' }),
          lines.join('\n'),
        ],
        footerTitle: 'Marché',
      }),
    ));
  }
}

export const marketCommand = { data, execute, autocomplete } satisfies SlashCommandDefinition;
