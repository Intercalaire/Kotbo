/**
 * Panneau de la Tour (`/tower` et le menu du hub `/rpg`).
 *
 * Toute l'ascension tient dans un seul message réécrit à chaque clic : portes, combat, butin,
 * bénédictions et marchand sont des écrans du même panneau, et il n'y a aucune commande à
 * taper. Les `customId` suivent la forme `twr:<action>:<propriétaire>:<arguments>` ; les
 * actions de partie portent la version de la partie, pour qu'un vieux message ne rejoue rien.
 */

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  SectionBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
  type ButtonInteraction,
  type Client,
} from 'discord.js';
import { truncate } from '../../../utils/embeds.js';
import { getEffectiveLocale } from '../../../utils/i18n.js';
import * as m from '../../../lib/paraglide/messages.js';
import { getOrCreateEconomyConfig } from '../economyService.js';
import { combatHpBar, icon, rarityIcon, RPG_COLORS } from './rpgIcons.js';
import {
  ensureOwner,
  replyPanelError,
  respond,
  withNote,
  type Locale,
  type PanelRow,
  type PanelView,
} from '../rpgPanelService.js';
import { towerStats, type TowerAction, type TowerLogEntry, type TowerMapState, type TowerMove, type TowerNotice, type TowerState } from './rpgTowerEngine.js';
import { occupancy, type TowerDirection, type TowerRoomType } from './rpgTowerMap.js';
import {
  MAX_POTIONS,
  TOWER_GEAR_SLOTS,
  TOWER_UPGRADES,
  TOWER_UPGRADE_KEYS,
  findBlessing,
  scrapValue,
  towerUpgradeCost,
  type TowerDoor,
  type TowerGear,
  type TowerGearSlot,
  type TowerOffer,
  type TowerUpgradeKey,
} from './rpgTowerPolicy.js';
import {
  TowerRefused,
  abandonTowerRun,
  actTowerRun,
  buyTowerReward,
  buyTowerUpgrade,
  getActiveTowerRun,
  getOrCreateTowerProfile,
  getTowerConfig,
  getTowerLeaderboard,
  getTowerShop,
  isTowerOpen,
  previewTowerEntry,
  startTowerRun,
  type ActiveTowerRun,
  type TowerConfigView,
  type TowerRefusal,
  type TowerRewardView,
  type TowerSettlement,
} from './rpgTowerService.js';

const COLOR = RPG_COLORS.combat;
const REWARDS_PER_PAGE = 4;

type TowerRoute = { action: string; ownerId: string; rest: string[] };

function parseTowerRoute(customId: string): TowerRoute | null {
  if (!customId.startsWith('twr:')) return null;
  const [, action, ownerId, ...rest] = customId.split(':');
  if (!action || !ownerId) return null;
  return { action, ownerId, rest };
}

function button(customId: string, label: string, style: ButtonStyle, emoji?: string, disabled = false): ButtonBuilder {
  const built = new ButtonBuilder().setCustomId(customId).setLabel(truncate(label, 80)).setStyle(style).setDisabled(disabled);
  if (emoji) built.setEmoji(emoji);
  return built;
}

function row(...buttons: ButtonBuilder[]): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(...buttons);
}

function separator(container: ContainerBuilder): void {
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
}

function textBlock(container: ContainerBuilder, content: string): void {
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(truncate(content, 3900)));
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function header(config: TowerConfigView, subtitle?: string): string {
  return `## ${config.emoji} ${config.name}${subtitle ? ` · ${subtitle}` : ''}`;
}

// ─────────────────────────────────────────────────────────────
// Libellés
// ─────────────────────────────────────────────────────────────

const DOOR_EMOJI: Record<TowerDoor, string> = {
  COMBAT: '⚔️',
  ELITE: '💀',
  TREASURE: '💎',
  CAMPFIRE: '🔥',
  MERCHANT: '🛒',
  BOSS: '👑',
};

function doorLabel(door: TowerDoor, locale: Locale): string {
  switch (door) {
    case 'COMBAT': return m.tower_door_combat({}, { locale });
    case 'ELITE': return m.tower_door_elite({}, { locale });
    case 'TREASURE': return m.tower_door_treasure({}, { locale });
    case 'CAMPFIRE': return m.tower_door_campfire({}, { locale });
    case 'MERCHANT': return m.tower_door_merchant({}, { locale });
    default: return m.tower_door_boss({}, { locale });
  }
}

function doorDescription(door: TowerDoor, locale: Locale): string {
  switch (door) {
    case 'COMBAT': return m.tower_door_combat_desc({}, { locale });
    case 'ELITE': return m.tower_door_elite_desc({}, { locale });
    case 'TREASURE': return m.tower_door_treasure_desc({}, { locale });
    case 'CAMPFIRE': return m.tower_door_campfire_desc({}, { locale });
    case 'MERCHANT': return m.tower_door_merchant_desc({}, { locale });
    default: return m.tower_door_boss_desc({}, { locale });
  }
}

const ROOM_EMOJI: Record<TowerRoomType, string> = {
  START: '🚪',
  MONSTER: '👹',
  ELITE: '💀',
  BOSS: '👑',
  CHEST: '💰',
  CAMPFIRE: '🔥',
  MERCHANT: '🛒',
  SHRINE: '✨',
  EMPTY: '⬜',
};

const DIRECTION_EMOJI: Record<TowerDirection, string> = { N: '⬆️', E: '➡️', S: '⬇️', W: '⬅️' };

function roomLabel(type: TowerRoomType, locale: Locale): string {
  switch (type) {
    case 'START': return m.tower_room_start({}, { locale });
    case 'MONSTER': return doorLabel('COMBAT', locale);
    case 'ELITE': return doorLabel('ELITE', locale);
    case 'BOSS': return doorLabel('BOSS', locale);
    case 'CHEST': return doorLabel('TREASURE', locale);
    case 'CAMPFIRE': return doorLabel('CAMPFIRE', locale);
    case 'MERCHANT': return doorLabel('MERCHANT', locale);
    case 'SHRINE': return m.tower_room_shrine({}, { locale });
    default: return m.tower_room_empty({}, { locale });
  }
}

function roomDescription(type: TowerRoomType, locale: Locale): string {
  switch (type) {
    case 'START': return m.tower_room_start_desc({}, { locale });
    case 'MONSTER': return doorDescription('COMBAT', locale);
    case 'ELITE': return doorDescription('ELITE', locale);
    case 'BOSS': return m.tower_room_boss_desc({}, { locale });
    case 'CHEST': return m.tower_room_chest_desc({}, { locale });
    case 'CAMPFIRE': return m.tower_room_campfire_desc({}, { locale });
    case 'MERCHANT': return doorDescription('MERCHANT', locale);
    case 'SHRINE': return m.tower_room_shrine_desc({}, { locale });
    default: return m.tower_room_empty_desc({}, { locale });
  }
}

/**
 * Carte de la section en emojis : salles restantes par type, salles faites en vert, murs en
 * noir, le joueur en personnage. Une ligne par rangée de la grille, 12 cases au plus.
 */
function miniMap(map: TowerMapState): string {
  const cells = occupancy(map.layout);
  const rows: string[] = [];
  for (let y = 0; y < map.layout.height; y++) {
    let line = '';
    for (let x = 0; x < map.layout.width; x++) {
      const room = cells.get(`${x},${y}`);
      if (!room) line += '⬛';
      else if (room.id === map.pos) line += '🧍';
      else if (map.cleared.includes(room.id) && room.type !== 'START' && room.type !== 'EMPTY') line += '🟩';
      else line += ROOM_EMOJI[room.type];
    }
    rows.push(line);
  }
  return rows.join('\n');
}

function moveLine(move: TowerMove, locale: Locale): string {
  const status = move.cleared
    ? `*${m.tower_room_visited({}, { locale })}*`
    : roomDescription(move.type, locale);
  return `${DIRECTION_EMOJI[move.direction]} ${ROOM_EMOJI[move.type]} **${roomLabel(move.type, locale)}** — ${status}`;
}

function slotLabel(slot: TowerGearSlot, locale: Locale): string {
  switch (slot) {
    case 'weapon': return m.tower_slot_weapon({}, { locale });
    case 'armor': return m.tower_slot_armor({}, { locale });
    default: return m.tower_slot_relic({}, { locale });
  }
}

function gearStats(gear: TowerGear): string {
  const parts: string[] = [];
  if (gear.attack) parts.push(`${icon('rpgAtk')} +${gear.attack}`);
  if (gear.defense) parts.push(`${icon('rpgDef')} +${gear.defense}`);
  if (gear.maxHealth) parts.push(`${icon('rpgHp')} +${gear.maxHealth}`);
  if (gear.speed) parts.push(`${icon('rpgSpd')} +${gear.speed}`);
  if (gear.critChance) parts.push(`🎯 +${percent(gear.critChance)}`);
  if (gear.lifesteal) parts.push(`🩸 +${percent(gear.lifesteal)}`);
  if (gear.thorns) parts.push(`🌵 +${percent(gear.thorns)}`);
  if (gear.armorPiercing) parts.push(`📌 +${percent(gear.armorPiercing)}`);
  return parts.join(' · ');
}

function gearLine(gear: TowerGear | null, locale: Locale): string {
  if (!gear) return `*${m.tower_slot_empty({}, { locale })}*`;
  return `${rarityIcon(gear.rarity)} ${gear.emoji} **${gear.name}** · ${gearStats(gear)}`;
}

/** Ce qu'une récompense verse au profil RPG, sur une ligne. */
function rewardContents(reward: TowerRewardView, coinEmoji: string, config: TowerConfigView, locale: Locale): string {
  const parts: string[] = [];
  if (reward.coins > 0) parts.push(`${coinEmoji} ${reward.coins}`);
  if (reward.xp > 0) parts.push(m.tower_reward_xp({ amount: reward.xp }, { locale }));
  if (reward.clanPoints > 0) parts.push(m.tower_reward_clan_points({ amount: reward.clanPoints }, { locale }));
  if (reward.itemName) parts.push(`📦 ${reward.itemName}`);
  if (reward.titleName) parts.push(m.tower_reward_title({ name: reward.titleName }, { locale }));
  if (reward.roleId) parts.push(`<@&${reward.roleId}>`);
  if (reward.shards > 0) parts.push(`${config.currencyEmoji} ${reward.shards}`);
  return parts.join(' · ');
}

function logLine(entry: TowerLogEntry, foe: { name: string; emoji: string }, locale: Locale): string {
  const crit = (critical: boolean) => (critical ? m.rpg_fight_critical_suffix({}, { locale }) : '');
  switch (entry.k) {
    case 'attack': return m.rpg_fight_action_attack({ dmg: entry.dmg, crit: crit(entry.crit), name: foe.name }, { locale });
    case 'skill': return m.rpg_fight_action_skill({ emoji: entry.emoji, skill: entry.name, dmg: entry.dmg, crit: crit(entry.crit), name: foe.name }, { locale });
    case 'support': return m.rpg_fight_action_skill_support({ emoji: entry.emoji, skill: entry.name }, { locale });
    case 'defend': return m.rpg_fight_action_defend({}, { locale });
    case 'potion': return m.tower_log_potion({ hp: entry.hp }, { locale });
    case 'heal': return m.tower_log_heal({ hp: entry.hp }, { locale });
    case 'monster': return m.rpg_fight_monster_turn_log({ emoji: foe.emoji, name: foe.name, dmg: entry.dmg, crit: crit(entry.crit) }, { locale });
    case 'evaded': return m.rpg_fight_monster_evaded({ emoji: foe.emoji, name: foe.name }, { locale });
    case 'thorns': return m.rpg_fight_thorns_log({ dmg: entry.dmg, emoji: foe.emoji, name: foe.name }, { locale });
  }
}

function noticeLine(notice: TowerNotice | null, locale: Locale): string | null {
  if (!notice) return null;
  switch (notice.k) {
    case 'victory': {
      const line = notice.healed > 0
        ? m.tower_notice_victory_healed({ emoji: notice.emoji, name: notice.name, gold: notice.gold, hp: notice.healed }, { locale })
        : m.tower_notice_victory({ emoji: notice.emoji, name: notice.name, gold: notice.gold }, { locale });
      return notice.section ? `${line}\n> 🗺️ ${m.tower_notice_section({ section: notice.section }, { locale })}` : line;
    }
    case 'treasure': return notice.gold > 0
      ? m.tower_notice_treasure({ gold: notice.gold }, { locale })
      : m.tower_notice_chest_item({}, { locale });
    case 'campfire': return m.tower_notice_campfire({ hp: notice.hp }, { locale });
    case 'potion': return m.tower_log_potion({ hp: notice.hp }, { locale });
    case 'equipped': return m.tower_notice_equipped({ emoji: notice.emoji, name: notice.name }, { locale });
    case 'scrapped': return m.tower_notice_scrapped({ gold: notice.gold }, { locale });
    case 'blessed': {
      const blessing = findBlessing(notice.id);
      return blessing ? m.tower_notice_blessed({ emoji: blessing.emoji, name: blessing.name, rank: notice.rank }, { locale }) : null;
    }
    case 'bought': return m.tower_notice_bought({}, { locale });
  }
}

export function towerRefusalText(refusal: TowerRefusal, config: TowerConfigView, locale: Locale): string {
  switch (refusal.kind) {
    case 'disabled': return m.tower_refused_disabled({}, { locale });
    case 'active_run': return m.tower_refused_active({}, { locale });
    case 'no_run': return m.tower_refused_no_run({}, { locale });
    case 'stale': return m.tower_refused_stale({}, { locale });
    case 'in_combat': return m.tower_refused_in_combat({}, { locale });
    case 'shards': return m.tower_refused_shards({ price: refusal.price, balance: refusal.balance, emoji: config.currencyEmoji }, { locale });
    case 'owned': return m.tower_refused_owned({}, { locale });
    case 'unavailable': return m.tower_refused_unavailable({}, { locale });
    case 'upgrade_max': return m.tower_refused_upgrade_max({}, { locale });
    case 'action': {
      switch (refusal.reason) {
        case 'skill_cooldown': return m.tower_refused_cooldown({}, { locale });
        case 'no_potion': return m.tower_refused_no_potion({}, { locale });
        case 'hp_full': return m.tower_refused_hp_full({}, { locale });
        case 'no_gold': return m.tower_refused_no_gold({}, { locale });
        case 'sold_out': return m.tower_refused_sold_out({}, { locale });
        case 'potions_full': return m.tower_refused_potions_full({ max: MAX_POTIONS }, { locale });
        default: return m.tower_refused_stale({}, { locale });
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────
// Écrans
// ─────────────────────────────────────────────────────────────

function closedView(config: TowerConfigView, ownerId: string, locale: Locale, rpgEnabled: boolean): PanelView {
  const container = new ContainerBuilder().setAccentColor(COLOR);
  textBlock(container, `${header(config)}\n${m.tower_refused_disabled({}, { locale })}`);
  const components: PanelRow[] = rpgEnabled
    ? [row(button(`rpg:nav:${ownerId}:hub`, m.rpg_hub_btn_back({}, { locale }), ButtonStyle.Secondary, icon('rpgBack')))]
    : [];
  return { embeds: [], components, container };
}

/** Accueil : profil Tour, stats d'entrée et accès à la boutique et au classement. */
export async function buildTowerHomeView(client: Client | null, guildId: string, ownerId: string, locale: Locale): Promise<PanelView> {
  const [config, economy] = await Promise.all([getTowerConfig(guildId), getOrCreateEconomyConfig(guildId)]);
  if (!(await isTowerOpen(guildId))) return closedView(config, ownerId, locale, economy.rpgEnabled);

  // D'abord la partie : une partie expirée est soldée ici, et le profil lu ensuite doit
  // déjà compter les éclats qu'elle vient de verser.
  const { active, expired } = await getActiveTowerRun(client, guildId, ownerId);
  const [profile, preview] = await Promise.all([
    getOrCreateTowerProfile(guildId, ownerId),
    previewTowerEntry(guildId, ownerId),
  ]);

  const container = new ContainerBuilder().setAccentColor(COLOR);
  textBlock(container, [
    header(config),
    config.description || m.tower_default_description({}, { locale }),
  ].join('\n'));
  separator(container);

  textBlock(container, [
    `### ${m.tower_home_profile_title({}, { locale })}`,
    m.tower_home_profile_line({
      emoji: config.currencyEmoji,
      shards: profile.shards,
      currency: config.currencyName,
      best: profile.bestFloor,
      allTime: profile.bestFloorAllTime,
      runs: profile.totalRuns,
    }, { locale }),
  ].join('\n'));

  const s = preview.stats;
  const modeLine = preview.mode === 'RESET'
    ? m.tower_home_mode_reset({}, { locale })
    : m.tower_home_mode_compressed({}, { locale });
  const skills = preview.skills.length > 0
    ? preview.skills.map((skill) => `${skill.emoji} ${skill.name}`).join(' · ')
    : m.tower_home_no_skills({}, { locale });

  textBlock(container, [
    `### ${m.tower_home_entry_title({}, { locale })}`,
    `-# ${modeLine}`,
    `${icon('rpgAtk')} **${s.attack}** · ${icon('rpgDef')} **${s.defense}** · ${icon('rpgSpd')} **${s.speed}** · ${icon('rpgHp')} **${s.maxHealth}** · 🎯 **${percent(s.critChance)}**`,
    `-# ${m.tower_home_main_stats({ atk: preview.main.attack, def: preview.main.defense, spd: preview.main.speed, hp: preview.main.maxHealth }, { locale })}`,
    [preview.className, preview.titleName ? m.tower_home_title({ title: preview.titleName }, { locale }) : null]
      .filter(Boolean).join(' · ') || null,
    m.tower_home_skills({ skills }, { locale }),
    m.tower_home_potions({ count: preview.potions }, { locale }),
  ].filter((line): line is string => Boolean(line)).join('\n'));

  const components: PanelRow[] = [
    row(
      active
        ? button(`twr:run:${ownerId}`, m.tower_btn_resume({ floor: active.run.floor }, { locale }), ButtonStyle.Success, '🧗')
        : button(`twr:enter:${ownerId}`, m.tower_btn_enter({}, { locale }), ButtonStyle.Success, '🚪'),
      button(`twr:shop:${ownerId}:0`, m.tower_btn_shop({}, { locale }), ButtonStyle.Primary, icon('rpgShop')),
      button(`twr:top:${ownerId}`, m.tower_btn_leaderboard({}, { locale }), ButtonStyle.Secondary, '🏆'),
      ...(economy.rpgEnabled ? [button(`rpg:nav:${ownerId}:hub`, m.rpg_hub_btn_back({}, { locale }), ButtonStyle.Secondary, icon('rpgBack'))] : []),
    ),
  ];

  const view: PanelView = { embeds: [], components, container };
  return expired ? withNote(view, m.tower_expired_note({ minutes: config.idleTimeoutMinutes, shards: expired.shards, emoji: config.currencyEmoji }, { locale })) : view;
}

function statusBlock(state: TowerState, floor: number, config: TowerConfigView, locale: Locale): string {
  const stats = towerStats(state);
  const blessings = Object.entries(state.blessings)
    .map(([id, rank]) => {
      const blessing = findBlessing(id);
      return blessing ? `${blessing.emoji}${rank > 1 ? `×${rank}` : ''}` : null;
    })
    .filter(Boolean)
    .join(' ');

  const title = state.map
    ? `${m.tower_floor({ floor }, { locale })} · ${m.tower_section({ section: state.map.section }, { locale })}`
    : m.tower_floor({ floor }, { locale });
  return [
    header(config, title),
    combatHpBar(state.hp, stats.maxHealth),
    `${icon('rpgAtk')} ${stats.attack} · ${icon('rpgDef')} ${stats.defense} · ${icon('rpgSpd')} ${stats.speed} · 🎯 ${percent(stats.critChance)}`,
    m.tower_run_resources({
      gold: state.gold,
      potions: state.potions,
      shards: state.shards,
      emoji: config.currencyEmoji,
    }, { locale }),
    ...TOWER_GEAR_SLOTS.map((slot) => `-# ${slotLabel(slot, locale)} : ${state.gear[slot] ? `${state.gear[slot]!.emoji} ${state.gear[slot]!.name}` : '—'}`),
    blessings ? `-# ${m.tower_run_blessings({ list: blessings }, { locale })}` : null,
  ].filter((line): line is string => Boolean(line)).join('\n');
}

function actId(ownerId: string, version: number, code: string): string {
  return `twr:a:${ownerId}:${version}:${code}`;
}

function runControls(ownerId: string, state: TowerState, version: number, locale: Locale): ActionRowBuilder<ButtonBuilder> {
  const max = towerStats(state).maxHealth;
  return row(
    button(actId(ownerId, version, 'pot'), m.rpg_fight_btn_potion({ count: state.potions }, { locale }), ButtonStyle.Success, icon('rpgPotion'), state.potions === 0 || state.hp >= max),
    button(`twr:quitask:${ownerId}:${version}`, m.tower_btn_leave({}, { locale }), ButtonStyle.Danger, '🏳️'),
  );
}

/** Écran de la partie en cours, selon sa phase. */
export async function buildTowerRunView(guildId: string, ownerId: string, locale: Locale, active: ActiveTowerRun): Promise<PanelView> {
  const config = await getTowerConfig(guildId);
  const { run, state } = active;
  const version = run.version;
  const container = new ContainerBuilder().setAccentColor(COLOR);
  const components: PanelRow[] = [];

  textBlock(container, statusBlock(state, run.floor, config, locale));
  const notice = noticeLine(state.notice, locale);
  if (notice) textBlock(container, `> ${notice}`);
  separator(container);

  switch (state.phase) {
    case 'DOORS': {
      if (state.map) {
        const moves = state.moves.slice(0, 5);
        textBlock(container, miniMap(state.map));
        textBlock(container, [
          `### ${m.tower_moves_title({}, { locale })}`,
          ...moves.map((move) => moveLine(move, locale)),
        ].join('\n'));
        if (moves.length > 0) {
          components.push(row(...moves.map((move, index) => button(
            actId(ownerId, version, `d${index}`),
            roomLabel(move.type, locale),
            move.cleared ? ButtonStyle.Secondary : move.type === 'BOSS' ? ButtonStyle.Danger : ButtonStyle.Primary,
            DIRECTION_EMOJI[move.direction],
          ))));
        }
        components.push(runControls(ownerId, state, version, locale));
        break;
      }
      textBlock(container, [
        `### ${m.tower_doors_title({}, { locale })}`,
        ...state.doors.map((door) => `${DOOR_EMOJI[door]} **${doorLabel(door, locale)}** — ${doorDescription(door, locale)}`),
      ].join('\n'));
      components.push(row(...state.doors.map((door, index) =>
        button(actId(ownerId, version, `d${index}`), doorLabel(door, locale), door === 'BOSS' ? ButtonStyle.Danger : ButtonStyle.Primary, DOOR_EMOJI[door]))));
      components.push(runControls(ownerId, state, version, locale));
      break;
    }

    case 'COMBAT': {
      const foe = state.encounter!;
      const kind = foe.kind === 'BOSS' ? ' 👑' : foe.kind === 'ELITE' ? ' 💀' : '';
      const log = foe.log.map((entry) => logLine(entry, foe, locale));
      textBlock(container, [
        `### ${foe.emoji} ${foe.name}${kind}`,
        combatHpBar(foe.health, foe.maxHealth),
        `-# ${icon('rpgAtk')} ${foe.attack} · ${icon('rpgDef')} ${foe.defense} · ${icon('rpgSpd')} ${foe.speed}`,
        '',
        log.length > 0 ? log.join('\n') : m.rpg_fight_combat_start_log({}, { locale }),
      ].join('\n'));

      components.push(row(
        button(actId(ownerId, version, 'atk'), m.rpg_fight_btn_attack({}, { locale }), ButtonStyle.Primary, icon('rpgAtk')),
        button(actId(ownerId, version, 'def'), m.rpg_fight_btn_defend({}, { locale }), ButtonStyle.Secondary, icon('rpgDef')),
        button(actId(ownerId, version, 'pot'), m.rpg_fight_btn_potion({ count: state.potions }, { locale }), ButtonStyle.Success, icon('rpgPotion'), state.potions === 0),
      ));
      if (state.skills.length > 0) {
        components.push(row(...state.skills.slice(0, 5).map((skill) => {
          const remaining = foe.cooldowns[skill.id] ?? 0;
          return button(
            actId(ownerId, version, `s-${skill.id}`),
            remaining > 0 ? `${skill.name} (${remaining})` : skill.name,
            ButtonStyle.Success,
            skill.emoji,
            remaining > 0,
          );
        })));
      }
      break;
    }

    case 'LOOT': {
      const loot = state.pendingLoot!;
      const current = state.gear[loot.slot];
      textBlock(container, [
        `### ${m.tower_loot_title({ slot: slotLabel(loot.slot, locale) }, { locale })}`,
        `**${m.tower_loot_new({}, { locale })}** ${gearLine(loot, locale)}`,
        `**${m.tower_loot_current({}, { locale })}** ${gearLine(current, locale)}`,
      ].join('\n'));
      components.push(row(
        button(actId(ownerId, version, 'eq'), m.tower_btn_equip({}, { locale }), ButtonStyle.Success, '✅'),
        button(actId(ownerId, version, 'ds'), m.tower_btn_scrap({ gold: scrapValue(run.floor) }, { locale }), ButtonStyle.Secondary, '♻️'),
      ));
      break;
    }

    case 'BLESSING': {
      const choices = state.blessingChoices
        .map((id) => findBlessing(id))
        .filter((blessing): blessing is NonNullable<typeof blessing> => blessing !== null);
      textBlock(container, [
        `### ${m.tower_blessing_title({}, { locale })}`,
        ...choices.map((blessing) => {
          const rank = state.blessings[blessing.id] ?? 0;
          return `${blessing.emoji} **${blessing.name}** (${rank}/${blessing.maxRank}) — ${blessing.description}`;
        }),
      ].join('\n'));
      components.push(row(...choices.map((blessing, index) =>
        button(actId(ownerId, version, `b${index}`), blessing.name, ButtonStyle.Primary, blessing.emoji))));
      break;
    }

    case 'MERCHANT': {
      const offerLabel = (offer: TowerOffer) => {
        switch (offer.kind) {
          case 'POTION': return `🧪 ${m.tower_offer_potion({}, { locale })}`;
          case 'HEAL': return `❤️ ${m.tower_offer_heal({}, { locale })}`;
          default: return `${offer.gear.emoji} ${offer.gear.name}`;
        }
      };
      textBlock(container, [
        `### 🛒 ${m.tower_merchant_title({}, { locale })}`,
        ...state.merchant.map((offer) => {
          const detail = offer.kind === 'GEAR' ? ` · ${rarityIcon(offer.gear.rarity)} ${gearStats(offer.gear)}` : '';
          const price = offer.sold ? `~~${offer.price}~~ ${m.tower_offer_sold({}, { locale })}` : `**${offer.price}** 🪙`;
          return `${offerLabel(offer)}${detail} — ${price}`;
        }),
      ].join('\n'));
      components.push(row(
        ...state.merchant.map((offer, index) => button(
          actId(ownerId, version, `m${index}`),
          `${offer.kind === 'GEAR' ? offer.gear.name : offer.kind === 'POTION' ? m.tower_offer_potion({}, { locale }) : m.tower_offer_heal({}, { locale })} (${offer.price})`,
          ButtonStyle.Primary,
          undefined,
          offer.sold || state.gold < offer.price,
        )),
        button(actId(ownerId, version, 'ml'), m.tower_btn_leave_shop({}, { locale }), ButtonStyle.Secondary, '🚪'),
      ));
      break;
    }
  }

  return { embeds: [], components, container };
}

/** Bilan d'une ascension terminée. */
export async function buildTowerSettlementView(guildId: string, ownerId: string, locale: Locale, settlement: TowerSettlement): Promise<PanelView> {
  const [config, economy] = await Promise.all([getTowerConfig(guildId), getOrCreateEconomyConfig(guildId)]);
  const container = new ContainerBuilder().setAccentColor(settlement.outcome === 'DEAD' ? COLOR : RPG_COLORS.wild);

  const title = settlement.outcome === 'DEAD'
    ? m.tower_end_dead({}, { locale })
    : settlement.expired ? m.tower_end_expired({}, { locale }) : m.tower_end_left({}, { locale });

  const lines = [
    header(config, title),
    m.tower_end_summary({ floors: settlement.floorsCleared, kills: settlement.kills }, { locale }),
    m.tower_end_shards({ shards: settlement.shards, emoji: config.currencyEmoji, currency: config.currencyName }, { locale }),
  ];
  if (settlement.lostToDeath > 0) lines.push(`-# ${m.tower_end_lost_death({ shards: settlement.lostToDeath, percent: 100 - config.deathShardPercent }, { locale })}`);
  if (settlement.lostToCap > 0) lines.push(`-# ${m.tower_end_lost_cap({ shards: settlement.lostToCap }, { locale })}`);
  if (settlement.newBest) lines.push(`🏆 ${m.tower_end_new_best({ floors: settlement.floorsCleared }, { locale })}`);
  if (settlement.milestones.length > 0) {
    lines.push(`🎁 ${m.tower_end_milestones({}, { locale })}`);
    for (const reward of settlement.milestones) {
      const contents = rewardContents(reward, economy.currencyEmoji, config, locale);
      lines.push(`${reward.emoji} **${reward.name}**${contents ? ` — ${contents}` : ''}`);
    }
  }
  textBlock(container, lines.join('\n'));

  return {
    embeds: [],
    container,
    components: [row(
      button(`twr:enter:${ownerId}`, m.tower_btn_again({}, { locale }), ButtonStyle.Success, '🚪'),
      button(`twr:shop:${ownerId}:0`, m.tower_btn_shop({}, { locale }), ButtonStyle.Primary, icon('rpgShop')),
      button(`twr:top:${ownerId}`, m.tower_btn_leaderboard({}, { locale }), ButtonStyle.Secondary, '🏆'),
      button(`twr:home:${ownerId}`, m.tower_btn_home({}, { locale }), ButtonStyle.Secondary, icon('rpgBack')),
    )],
  };
}

function leaveConfirmView(config: TowerConfigView, ownerId: string, version: number, active: ActiveTowerRun, locale: Locale): PanelView {
  const container = new ContainerBuilder().setAccentColor(COLOR);
  textBlock(container, [
    header(config, m.tower_leave_title({}, { locale })),
    m.tower_leave_desc({ shards: active.state.shards, emoji: config.currencyEmoji, floors: active.state.floorsCleared }, { locale }),
  ].join('\n'));
  return {
    embeds: [],
    container,
    components: [row(
      button(`twr:quit:${ownerId}:${version}`, m.tower_btn_leave_confirm({}, { locale }), ButtonStyle.Danger, '🏳️'),
      button(`twr:run:${ownerId}`, m.tower_btn_continue({}, { locale }), ButtonStyle.Success, '🧗'),
    )],
  };
}

async function buildTowerShopView(guildId: string, ownerId: string, locale: Locale, page: number): Promise<PanelView> {
  const [config, shop, economy] = await Promise.all([getTowerConfig(guildId), getTowerShop(guildId, ownerId), getOrCreateEconomyConfig(guildId)]);
  const container = new ContainerBuilder().setAccentColor(RPG_COLORS.trade);
  textBlock(container, [
    header(config, m.tower_shop_title({}, { locale })),
    m.tower_shop_balance({ shards: shard(shop.profile.shards), emoji: config.currencyEmoji, currency: config.currencyName }, { locale }),
  ].join('\n'));
  separator(container);

  textBlock(container, `### ${m.tower_shop_upgrades_title({}, { locale })}\n-# ${m.tower_shop_upgrades_hint({}, { locale })}`);
  for (const key of TOWER_UPGRADE_KEYS) {
    const upgrade = TOWER_UPGRADES[key];
    const level = shop.upgrades[key];
    const maxed = level >= upgrade.maxLevel;
    const cost = towerUpgradeCost(key, level);
    container.addSectionComponents(new SectionBuilder()
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(
        `${upgrade.emoji} **${upgrade.name}** (${level}/${upgrade.maxLevel})\n-# ${upgrade.description}`,
      ))
      .setButtonAccessory(button(
        `twr:upg:${ownerId}:${key}:${page}`,
        maxed ? m.tower_shop_maxed({}, { locale }) : `${cost} ${config.currencyEmoji}`,
        ButtonStyle.Success,
        undefined,
        maxed || shop.profile.shards < cost,
      )));
  }

  separator(container);
  textBlock(container, `### ${m.tower_shop_rewards_title({}, { locale })}`);
  const pageCount = Math.max(1, Math.ceil(shop.rewards.length / REWARDS_PER_PAGE));
  const current = Math.min(Math.max(0, page), pageCount - 1);
  const shown = shop.rewards.slice(current * REWARDS_PER_PAGE, (current + 1) * REWARDS_PER_PAGE);
  if (shown.length === 0) textBlock(container, `*${m.tower_shop_empty({}, { locale })}*`);
  for (const reward of shown) {
    const owned = !reward.repeatable && shop.profile.claimedRewardIds.includes(reward.id);
    const contents = rewardContents(reward, economy.currencyEmoji, config, locale);
    container.addSectionComponents(new SectionBuilder()
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(truncate(
        [`${reward.emoji} **${reward.name}**`, contents || null, reward.description ? `-# ${reward.description}` : null]
          .filter((line): line is string => line !== null)
          .join('\n'),
        500,
      )))
      .setButtonAccessory(button(
        `twr:buy:${ownerId}:${reward.id}:${current}`,
        owned ? m.tower_shop_owned({}, { locale }) : `${reward.price} ${config.currencyEmoji}`,
        ButtonStyle.Success,
        undefined,
        owned || shop.profile.shards < reward.price,
      )));
  }

  const next = shop.milestones.filter((reward) => !shop.profile.claimedRewardIds.includes(reward.id)).slice(0, 3);
  if (next.length > 0) {
    separator(container);
    textBlock(container, [
      `### ${m.tower_shop_milestones_title({}, { locale })}`,
      ...next.map((reward) => {
        const contents = rewardContents(reward, economy.currencyEmoji, config, locale);
        const line = m.tower_shop_milestone_line({ emoji: reward.emoji, name: reward.name, floor: reward.floor }, { locale });
        return contents ? `${line}\n-# ${contents}` : line;
      }),
    ].join('\n'));
  }

  const nav: ButtonBuilder[] = [];
  if (pageCount > 1) {
    nav.push(
      button(`twr:shop:${ownerId}:${current - 1}`, m.rpg_shop_prev({}, { locale }), ButtonStyle.Secondary, undefined, current <= 0),
      button(`twr:shop:${ownerId}:${current + 1}:n`, m.rpg_shop_next({}, { locale }), ButtonStyle.Secondary, undefined, current >= pageCount - 1),
    );
  }
  nav.push(button(`twr:home:${ownerId}`, m.tower_btn_home({}, { locale }), ButtonStyle.Secondary, icon('rpgBack')));
  return { embeds: [], container, components: [row(...nav)] };
}

function shard(value: number): string {
  return value.toLocaleString('fr-FR');
}

async function buildTowerLeaderboardView(guildId: string, ownerId: string, locale: Locale): Promise<PanelView> {
  const [config, top, profile] = await Promise.all([
    getTowerConfig(guildId),
    getTowerLeaderboard(guildId, 10),
    getOrCreateTowerProfile(guildId, ownerId),
  ]);
  const medals = ['🥇', '🥈', '🥉'];
  const container = new ContainerBuilder().setAccentColor(COLOR);
  const lines = top.map((entry, index) =>
    `${medals[index] ?? `**${index + 1}.**`} <@${entry.userId}> — ${m.tower_top_floors({ floors: entry.bestFloor }, { locale })}`);

  textBlock(container, [
    header(config, m.tower_top_title({}, { locale })),
    config.seasonStartedAt.getTime() > 0 ? `-# ${m.tower_top_season({ when: `<t:${Math.floor(config.seasonStartedAt.getTime() / 1000)}:D>` }, { locale })}` : null,
    '',
    lines.length > 0 ? lines.join('\n') : `*${m.tower_top_empty({}, { locale })}*`,
    '',
    m.tower_top_you({ floors: profile.bestFloor }, { locale }),
  ].filter((line): line is string => line !== null).join('\n'));

  return { embeds: [], container, components: [row(button(`twr:home:${ownerId}`, m.tower_btn_home({}, { locale }), ButtonStyle.Secondary, icon('rpgBack')))] };
}

// ─────────────────────────────────────────────────────────────
// Dispatch
// ─────────────────────────────────────────────────────────────

function parseActionCode(code: string): TowerAction | null {
  if (code === 'atk') return { type: 'attack' };
  if (code === 'def') return { type: 'defend' };
  if (code === 'pot') return { type: 'potion' };
  if (code === 'eq') return { type: 'equip' };
  if (code === 'ds') return { type: 'discard' };
  if (code === 'ml') return { type: 'leave_shop' };
  if (code.startsWith('s-')) return { type: 'skill', id: code.slice(2) };
  const index = Number.parseInt(code.slice(1), 10);
  if (!Number.isInteger(index) || index < 0 || index > 4) return null;
  if (code.startsWith('d')) return { type: 'door', index };
  if (code.startsWith('b')) return { type: 'bless', index };
  if (code.startsWith('m')) return { type: 'buy', index };
  return null;
}

/** Écran courant : la partie en cours s'il y en a une, sinon l'accueil. */
async function currentView(client: Client, guildId: string, ownerId: string, locale: Locale): Promise<PanelView> {
  const { active, expired } = await getActiveTowerRun(client, guildId, ownerId);
  if (active) return buildTowerRunView(guildId, ownerId, locale, active);
  if (expired) return buildTowerSettlementView(guildId, ownerId, locale, expired);
  return buildTowerHomeView(client, guildId, ownerId, locale);
}

async function handleRefusal(
  interaction: ButtonInteraction,
  guildId: string,
  ownerId: string,
  locale: Locale,
  refusal: TowerRefusal,
): Promise<void> {
  const config = await getTowerConfig(guildId);
  const text = towerRefusalText(refusal, config, locale);
  await respond(interaction, withNote(await currentView(interaction.client, guildId, ownerId, locale), text));
}

export async function handleTowerButton(client: Client, customId: string, interaction: ButtonInteraction): Promise<void> {
  const route = parseTowerRoute(customId);
  if (!route || !interaction.guildId) return;
  const locale = await getEffectiveLocale(interaction);
  if (!(await ensureOwner(interaction, route.ownerId, locale))) return;
  const guildId = interaction.guildId;
  const { action, ownerId, rest } = route;

  try {
    await interaction.deferUpdate();

    switch (action) {
      case 'home': await respond(interaction, await buildTowerHomeView(client, guildId, ownerId, locale)); return;
      case 'run': await respond(interaction, await currentView(client, guildId, ownerId, locale)); return;
      case 'enter': {
        const active = await startTowerRun(client, guildId, ownerId);
        await respond(interaction, await buildTowerRunView(guildId, ownerId, locale, active));
        return;
      }
      case 'a': {
        const version = Number.parseInt(rest[0] ?? '', 10);
        const towerAction = parseActionCode(rest.slice(1).join(':'));
        if (!Number.isInteger(version) || !towerAction) return;
        const result = await actTowerRun(client, guildId, ownerId, version, towerAction);
        if (result.settlement) {
          await respond(interaction, await buildTowerSettlementView(guildId, ownerId, locale, result.settlement));
        } else if (result.active) {
          await respond(interaction, await buildTowerRunView(guildId, ownerId, locale, result.active));
        }
        return;
      }
      case 'quitask': {
        const version = Number.parseInt(rest[0] ?? '', 10);
        const { active } = await getActiveTowerRun(client, guildId, ownerId);
        if (!active || active.run.version !== version) throw new TowerRefused({ kind: 'stale' });
        if (active.state.phase === 'COMBAT') throw new TowerRefused({ kind: 'in_combat' });
        await respond(interaction, leaveConfirmView(await getTowerConfig(guildId), ownerId, version, active, locale));
        return;
      }
      case 'quit': {
        const version = Number.parseInt(rest[0] ?? '', 10);
        const settlement = await abandonTowerRun(client, guildId, ownerId, version);
        await respond(interaction, await buildTowerSettlementView(guildId, ownerId, locale, settlement));
        return;
      }
      case 'shop': await respond(interaction, await buildTowerShopView(guildId, ownerId, locale, Number.parseInt(rest[0] ?? '0', 10) || 0)); return;
      case 'buy': {
        const reward = await buyTowerReward(client, guildId, ownerId, rest[0] ?? '');
        const view = await buildTowerShopView(guildId, ownerId, locale, Number.parseInt(rest[1] ?? '0', 10) || 0);
        await respond(interaction, withNote(view, m.tower_shop_bought({ emoji: reward.emoji, name: reward.name }, { locale })));
        return;
      }
      case 'upg': {
        const key = rest[0] as TowerUpgradeKey;
        const level = await buyTowerUpgrade(guildId, ownerId, key);
        const view = await buildTowerShopView(guildId, ownerId, locale, Number.parseInt(rest[1] ?? '0', 10) || 0);
        await respond(interaction, withNote(view, m.tower_shop_upgraded({ name: TOWER_UPGRADES[key]?.name ?? key, level }, { locale })));
        return;
      }
      case 'top': await respond(interaction, await buildTowerLeaderboardView(guildId, ownerId, locale)); return;
      default: return;
    }
  } catch (err) {
    if (err instanceof TowerRefused) {
      await handleRefusal(interaction, guildId, ownerId, locale, err.refusal).catch((inner) => replyPanelError(interaction, inner, locale));
      return;
    }
    await replyPanelError(interaction, err, locale);
  }
}
