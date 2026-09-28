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
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  SectionBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
  type ButtonInteraction,
  type Client,
} from 'discord.js';
import { truncate } from '../../../utils/embeds.js';
import { rankEmoji } from '../../../utils/emojis.js';
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
import {
  TRIAL_WAVES,
  combatStats,
  floorModifier,
  towerLevel,
  towerStats,
  type TowerAction,
  type TowerLockProgress,
  type TowerLogEntry,
  type TowerMapState,
  type TowerMove,
  type TowerNotice,
  type TowerRoomInfo,
  type TowerState,
} from './rpgTowerEngine.js';
import {
  exitLocks,
  exitRoom,
  floorLayout,
  isExitRoom,
  occupancy,
  visibleRooms,
  type TowerDirection,
  type TowerExitType,
  type TowerFloorModifier,
  type TowerLayout,
  type TowerRoomType,
} from './rpgTowerMap.js';
import {
  blacksmithPrice,
  mercenaryPrice,
  type TowerBossMechanic,
  type TowerEventId,
  type TowerRelicPerk,
  type TowerTrait,
} from './rpgTowerContent.js';
import { TOWER_IMAGE_FILENAME, renderTowerImage, type TowerLadderEntry } from './rpgTowerRender.js';
import {
  MAX_POTIONS,
  TOWER_GEAR_SLOTS,
  findBlessing,
  scrapValue,
  settleShards,
  towerRerollPrice,
  towerUpgradeCost,
  type TowerDoor,
  type TowerGear,
  type TowerGearSlot,
  type TowerMerchantSettings,
  type TowerOffer,
  type TowerUpgradeDef,
  type TowerUpgradeEffect,
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
  getTowerDailyLeaderboard,
  getTowerLeaderboard,
  hasPlayedDaily,
  getTowerShop,
  isTowerOpen,
  previewTowerEntry,
  startTowerRun,
  takePendingTowerSettlement,
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

// Un emoji laissé vide au dashboard prend l'icône du bot : la Tour n'impose aucun emoji Unicode.
function towerIcon(config: TowerConfigView): string {
  return config.emoji || icon('rpgTower');
}

function shardIcon(config: TowerConfigView): string {
  return config.currencyEmoji || icon('rpgShard');
}

const BUTTON_EMOJI = /^(?:<a?:\w+:\d+>|\p{Extended_Pictographic}(?:\uFE0F|\u200D|\p{Extended_Pictographic}|\p{Emoji_Modifier})*)$/u;

/**
 * Emoji de la monnaie posé sur un bouton. Le champ est libre au dashboard : un texte qui n'est
 * pas un emoji ferait rejeter tout le message par Discord, là où il ne gênait pas dans un libellé.
 */
function shardButtonEmoji(config: TowerConfigView): string {
  return BUTTON_EMOJI.test(config.currencyEmoji) ? config.currencyEmoji : icon('rpgShard');
}

function foeIcon(foe: { emoji: string; kind?: string }): string {
  return foe.emoji || icon(foe.kind === 'BOSS' ? 'rpgBoss' : 'rpgFight');
}

function rewardIcon(reward: { emoji: string; kind: string }): string {
  return reward.emoji || icon(reward.kind === 'MILESTONE' ? 'trophy' : 'rpgDaily');
}

function header(config: TowerConfigView, subtitle?: string): string {
  return `## ${towerIcon(config)} ${config.name}${subtitle ? ` · ${subtitle}` : ''}`;
}

// ─────────────────────────────────────────────────────────────
// Libellés
// ─────────────────────────────────────────────────────────────

const DOOR_ICON: Record<TowerDoor, string> = {
  COMBAT: 'rpgFight',
  ELITE: 'rpgBoss',
  TREASURE: 'rpgChest',
  CAMPFIRE: 'rpgRest',
  MERCHANT: 'rpgShop',
  EVENT: 'rpgMap',
  BOSS: 'crown',
};

function doorLabel(door: TowerDoor, locale: Locale): string {
  switch (door) {
    case 'COMBAT': return m.tower_door_combat({}, { locale });
    case 'ELITE': return m.tower_door_elite({}, { locale });
    case 'TREASURE': return m.tower_door_treasure({}, { locale });
    case 'CAMPFIRE': return m.tower_door_campfire({}, { locale });
    case 'MERCHANT': return m.tower_door_merchant({}, { locale });
    case 'EVENT': return m.tower_door_event({}, { locale });
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
    case 'EVENT': return m.tower_door_event_desc({}, { locale });
    default: return m.tower_door_boss_desc({}, { locale });
  }
}

const ROOM_ICON: Record<TowerRoomType, string> = {
  START: 'rpgDoor',
  MONSTER: 'rpgFight',
  ELITE: 'rpgBoss',
  BOSS: 'crown',
  STAIRS: 'rpgUp',
  TRIAL: 'rpgWar',
  GATE: 'rpgTower',
  SEAL: 'rpgShard',
  CHEST: 'rpgChest',
  CAMPFIRE: 'rpgRest',
  MERCHANT: 'rpgShop',
  SHRINE: 'rpgEnchant',
  EVENT: 'rpgMap',
  // Une mimique se présente comme un coffre : rien ne la trahit avant qu'on l'ouvre.
  MIMIC: 'rpgChest',
  MERCENARY: 'rpgClan',
  TRAP: 'warning',
  WARP_A: 'rpgTravel',
  WARP_B: 'rpgTravel',
  EMPTY: 'dot',
};

/**
 * Glyphes de la mini-carte. Elle reste en Unicode : un emoji d'application pèse une trentaine
 * de caractères, et une grille de 12×12 dépasserait la limite de texte d'un message.
 */
const MINIMAP_GLYPH: Record<Exclude<TowerRoomType, 'MIMIC'>, string> = {
  START: '🚪',
  MONSTER: '👹',
  ELITE: '💀',
  BOSS: '👑',
  CHEST: '💰',
  CAMPFIRE: '🔥',
  MERCHANT: '🛒',
  SHRINE: '✨',
  EVENT: '？',
  STAIRS: '⇧',
  TRIAL: 'Ｔ',
  GATE: 'Ｇ',
  SEAL: '◎',
  WARP_A: 'Ａ',
  WARP_B: 'Ｂ',
  MERCENARY: 'Ｍ',
  TRAP: '▲',
  EMPTY: '⬜',
};

/** Ce que le joueur croit voir : une mimique passe pour un coffre. */
function disguised(type: TowerRoomType): Exclude<TowerRoomType, 'MIMIC'> {
  return type === 'MIMIC' ? 'CHEST' : type;
}

const DIRECTION_ICON: Record<TowerDirection, string> = { N: 'rpgUp', E: 'rpgNext', S: 'rpgDown', W: 'rpgPrev', WARP: 'rpgTravel' };

function roomLabel(type: TowerRoomType, locale: Locale): string {
  switch (disguised(type)) {
    case 'START': return m.tower_room_start({}, { locale });
    case 'MONSTER': return doorLabel('COMBAT', locale);
    case 'ELITE': return doorLabel('ELITE', locale);
    case 'BOSS': return doorLabel('BOSS', locale);
    case 'CHEST': return doorLabel('TREASURE', locale);
    case 'CAMPFIRE': return doorLabel('CAMPFIRE', locale);
    case 'MERCHANT': return doorLabel('MERCHANT', locale);
    case 'SHRINE': return m.tower_room_shrine({}, { locale });
    case 'EVENT': return doorLabel('EVENT', locale);
    case 'STAIRS': return m.tower_room_stairs({}, { locale });
    case 'TRIAL': return m.tower_room_trial({}, { locale });
    case 'GATE': return m.tower_room_gate({}, { locale });
    case 'SEAL': return m.tower_room_seal({}, { locale });
    case 'WARP_A': return m.tower_room_warp_a({}, { locale });
    case 'WARP_B': return m.tower_room_warp_b({}, { locale });
    case 'MERCENARY': return m.tower_room_mercenary({}, { locale });
    case 'TRAP': return m.tower_room_trap({}, { locale });
    default: return m.tower_room_empty({}, { locale });
  }
}

function roomDescription(type: TowerRoomType, locale: Locale, waves: number = TRIAL_WAVES): string {
  switch (disguised(type)) {
    case 'START': return m.tower_room_start_desc({}, { locale });
    case 'MONSTER': return doorDescription('COMBAT', locale);
    case 'ELITE': return doorDescription('ELITE', locale);
    case 'BOSS': return m.tower_room_boss_desc({}, { locale });
    case 'CHEST': return m.tower_room_chest_desc({}, { locale });
    case 'CAMPFIRE': return m.tower_room_campfire_desc({}, { locale });
    case 'MERCHANT': return doorDescription('MERCHANT', locale);
    case 'SHRINE': return m.tower_room_shrine_desc({}, { locale });
    case 'EVENT': return doorDescription('EVENT', locale);
    case 'STAIRS': return m.tower_room_stairs_desc({}, { locale });
    case 'TRIAL': return m.tower_room_trial_desc({ waves }, { locale });
    case 'GATE': return m.tower_room_gate_desc({}, { locale });
    case 'SEAL': return m.tower_room_seal_desc({}, { locale });
    case 'WARP_A':
    case 'WARP_B': return m.tower_room_warp_desc({}, { locale });
    case 'MERCENARY': return m.tower_room_mercenary_desc({}, { locale });
    case 'TRAP': return m.tower_room_trap_desc({}, { locale });
    default: return m.tower_room_empty_desc({}, { locale });
  }
}

/**
 * Carte de l'étage en emojis, en repli de l'image : salles restantes par type, salles faites en vert, murs en
 * noir, le joueur en personnage. Une ligne par rangée de la grille, 12 cases au plus.
 */
function miniMap(map: TowerMapState): string {
  const cells = occupancy(map.layout);
  const visible = visibleRooms(map.layout, map.pos, map.cleared);
  const rows: string[] = [];
  for (let y = 0; y < map.layout.height; y++) {
    let line = '';
    for (let x = 0; x < map.layout.width; x++) {
      const room = cells.get(`${x},${y}`);
      // Sous le brouillard, une salle inconnue se confond avec un mur.
      if (!room || (visible && !visible.has(room.id))) line += '⬛';
      else if (room.id === map.pos) line += '🧍';
      else if (map.cleared.includes(room.id) && room.type !== 'START' && room.type !== 'EMPTY') line += '🟩';
      else line += MINIMAP_GLYPH[disguised(room.type)];
    }
    rows.push(line);
  }
  return rows.join('\n');
}

/** État d'une sortie scellée : clés trouvées ou sceaux allumés, sur le total. */
function exitStatus(type: TowerRoomType, layout: TowerLayout, cleared: readonly string[], locale: Locale): string {
  const locks = exitLocks(layout, cleared);
  if (type === 'STAIRS') {
    return locks.keysFound < locks.keysNeeded
      ? m.tower_exit_stairs_locked({ found: locks.keysFound, needed: locks.keysNeeded }, { locale })
      : m.tower_exit_open({}, { locale });
  }
  if (type === 'GATE') {
    return locks.sealsLit < locks.sealsNeeded
      ? m.tower_exit_gate_locked({ lit: locks.sealsLit, needed: locks.sealsNeeded }, { locale })
      : m.tower_exit_open({}, { locale });
  }
  return '';
}

function moveLine(move: TowerMove, info: TowerRoomInfo | undefined, map: TowerMapState, locale: Locale): string {
  const room = map.layout.rooms.find((candidate) => candidate.id === move.roomId);
  // Passer par un portail se lit comme un déplacement à part : on change de coin de l'étage.
  const status = move.direction === 'WARP'
    ? m.tower_move_warp({}, { locale })
    : move.cleared
      ? `*${m.tower_room_visited({}, { locale })}*`
      : roomDescription(move.type, locale, room?.waves);
  const extras = move.cleared ? [] : [
    // Les traits d'une mimique la trahiraient : on n'en dit rien.
    move.type === 'MIMIC' ? '' : roomInfoLine(info, locale),
    exitStatus(move.type, map.layout, map.cleared, locale),
    room?.key ? `${icon('rpgKey')} ${m.tower_room_holds_key({}, { locale })}` : '',
    room ? powerLine((room.powerPercent ?? 100) / 100, room.powerReward === true, locale) : '',
  ].filter(Boolean);
  return `${icon(DIRECTION_ICON[move.direction])} ${icon(ROOM_ICON[disguised(move.type)])} **${roomLabel(move.type, locale)}** — ${status}${extras.length > 0 ? `\n-# ${extras.join(' · ')}` : ''}`;
}

function modifierName(modifier: TowerFloorModifier, locale: Locale): string {
  switch (modifier) {
    case 'FLOODED': return m.tower_modifier_flooded({}, { locale });
    case 'BURNING': return m.tower_modifier_burning({}, { locale });
    case 'BLESSED': return m.tower_modifier_blessed({}, { locale });
    default: return '';
  }
}

function modifierDescription(modifier: TowerFloorModifier, locale: Locale): string {
  switch (modifier) {
    case 'FLOODED': return m.tower_modifier_flooded_desc({}, { locale });
    case 'BURNING': return m.tower_modifier_burning_desc({}, { locale });
    case 'BLESSED': return m.tower_modifier_blessed_desc({}, { locale });
    default: return '';
  }
}

function exitName(exit: TowerExitType, locale: Locale): string {
  return exit === 'BOSS' ? doorLabel('BOSS', locale) : roomLabel(exit, locale);
}

/** Clé trouvée ou sceau allumé, à la suite d'un retour de victoire ou de coffre. */
function lockLine(lock: TowerLockProgress | null | undefined, locale: Locale): string {
  if (!lock) return '';
  return lock.kind === 'key'
    ? `\n> ${icon('rpgKey')} ${m.tower_notice_key({ done: lock.done, needed: lock.needed }, { locale })}`
    : `\n> ${icon('rpgShard')} ${m.tower_notice_seal({ done: lock.done, needed: lock.needed }, { locale })}`;
}

// ─────────────────────────────────────────────────────────────
// Traits, mécaniques, reliques et événements
// ─────────────────────────────────────────────────────────────

const TRAIT_ICON: Record<TowerTrait, string> = {
  ARMORED: 'rpgArmor',
  VAMPIRIC: 'rpgHp',
  SWIFT: 'rpgSpd',
  THORNY: 'shield',
  BERSERK: 'rpgAtk',
  REGENERATING: 'rpgRest',
};

function traitName(trait: TowerTrait, locale: Locale): string {
  switch (trait) {
    case 'ARMORED': return m.tower_trait_armored({}, { locale });
    case 'VAMPIRIC': return m.tower_trait_vampiric({}, { locale });
    case 'SWIFT': return m.tower_trait_swift({}, { locale });
    case 'THORNY': return m.tower_trait_thorny({}, { locale });
    case 'BERSERK': return m.tower_trait_berserk({}, { locale });
    default: return m.tower_trait_regenerating({}, { locale });
  }
}

function traitDescription(trait: TowerTrait, locale: Locale): string {
  switch (trait) {
    case 'ARMORED': return m.tower_trait_armored_desc({}, { locale });
    case 'VAMPIRIC': return m.tower_trait_vampiric_desc({}, { locale });
    case 'SWIFT': return m.tower_trait_swift_desc({}, { locale });
    case 'THORNY': return m.tower_trait_thorny_desc({}, { locale });
    case 'BERSERK': return m.tower_trait_berserk_desc({}, { locale });
    default: return m.tower_trait_regenerating_desc({}, { locale });
  }
}

function mechanicName(mechanic: TowerBossMechanic, locale: Locale): string {
  switch (mechanic) {
    case 'SHIELD': return m.tower_mechanic_shield({}, { locale });
    case 'SUMMONER': return m.tower_mechanic_summoner({}, { locale });
    default: return m.tower_mechanic_phases({}, { locale });
  }
}

function mechanicDescription(mechanic: TowerBossMechanic, locale: Locale): string {
  switch (mechanic) {
    case 'SHIELD': return m.tower_mechanic_shield_desc({}, { locale });
    case 'SUMMONER': return m.tower_mechanic_summoner_desc({}, { locale });
    default: return m.tower_mechanic_phases_desc({}, { locale });
  }
}

function perkName(perk: TowerRelicPerk, locale: Locale): string {
  switch (perk) {
    case 'FIRST_STRIKE': return m.tower_perk_first_strike({}, { locale });
    case 'LAST_STAND': return m.tower_perk_last_stand({}, { locale });
    case 'EXECUTE': return m.tower_perk_execute({}, { locale });
    case 'GUARDIAN_POTION': return m.tower_perk_guardian_potion({}, { locale });
    default: return m.tower_perk_shard_seeker({}, { locale });
  }
}

function perkDescription(perk: TowerRelicPerk, locale: Locale): string {
  switch (perk) {
    case 'FIRST_STRIKE': return m.tower_perk_first_strike_desc({}, { locale });
    case 'LAST_STAND': return m.tower_perk_last_stand_desc({}, { locale });
    case 'EXECUTE': return m.tower_perk_execute_desc({}, { locale });
    case 'GUARDIAN_POTION': return m.tower_perk_guardian_potion_desc({}, { locale });
    default: return m.tower_perk_shard_seeker_desc({}, { locale });
  }
}

function eventTitle(id: TowerEventId, locale: Locale): string {
  switch (id) {
    case 'BLOOD_ALTAR': return m.tower_event_blood_altar({}, { locale });
    case 'GAMBLER': return m.tower_event_gambler({}, { locale });
    case 'SPRING': return m.tower_event_spring({}, { locale });
    case 'BLACKSMITH': return m.tower_event_blacksmith({}, { locale });
    default: return m.tower_event_cursed_pact({}, { locale });
  }
}

function eventDescription(id: TowerEventId, level: number, locale: Locale): string {
  switch (id) {
    case 'BLOOD_ALTAR': return m.tower_event_blood_altar_desc({}, { locale });
    case 'GAMBLER': return m.tower_event_gambler_desc({}, { locale });
    case 'SPRING': return m.tower_event_spring_desc({}, { locale });
    case 'BLACKSMITH': return m.tower_event_blacksmith_desc({ price: blacksmithPrice(level) }, { locale });
    default: return m.tower_event_cursed_pact_desc({}, { locale });
  }
}

/** Libellés des deux options d'un événement : le pari, puis l'option sans risque. */
function eventOptions(id: TowerEventId, level: number, locale: Locale): [string, string] {
  const leave = m.tower_event_leave({}, { locale });
  switch (id) {
    case 'BLOOD_ALTAR': return [m.tower_event_blood_altar_opt({}, { locale }), leave];
    case 'GAMBLER': return [m.tower_event_gambler_opt({}, { locale }), leave];
    case 'SPRING': return [m.tower_event_spring_opt_heal({}, { locale }), m.tower_event_spring_opt_potion({}, { locale })];
    case 'BLACKSMITH': return [m.tower_event_blacksmith_opt({ price: blacksmithPrice(level) }, { locale }), leave];
    default: return [m.tower_event_cursed_pact_opt({}, { locale }), leave];
  }
}

/** Issue d'un événement, pour la ligne de retour en tête de l'écran suivant. */
function eventOutcome(notice: Extract<TowerNotice, { k: 'event' }>, locale: Locale): string {
  const coin = icon('coins');
  if (notice.option === 1 && notice.id !== 'SPRING') return m.tower_event_result_leave({}, { locale });
  switch (notice.id) {
    case 'BLOOD_ALTAR': return m.tower_event_result_blood_altar({ hp: notice.amount }, { locale });
    case 'GAMBLER': return notice.won
      ? m.tower_event_result_gambler_won({ gold: notice.amount, coin }, { locale })
      : m.tower_event_result_gambler_lost({ gold: notice.amount, coin }, { locale });
    case 'SPRING': return notice.option === 0
      ? m.tower_event_result_spring_heal({ hp: notice.amount }, { locale })
      : m.tower_event_result_spring_potion({}, { locale });
    case 'BLACKSMITH': return m.tower_event_result_blacksmith({ name: notice.item ?? '', gold: notice.amount, coin }, { locale });
    default: return m.tower_event_result_cursed_pact({ gold: notice.amount, coin }, { locale });
  }
}

/** Adversaire renforcé ou affaibli par la carte, et si ses récompenses suivent. */
function powerLine(power: number, reward: boolean, locale: Locale): string {
  if (power === 1) return '';
  const factor = `×${power}`;
  const line = power > 1
    ? `${icon('warning')} ${m.tower_room_power_up({ factor }, { locale })}`
    : m.tower_room_power_down({ factor }, { locale });
  return reward ? `${line} · ${m.tower_room_power_reward({ factor }, { locale })}` : line;
}

/** Ce qu'on sait d'une salle ou d'une porte avant d'y entrer : traits, mécanique, événement. */
function roomInfoLine(info: TowerRoomInfo | undefined | null, locale: Locale): string {
  if (!info) return '';
  const parts = info.traits.map((trait) => `${icon(TRAIT_ICON[trait])} ${traitName(trait, locale)}`);
  if (info.mechanic) parts.push(`${icon('crown')} ${mechanicName(info.mechanic, locale)}`);
  if (info.event) parts.push(`${icon('rpgMap')} ${eventTitle(info.event, locale)}`);
  return parts.join(' · ');
}

function slotLabel(slot: TowerGearSlot, locale: Locale): string {
  switch (slot) {
    case 'weapon': return m.tower_slot_weapon({}, { locale });
    case 'armor': return m.tower_slot_armor({}, { locale });
    default: return m.tower_slot_relic({}, { locale });
  }
}

const SLOT_ICON: Record<TowerGearSlot, string> = { weapon: 'rpgSword', armor: 'rpgArmor', relic: 'rpgAccessory' };

function gearStats(gear: TowerGear, locale: Locale): string {
  const parts: string[] = [];
  if (gear.attack) parts.push(`${icon('rpgAtk')} +${gear.attack}`);
  if (gear.defense) parts.push(`${icon('rpgDef')} +${gear.defense}`);
  if (gear.maxHealth) parts.push(`${icon('rpgHp')} +${gear.maxHealth}`);
  if (gear.speed) parts.push(`${icon('rpgSpd')} +${gear.speed}`);
  if (gear.critChance) parts.push(`${icon('rpgCrit')} +${percent(gear.critChance)}`);
  if (gear.lifesteal) parts.push(m.tower_stat_lifesteal({ value: percent(gear.lifesteal) }, { locale }));
  if (gear.thorns) parts.push(m.tower_stat_thorns({ value: percent(gear.thorns) }, { locale }));
  if (gear.armorPiercing) parts.push(m.tower_stat_piercing({ value: percent(gear.armorPiercing) }, { locale }));
  return parts.join(' · ');
}

function gearLine(gear: TowerGear | null, locale: Locale): string {
  if (!gear) return `*${m.tower_slot_empty({}, { locale })}*`;
  const perk = gear.perk ? `\n-# ${icon('star')} **${perkName(gear.perk, locale)}** — ${perkDescription(gear.perk, locale)}` : '';
  return `${rarityIcon(gear.rarity)} ${icon(SLOT_ICON[gear.slot])} **${gear.name}** · ${gearStats(gear, locale)}${perk}`;
}

const GEAR_DIFF_KEYS = ['attack', 'defense', 'maxHealth', 'speed', 'critChance', 'lifesteal', 'thorns', 'armorPiercing'] as const;

/** Écart entre la pièce proposée et celle portée, stat par stat : seules les différences s'affichent. */
function gearDiff(next: TowerGear, current: TowerGear | null, locale: Locale): string {
  const parts: string[] = [];
  for (const key of GEAR_DIFF_KEYS) {
    const delta = next[key] - (current?.[key] ?? 0);
    if (Math.abs(delta) < 1e-9) continue;
    const sign = delta > 0 ? '+' : '−';
    const flat = key === 'attack' || key === 'defense' || key === 'maxHealth' || key === 'speed';
    const value = flat ? String(Math.abs(delta)) : percent(Math.abs(delta));
    switch (key) {
      case 'attack': parts.push(`${icon('rpgAtk')} ${sign}${value}`); break;
      case 'defense': parts.push(`${icon('rpgDef')} ${sign}${value}`); break;
      case 'maxHealth': parts.push(`${icon('rpgHp')} ${sign}${value}`); break;
      case 'speed': parts.push(`${icon('rpgSpd')} ${sign}${value}`); break;
      case 'critChance': parts.push(`${icon('rpgCrit')} ${sign}${value}`); break;
      case 'lifesteal': parts.push(m.tower_diff_lifesteal({ value: `${sign}${value}` }, { locale })); break;
      case 'thorns': parts.push(m.tower_diff_thorns({ value: `${sign}${value}` }, { locale })); break;
      default: parts.push(m.tower_diff_piercing({ value: `${sign}${value}` }, { locale })); break;
    }
  }
  return parts.join(' · ');
}

/** Nom d'une bénédiction dans la langue du joueur ; le catalogue ne garde que le français. */
function blessingName(id: string, locale: Locale): string {
  switch (id) {
    case 'might': return m.tower_blessing_might({}, { locale });
    case 'bulwark': return m.tower_blessing_bulwark({}, { locale });
    case 'vitality': return m.tower_blessing_vitality({}, { locale });
    case 'swift': return m.tower_blessing_swift({}, { locale });
    case 'keen': return m.tower_blessing_keen({}, { locale });
    case 'leech': return m.tower_blessing_leech({}, { locale });
    case 'thorns': return m.tower_blessing_thorns({}, { locale });
    case 'stoneskin': return m.tower_blessing_stoneskin({}, { locale });
    case 'piercing': return m.tower_blessing_piercing({}, { locale });
    case 'second_wind': return m.tower_blessing_second_wind({}, { locale });
    case 'greed': return m.tower_blessing_greed({}, { locale });
    case 'focus': return m.tower_blessing_focus({}, { locale });
    default: return findBlessing(id)?.name ?? id;
  }
}

function blessingDescription(id: string, locale: Locale): string {
  switch (id) {
    case 'might': return m.tower_blessing_might_desc({}, { locale });
    case 'bulwark': return m.tower_blessing_bulwark_desc({}, { locale });
    case 'vitality': return m.tower_blessing_vitality_desc({}, { locale });
    case 'swift': return m.tower_blessing_swift_desc({}, { locale });
    case 'keen': return m.tower_blessing_keen_desc({}, { locale });
    case 'leech': return m.tower_blessing_leech_desc({}, { locale });
    case 'thorns': return m.tower_blessing_thorns_desc({}, { locale });
    case 'stoneskin': return m.tower_blessing_stoneskin_desc({}, { locale });
    case 'piercing': return m.tower_blessing_piercing_desc({}, { locale });
    case 'second_wind': return m.tower_blessing_second_wind_desc({}, { locale });
    case 'greed': return m.tower_blessing_greed_desc({}, { locale });
    case 'focus': return m.tower_blessing_focus_desc({}, { locale });
    default: return findBlessing(id)?.description ?? '';
  }
}

/** Bénédictions de la partie, une par ligne, avec leur rang et leur effet. */
function blessingDetails(state: TowerState, locale: Locale): string[] {
  return Object.entries(state.blessings)
    .map(([id, rank]) => {
      const blessing = findBlessing(id);
      return blessing && rank > 0
        ? `-# ${icon(blessing.icon)} **${blessingName(id, locale)}** ${rank}/${blessing.maxRank} — ${blessingDescription(id, locale)}`
        : null;
    })
    .filter((line): line is string => line !== null);
}

/** « Étage 7 · Crypte », ou « Étage 7 » pour un étage sans nom. */
function floorTitle(floor: number, name: string, locale: Locale): string {
  return name ? m.tower_floor_named({ floor, name }, { locale }) : m.tower_floor({ floor }, { locale });
}

/** Échelle des étages autour du joueur : deux à venir, le sien, deux franchis. */
function towerLadder(state: TowerState, floor: number, config: TowerConfigView, locale: Locale): TowerLadderEntry[] {
  const floors = config.floors;
  const entries: TowerLadderEntry[] = [];
  for (let n = floor + 2; n >= Math.max(1, floor - 2); n--) {
    const name = n === floor ? state.map?.layout.name ?? '' : floorLayout(floors, n)?.name ?? '';
    entries.push({ label: floorTitle(n, name, locale), status: n === floor ? 'current' : n > floor ? 'next' : 'done' });
  }
  return entries;
}

/** Image de la tour pour l'écran de déplacement ; `null` si le rendu échoue. */
async function towerImage(state: TowerState, floor: number, config: TowerConfigView, locale: Locale): Promise<Buffer | null> {
  if (state.map) {
    const map = state.map;
    const visible = visibleRooms(map.layout, map.pos, map.cleared);
    const mimics = new Set(map.layout.rooms.filter((room) => room.type === 'MIMIC').map((room) => room.id));
    const badges = Object.fromEntries(Object.entries(map.rooms ?? {})
      .filter(([id]) => !mimics.has(id))
      .map(([id, info]) => [id, info.traits.length + (info.mechanic ? 1 : 0)] as const)
      .filter(([, count]) => count > 0));
    return renderTowerImage({
      kind: 'map',
      title: modifierName(map.layout.modifier ?? 'NONE', locale)
        ? `${floorTitle(floor, map.layout.name, locale)} · ${modifierName(map.layout.modifier ?? 'NONE', locale)}`
        : floorTitle(floor, map.layout.name, locale),
      layout: map.layout,
      pos: map.pos,
      cleared: map.cleared,
      targets: state.moves.filter((move) => !move.cleared).map((move) => move.roomId),
      ladder: towerLadder(state, floor, config, locale),
      visible: visible ? [...visible] : null,
      badges,
      keys: map.layout.rooms.filter((room) => room.key && !map.cleared.includes(room.id)).map((room) => room.id),
    });
  }
  return renderTowerImage({
    kind: 'shaft',
    title: config.name,
    floor,
    bossEvery: (state.rules ?? config).bossEvery,
    floorLabel: (value) => m.tower_floor({ floor: value }, { locale }),
  });
}

/** Marchand de la partie : réglages figés à l'entrée, sinon ceux du moment. */
function runMerchant(state: TowerState, config: TowerConfigView): TowerMerchantSettings {
  return state.rules?.merchant ?? config.merchant;
}

/** Ce qu'une récompense verse au profil RPG, sur une ligne. */
function rewardContents(reward: TowerRewardView, coinEmoji: string, config: TowerConfigView, locale: Locale): string {
  const parts: string[] = [];
  if (reward.coins > 0) parts.push(`${coinEmoji || icon('coins')} ${reward.coins}`);
  if (reward.xp > 0) parts.push(`${icon('rpgXp')} ${m.tower_reward_xp({ amount: reward.xp }, { locale })}`);
  if (reward.clanPoints > 0) parts.push(`${icon('rpgClan')} ${m.tower_reward_clan_points({ amount: reward.clanPoints }, { locale })}`);
  if (reward.itemName) parts.push(`${icon('rpgBag')} ${reward.itemName}`);
  if (reward.titleName) parts.push(`${icon('star')} ${m.tower_reward_title({ name: reward.titleName }, { locale })}`);
  if (reward.roleId) parts.push(`<@&${reward.roleId}>`);
  if (reward.shards > 0) parts.push(`${shardIcon(config)} ${reward.shards}`);
  return parts.join(' · ');
}

function logLine(entry: TowerLogEntry, encounter: { name: string; emoji: string; kind: string }, locale: Locale): string {
  const foe = { name: encounter.name, emoji: foeIcon(encounter) };
  const crit = (critical: boolean) => (critical ? m.rpg_fight_critical_suffix({}, { locale }) : '');
  switch (entry.k) {
    case 'attack': return m.rpg_fight_action_attack({ dmg: entry.dmg, crit: crit(entry.crit), name: foe.name }, { locale });
    case 'skill': return m.rpg_fight_action_skill({ emoji: entry.emoji, skill: entry.name, dmg: entry.dmg, crit: crit(entry.crit), name: foe.name }, { locale });
    case 'support': return m.rpg_fight_action_skill_support({ emoji: entry.emoji, skill: entry.name }, { locale });
    case 'defend': return entry.hp !== undefined
      ? `${icon('rpgDef')} ${m.tower_log_defend({ hp: entry.hp }, { locale })}`
      : m.rpg_fight_action_defend({}, { locale });
    case 'potion': return `${icon('rpgPotion')} ${m.tower_log_potion({ hp: entry.hp }, { locale })}`;
    case 'heal': return `${icon('rpgHp')} ${m.tower_log_heal({ hp: entry.hp }, { locale })}`;
    case 'monster':
      if (entry.parried) return `${icon('rpgDef')} ${m.tower_log_parried({ emoji: foe.emoji, name: foe.name, dmg: entry.dmg }, { locale })}`;
      if (entry.heavy) return `${icon('rpgBoss')} ${m.tower_log_heavy({ emoji: foe.emoji, name: foe.name, dmg: entry.dmg, crit: crit(entry.crit) }, { locale })}`;
      return m.rpg_fight_monster_turn_log({ emoji: foe.emoji, name: foe.name, dmg: entry.dmg, crit: crit(entry.crit) }, { locale });
    case 'evaded': return m.rpg_fight_monster_evaded({ emoji: foe.emoji, name: foe.name }, { locale });
    case 'dodged': return `${icon('rpgSpd')} ${m.tower_log_dodged({ emoji: foe.emoji, name: foe.name }, { locale })}`;
    case 'charge': return `${icon('rpgBoss')} ${m.tower_log_charge({ emoji: foe.emoji, name: foe.name }, { locale })}`;
    case 'enrage': return `${icon('rpgAtk')} ${m.tower_log_enrage({ emoji: foe.emoji, name: foe.name }, { locale })}`;
    case 'thorns': return m.rpg_fight_thorns_log({ dmg: entry.dmg, emoji: foe.emoji, name: foe.name }, { locale });
    case 'foeDodged': return `${icon('rpgSpd')} ${m.tower_log_foe_dodged({ emoji: foe.emoji, name: foe.name }, { locale })}`;
    case 'shield': return `${icon('shield')} ${m.tower_log_shield({ dmg: entry.dmg }, { locale })}`;
    case 'shieldBroken': return `${icon('shield')} **${m.tower_log_shield_broken({ emoji: foe.emoji, name: foe.name }, { locale })}**`;
    case 'summon': return `${icon('rpgBoss')} ${m.tower_log_summon({ emoji: foe.emoji, name: foe.name, count: entry.count }, { locale })}`;
    case 'dispel': return `${icon('rpgEnchant')} ${m.tower_log_dispel({}, { locale })}`;
    case 'phase': return `${icon('crown')} **${m.tower_log_phase({ emoji: foe.emoji, name: foe.name }, { locale })}**`;
    case 'regen': return `${icon('rpgRest')} ${m.tower_log_regen({ emoji: foe.emoji, name: foe.name, hp: entry.hp }, { locale })}`;
    case 'drain': return `${icon('rpgHp')} ${m.tower_log_drain({ emoji: foe.emoji, name: foe.name, hp: entry.hp }, { locale })}`;
    case 'spikes': return `${icon('shield')} ${m.tower_log_spikes({ dmg: entry.dmg }, { locale })}`;
    case 'lastStand': return `${icon('star')} **${m.tower_log_last_stand({}, { locale })}**`;
    case 'ally': return `${icon('rpgClan')} ${m.tower_log_ally({ dmg: entry.dmg, name: foe.name }, { locale })}`;
  }
}

function noticeLine(notice: TowerNotice | null, locale: Locale): string | null {
  if (!notice) return null;
  const gold = icon('coins');
  switch (notice.k) {
    case 'victory': {
      const foe = foeIcon({ emoji: notice.emoji });
      const line = notice.healed > 0
        ? m.tower_notice_victory_healed({ emoji: foe, name: notice.name, gold: notice.gold, coin: gold, hp: notice.healed }, { locale })
        : m.tower_notice_victory({ emoji: foe, name: notice.name, gold: notice.gold, coin: gold }, { locale });
      return notice.climbed
        ? `${line}\n> ${icon('rpgUp')} ${m.tower_notice_climbed({ floor: floorTitle(notice.climbed.floor, notice.climbed.name, locale) }, { locale })}`
        : `${line}${lockLine(notice.lock, locale)}`;
    }
    case 'treasure': return `${icon('rpgChest')} ${notice.gold > 0
      ? m.tower_notice_treasure({ gold: notice.gold, coin: gold }, { locale })
      : m.tower_notice_chest_item({}, { locale })}${lockLine(notice.lock, locale)}`;
    case 'wave': return `${icon('rpgWar')} ${m.tower_notice_wave({ wave: notice.wave, waves: notice.waves, gold: notice.gold, coin: gold }, { locale })}`;
    case 'exit': return `${icon('rpgUp')} ${m.tower_notice_exit({ exit: exitName(notice.exit, locale) }, { locale })}${notice.climbed
      ? `\n> ${m.tower_notice_climbed({ floor: floorTitle(notice.climbed.floor, notice.climbed.name, locale) }, { locale })}`
      : ''}`;
    case 'campfire': return `${icon('rpgRest')} ${m.tower_notice_campfire({ hp: notice.hp }, { locale })}`;
    case 'potion': return `${icon('rpgPotion')} ${m.tower_log_potion({ hp: notice.hp }, { locale })}`;
    case 'equipped': return `${icon('success')} ${m.tower_notice_equipped({ name: notice.name }, { locale })}`;
    case 'scrapped': return `${icon('rpgSell')} ${m.tower_notice_scrapped({ gold: notice.gold, coin: gold }, { locale })}`;
    case 'blessed': {
      const blessing = findBlessing(notice.id);
      return blessing ? `${icon('rpgEnchant')} ${m.tower_notice_blessed({ emoji: icon(blessing.icon), name: blessingName(blessing.id, locale), rank: notice.rank }, { locale })}` : null;
    }
    case 'bought': return `${icon('rpgShop')} ${m.tower_notice_bought({}, { locale })}`;
    case 'fled': return `${icon('rpgLeave')} ${m.tower_notice_fled({ gold: notice.gold, coin: gold }, { locale })}`;
    case 'rerolled': return `${icon('rpgRefresh')} ${m.tower_notice_rerolled({}, { locale })}`;
    case 'trap': return `${icon('warning')} ${notice.dodged
      ? m.tower_notice_trap_dodged({}, { locale })
      : m.tower_notice_trap({ hp: notice.dmg }, { locale })}`;
    case 'hired': return `${icon('rpgClan')} ${m.tower_notice_hired({ gold: notice.gold, coin: gold }, { locale })}`;
    case 'event': return `${icon('rpgMap')} ${eventOutcome(notice, locale)}`;
  }
}

export function towerRefusalText(refusal: TowerRefusal, config: TowerConfigView, locale: Locale): string {
  switch (refusal.kind) {
    case 'disabled': return m.tower_refused_disabled({}, { locale });
    case 'active_run': return m.tower_refused_active({}, { locale });
    case 'no_run': return m.tower_refused_no_run({}, { locale });
    case 'stale': return m.tower_refused_stale({}, { locale });
    case 'in_combat': return m.tower_refused_in_combat({}, { locale });
    case 'shards': return m.tower_refused_shards({ price: refusal.price, balance: refusal.balance, emoji: shardIcon(config) }, { locale });
    case 'owned': return m.tower_refused_owned({}, { locale });
    case 'unavailable': return m.tower_refused_unavailable({}, { locale });
    case 'upgrade_max': return m.tower_refused_upgrade_max({}, { locale });
    case 'daily_disabled': return m.tower_refused_daily_disabled({}, { locale });
    case 'daily_done': return m.tower_refused_daily_done({}, { locale });
    case 'action': {
      switch (refusal.reason) {
        case 'skill_cooldown': return m.tower_refused_cooldown({}, { locale });
        case 'no_potion': return m.tower_refused_no_potion({}, { locale });
        case 'hp_full': return m.tower_refused_hp_full({}, { locale });
        case 'no_gold': return m.tower_refused_no_gold({}, { locale });
        case 'sold_out': return m.tower_refused_sold_out({}, { locale });
        case 'potions_full': return m.tower_refused_potions_full({ max: MAX_POTIONS }, { locale });
        case 'no_flee': return m.tower_refused_no_flee({}, { locale });
        case 'no_reroll': return m.tower_refused_no_reroll({}, { locale });
        case 'no_gear': return m.tower_refused_no_gear({}, { locale });
        case 'stairs_locked': return m.tower_refused_stairs_locked({}, { locale });
        case 'gate_locked': return m.tower_refused_gate_locked({}, { locale });
        default: return m.tower_refused_stale({}, { locale });
      }
    }
  }
}

const UPGRADE_ICON: Record<TowerUpgradeEffect, string> = {
  POTION: 'rpgPotion',
  HEALTH: 'rpgHp',
  ATTACK: 'rpgAtk',
  DEFENSE: 'rpgDef',
  SPEED: 'rpgSpd',
  CRIT: 'rpgCrit',
  GOLD: 'coins',
};

function upgradeIcon(upgrade: TowerUpgradeDef): string {
  return upgrade.emoji || icon(UPGRADE_ICON[upgrade.effect]);
}

function upgradeName(upgrade: TowerUpgradeDef, locale: Locale): string {
  if (upgrade.name) return upgrade.name;
  switch (upgrade.effect) {
    case 'POTION': return m.tower_upgrade_name_potion({}, { locale });
    case 'HEALTH': return m.tower_upgrade_name_health({}, { locale });
    case 'ATTACK': return m.tower_upgrade_name_attack({}, { locale });
    case 'DEFENSE': return m.tower_upgrade_name_defense({}, { locale });
    case 'SPEED': return m.tower_upgrade_name_speed({}, { locale });
    case 'CRIT': return m.tower_upgrade_name_crit({}, { locale });
    default: return m.tower_upgrade_name_gold({}, { locale });
  }
}

function upgradeEffectText(effect: TowerUpgradeEffect, value: number, locale: Locale): string {
  switch (effect) {
    case 'POTION': return m.tower_upgrade_effect_potion({ value }, { locale });
    case 'HEALTH': return m.tower_upgrade_effect_health({ value }, { locale });
    case 'ATTACK': return m.tower_upgrade_effect_attack({ value }, { locale });
    case 'DEFENSE': return m.tower_upgrade_effect_defense({ value }, { locale });
    case 'SPEED': return m.tower_upgrade_effect_speed({ value }, { locale });
    case 'CRIT': return m.tower_upgrade_effect_crit({ value }, { locale });
    default: return m.tower_upgrade_effect_gold({ value }, { locale });
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
  const [profile, preview, dailyDone] = await Promise.all([
    getOrCreateTowerProfile(guildId, ownerId),
    previewTowerEntry(guildId, ownerId),
    config.dailyEnabled ? hasPlayedDaily(guildId, ownerId) : Promise.resolve(true),
  ]);

  const container = new ContainerBuilder().setAccentColor(COLOR);
  const rules = config.floors.length > 0
    ? m.tower_rules_map({ floors: config.floors.length }, { locale })
    : m.tower_rules_generated({}, { locale });
  textBlock(container, [
    header(config),
    config.description || m.tower_default_description({}, { locale }),
    `-# ${rules}`,
  ].join('\n'));

  // La tour vue de face, le record du joueur éclairé : on voit d'un coup jusqu'où il est monté.
  const files: NonNullable<PanelView['files']> = [];
  const image = await renderTowerImage({
    kind: 'shaft',
    title: config.name,
    floor: Math.max(1, profile.bestFloor),
    bossEvery: 0,
    floorLabel: (value) => m.tower_floor({ floor: value }, { locale }),
    panel: {
      title: m.tower_panel_record({ floors: profile.bestFloor }, { locale }),
      lines: [
        m.tower_panel_all_time({ floors: profile.bestFloorAllTime }, { locale }),
        m.tower_panel_runs({ runs: profile.totalRuns }, { locale }),
        m.tower_panel_shards({ shards: profile.shards, currency: config.currencyName }, { locale }),
      ],
    },
  });
  if (image) {
    files.push({ attachment: image, name: TOWER_IMAGE_FILENAME });
    container.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(
      new MediaGalleryItemBuilder({ media: { url: `attachment://${TOWER_IMAGE_FILENAME}` } }),
    ));
  }
  separator(container);

  textBlock(container, [
    `### ${m.tower_home_profile_title({}, { locale })}`,
    m.tower_home_profile_line({
      emoji: shardIcon(config),
      trophy: icon('trophy'),
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
    `${icon('rpgAtk')} **${s.attack}** · ${icon('rpgDef')} **${s.defense}** · ${icon('rpgSpd')} **${s.speed}** · ${icon('rpgHp')} **${s.maxHealth}** · ${icon('rpgCrit')} **${percent(s.critChance)}**`,
    `-# ${m.tower_home_main_stats({ atk: preview.main.attack, def: preview.main.defense, spd: preview.main.speed, hp: preview.main.maxHealth }, { locale })}`,
    [preview.className, preview.titleName ? m.tower_home_title({ title: preview.titleName }, { locale }) : null]
      .filter(Boolean).join(' · ') || null,
    m.tower_home_skills({ skills }, { locale }),
    `${icon('rpgPotion')} ${m.tower_home_potions({ count: preview.potions }, { locale })}`,
    preview.gold > 0 ? `${icon('coins')} ${m.tower_home_gold({ count: preview.gold }, { locale })}` : null,
  ].filter((line): line is string => Boolean(line)).join('\n'));

  const components: PanelRow[] = [
    row(
      active
        ? button(`twr:run:${ownerId}`, m.tower_btn_resume({ floor: active.run.floor }, { locale }), ButtonStyle.Success, icon('rpgDoor'))
        : button(`twr:enter:${ownerId}`, m.tower_btn_enter({}, { locale }), ButtonStyle.Success, icon('rpgDoor')),
      button(`twr:shop:${ownerId}:0`, m.tower_btn_shop({}, { locale }), ButtonStyle.Primary, icon('rpgShop')),
      button(`twr:top:${ownerId}`, m.tower_btn_leaderboard({}, { locale }), ButtonStyle.Secondary, icon('trophy')),
      ...(economy.rpgEnabled ? [button(`rpg:nav:${ownerId}:hub`, m.rpg_hub_btn_back({}, { locale }), ButtonStyle.Secondary, icon('rpgBack'))] : []),
    ),
  ];
  if (config.dailyEnabled) {
    textBlock(container, `-# ${icon('rpgDaily')} ${m.tower_home_daily_hint({}, { locale })}`);
    components.push(row(
      button(
        `twr:daily:${ownerId}`,
        dailyDone ? m.tower_btn_daily_done({}, { locale }) : m.tower_btn_daily({}, { locale }),
        ButtonStyle.Success,
        icon('rpgDaily'),
        dailyDone || active !== null,
      ),
      button(`twr:dtop:${ownerId}`, m.tower_btn_daily_top({}, { locale }), ButtonStyle.Secondary, icon('trophy')),
    ));
  }

  const view: PanelView = { embeds: [], components, container, files };
  // Partie close à l'ouverture de l'écran, ou plus tôt par le balayage en l'absence du joueur.
  const closed = expired ?? await takePendingTowerSettlement(guildId, ownerId);
  return closed ? withNote(view, m.tower_expired_note({ minutes: config.idleTimeoutMinutes, shards: closed.shards, emoji: shardIcon(config) }, { locale })) : view;
}

/**
 * Objectif de l'étage, toujours affiché : sous le brouillard, le joueur ne voit pas la sortie
 * avant d'en être proche, et doit savoir ce qu'il cherche et ce qu'il lui manque.
 */
function floorObjective(state: TowerState, locale: Locale): string | null {
  const map = state.map;
  const exit = map ? exitRoom(map.layout) : null;
  if (!map || !exit) return null;
  const locks = exitLocks(map.layout, map.cleared);
  switch (exit.type) {
    case 'STAIRS': return m.tower_objective_stairs({ found: locks.keysFound, needed: locks.keysNeeded }, { locale });
    case 'GATE': return m.tower_objective_gate({ lit: locks.sealsLit, needed: locks.sealsNeeded }, { locale });
    case 'TRIAL': return m.tower_objective_trial({ waves: exit.waves ?? TRIAL_WAVES }, { locale });
    default: return m.tower_objective_boss({}, { locale });
  }
}

function statusBlock(state: TowerState, floor: number, config: TowerConfigView, locale: Locale): string {
  // Les stats du combat : un étage inondé ralentit, autant l'afficher.
  const stats = combatStats(state);
  const blessings = Object.entries(state.blessings)
    .map(([id, rank]) => {
      const blessing = findBlessing(id);
      return blessing ? `${icon(blessing.icon)}${rank > 1 ? `×${rank}` : ''}` : null;
    })
    .filter(Boolean)
    .join(' ');

  const title = floorTitle(floor, state.map?.layout.name ?? '', locale);
  const objective = floorObjective(state, locale);
  return [
    header(config, title),
    objective ? `${icon('rpgMap')} ${objective}` : null,
    combatHpBar(state.hp, stats.maxHealth),
    `${icon('rpgAtk')} ${stats.attack} · ${icon('rpgDef')} ${stats.defense} · ${icon('rpgSpd')} ${stats.speed} · ${icon('rpgCrit')} ${percent(stats.critChance)}`,
    `${icon('coins')} ${state.gold} · ${icon('rpgPotion')} ${state.potions} · ${m.tower_run_shards({ shards: state.shards, emoji: shardIcon(config) }, { locale })}`,
    ...TOWER_GEAR_SLOTS.map((slot) => `-# ${icon(SLOT_ICON[slot])} ${slotLabel(slot, locale)} : ${state.gear[slot]?.name ?? '—'}`),
    blessings ? `-# ${m.tower_run_blessings({ list: blessings }, { locale })}` : null,
    state.safeLeave ? `-# ${icon('success')} ${m.tower_run_safe({}, { locale })}` : null,
    floorModifier(state) !== 'NONE'
      ? `-# ${icon('rpgMap')} **${modifierName(floorModifier(state), locale)}** : ${modifierDescription(floorModifier(state), locale)}`
      : null,
    state.ally ? `-# ${icon('rpgClan')} ${m.tower_run_ally({}, { locale })}` : null,
    (state.burned ?? 0) > 0 ? `-# ${icon('warning')} ${m.tower_run_burned({ hp: state.burned ?? 0 }, { locale })}` : null,
  ].filter((line): line is string => Boolean(line)).join('\n');
}

function actId(ownerId: string, version: number, code: string): string {
  return `twr:a:${ownerId}:${version}:${code}`;
}

function runControls(ownerId: string, state: TowerState, version: number, locale: Locale): ActionRowBuilder<ButtonBuilder> {
  const max = towerStats(state).maxHealth;
  return row(
    button(actId(ownerId, version, 'pot'), m.rpg_fight_btn_potion({ count: state.potions }, { locale }), ButtonStyle.Success, icon('rpgPotion'), state.potions === 0 || state.hp >= max),
    button(`twr:quitask:${ownerId}:${version}`, m.tower_btn_leave({}, { locale }), ButtonStyle.Danger, icon('rpgLeave')),
  );
}

/** Écran de la partie en cours, selon sa phase. */
export async function buildTowerRunView(guildId: string, ownerId: string, locale: Locale, active: ActiveTowerRun): Promise<PanelView> {
  const config = await getTowerConfig(guildId);
  const { run, state } = active;
  const version = run.version;
  const container = new ContainerBuilder().setAccentColor(COLOR);
  const components: PanelRow[] = [];
  const files: NonNullable<PanelView['files']> = [];
  const level = towerLevel(state, run.floor);

  textBlock(container, statusBlock(state, run.floor, config, locale));
  const notice = noticeLine(state.notice, locale);
  if (notice) textBlock(container, `> ${notice}`);
  separator(container);

  switch (state.phase) {
    case 'DOORS': {
      const image = await towerImage(state, run.floor, config, locale);
      if (image) {
        files.push({ attachment: image, name: TOWER_IMAGE_FILENAME });
        container.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(
          new MediaGalleryItemBuilder({ media: { url: `attachment://${TOWER_IMAGE_FILENAME}` } }),
        ));
      }
      if (state.map) {
        const moves = state.moves.slice(0, 5);
        // Repli sans image : la carte en emojis reste lisible.
        if (!image) textBlock(container, miniMap(state.map));
        const details = blessingDetails(state, locale);
        if (details.length > 0) textBlock(container, details.join('\n'));
        textBlock(container, [
          `### ${m.tower_moves_title({}, { locale })}`,
          ...moves.map((move) => moveLine(move, state.map?.rooms?.[move.roomId], state.map!, locale)),
        ].join('\n'));
        if (moves.length > 0) {
          // Une sortie encore scellée se voit mais ne se clique pas : il manque des clés ou des sceaux.
          const locks = exitLocks(state.map.layout, state.map.cleared);
          const sealed = (type: TowerRoomType) => (type === 'STAIRS' && locks.keysFound < locks.keysNeeded)
            || (type === 'GATE' && locks.sealsLit < locks.sealsNeeded);
          components.push(row(...moves.map((move, index) => button(
            actId(ownerId, version, `d${index}`),
            roomLabel(move.type, locale),
            move.cleared ? ButtonStyle.Secondary : isExitRoom(move.type) ? ButtonStyle.Danger : ButtonStyle.Primary,
            icon(DIRECTION_ICON[move.direction]),
            sealed(move.type),
          ))));
        }
        components.push(runControls(ownerId, state, version, locale));
        break;
      }
      const details = blessingDetails(state, locale);
      if (details.length > 0) textBlock(container, details.join('\n'));
      textBlock(container, [
        `### ${m.tower_doors_title({}, { locale })}`,
        ...state.doors.map((door, index) => {
          const known = roomInfoLine(state.doorInfo?.[index], locale);
          return `${icon(DOOR_ICON[door])} **${doorLabel(door, locale)}** — ${doorDescription(door, locale)}${known ? `\n-# ${known}` : ''}`;
        }),
      ].join('\n'));
      components.push(row(...state.doors.map((door, index) =>
        button(actId(ownerId, version, `d${index}`), doorLabel(door, locale), door === 'BOSS' ? ButtonStyle.Danger : ButtonStyle.Primary, icon(DOOR_ICON[door])))));
      components.push(runControls(ownerId, state, version, locale));
      break;
    }

    case 'COMBAT': {
      const foe = state.encounter!;
      const kind = foe.kind === 'BOSS' ? ` ${icon('crown')}` : foe.kind === 'ELITE' ? ` ${icon('rpgBoss')}` : '';
      const trial = state.trial
        ? `${icon('rpgWar')} **${m.tower_combat_trial({ wave: state.trial.wave, waves: state.trial.waves }, { locale })}**${state.trial.wave === state.trial.waves ? ` · ${m.tower_combat_trial_last({}, { locale })}` : ''}`
        : null;
      const enraged = foe.enraged ? ` · **${m.tower_combat_enraged({}, { locale })}**` : '';
      const log = foe.log.map((entry) => logLine(entry, foe, locale));
      const traits = (foe.traits ?? []).map((trait) => `${icon(TRAIT_ICON[trait])} **${traitName(trait, locale)}** : ${traitDescription(trait, locale)}`);
      const mechanic = foe.mechanic ? `${icon('crown')} **${mechanicName(foe.mechanic, locale)}** : ${mechanicDescription(foe.mechanic, locale)}` : null;
      const shield = (foe.shield ?? 0) > 0 ? `${icon('shield')} ${m.tower_combat_shield({ shield: foe.shield ?? 0 }, { locale })}` : null;
      const minions = (foe.minions ?? 0) > 0 ? `${icon('rpgBoss')} ${m.tower_combat_minions({ count: foe.minions ?? 0 }, { locale })}` : null;
      textBlock(container, [
        ...(trial ? [trial] : []),
        ...(foe.mimic && foe.log.length === 0 ? [`${icon('rpgChest')} **${m.tower_combat_mimic({}, { locale })}**`] : []),
        `### ${foeIcon(foe)} ${foe.name}${kind}`,
        combatHpBar(foe.health, foe.maxHealth),
        `-# ${icon('rpgAtk')} ${foe.attack} · ${icon('rpgDef')} ${foe.defense} · ${icon('rpgSpd')} ${foe.speed}${enraged}`,
        ...[...traits, mechanic, shield, minions, powerLine(foe.power ?? 1, (foe.bounty ?? 1) !== 1, locale) || null].filter((line): line is string => line !== null).map((line) => `-# ${line}`),
        '',
        log.length > 0 ? log.join('\n') : m.rpg_fight_combat_start_log({}, { locale }),
        foe.charging ? `\n${icon('warning')} **${m.tower_combat_charging({ name: foe.name }, { locale })}**` : null,
      ].filter((line): line is string => line !== null).join('\n'));

      const maxHealth = towerStats(state).maxHealth;
      components.push(row(
        button(actId(ownerId, version, 'atk'), m.rpg_fight_btn_attack({}, { locale }), ButtonStyle.Primary, icon('rpgAtk')),
        button(actId(ownerId, version, 'def'), m.rpg_fight_btn_defend({}, { locale }), foe.charging ? ButtonStyle.Success : ButtonStyle.Secondary, icon('rpgDef')),
        button(actId(ownerId, version, 'pot'), m.rpg_fight_btn_potion({ count: state.potions }, { locale }), ButtonStyle.Success, icon('rpgPotion'), state.potions === 0 || state.hp >= maxHealth),
        // On ne fuit ni un gardien ni une épreuve.
        ...(foe.kind === 'BOSS' || state.trial ? [] : [button(actId(ownerId, version, 'fl'), m.tower_btn_flee({}, { locale }), ButtonStyle.Danger, icon('rpgLeave'))]),
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
        `-# ${m.tower_loot_diff({ diff: gearDiff(loot, current, locale) || m.tower_loot_same({}, { locale }) }, { locale })}`,
      ].join('\n'));
      components.push(row(
        button(actId(ownerId, version, 'eq'), m.tower_btn_equip({}, { locale }), ButtonStyle.Success, icon('success')),
        button(actId(ownerId, version, 'ds'), m.tower_btn_scrap({ gold: scrapValue(level) }, { locale }), ButtonStyle.Secondary, icon('coins')),
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
          return `${icon(blessing.icon)} **${blessingName(blessing.id, locale)}** (${rank}/${blessing.maxRank}) — ${blessingDescription(blessing.id, locale)}`;
        }),
      ].join('\n'));
      components.push(row(...choices.map((blessing, index) =>
        button(actId(ownerId, version, `b${index}`), blessingName(blessing.id, locale), ButtonStyle.Primary, icon(blessing.icon)))));
      break;
    }

    case 'EVENT': {
      const event = state.event;
      if (!event) break;
      const [risky, safe] = eventOptions(event.id, level, locale);
      textBlock(container, [
        `### ${icon('rpgMap')} ${eventTitle(event.id, locale)}`,
        eventDescription(event.id, level, locale),
      ].join('\n'));
      // Ce qui rendrait le pari impossible est désactivé plutôt que refusé après coup.
      const riskyBlocked = (event.id === 'GAMBLER' && state.gold < 2)
        || (event.id === 'BLACKSMITH' && (state.gold < blacksmithPrice(level) || (!state.gear.weapon && !state.gear.armor)));
      const safeBlocked = event.id === 'SPRING' && state.potions >= MAX_POTIONS;
      components.push(row(
        button(actId(ownerId, version, 'e0'), risky, ButtonStyle.Primary, icon('rpgMap'), riskyBlocked),
        button(actId(ownerId, version, 'e1'), safe, ButtonStyle.Secondary, icon('rpgDoor'), safeBlocked),
      ));
      components.push(runControls(ownerId, state, version, locale));
      break;
    }

    case 'MERCENARY': {
      const price = mercenaryPrice(level);
      textBlock(container, [
        `### ${icon('rpgClan')} ${m.tower_room_mercenary({}, { locale })}`,
        m.tower_mercenary_desc({ price, coin: icon('coins') }, { locale }),
      ].join('\n'));
      components.push(row(
        button(actId(ownerId, version, 'hi'), m.tower_btn_hire({ price }, { locale }), ButtonStyle.Success, icon('rpgClan'), state.gold < price || state.ally === true),
        button(actId(ownerId, version, 'ml'), m.tower_btn_leave_shop({}, { locale }), ButtonStyle.Secondary, icon('rpgDoor')),
      ));
      components.push(runControls(ownerId, state, version, locale));
      break;
    }

    case 'MERCHANT': {
      const merchant = runMerchant(state, config);
      const offerLabel = (offer: TowerOffer) => {
        switch (offer.kind) {
          case 'POTION': return `${icon('rpgPotion')} ${m.tower_offer_potion({}, { locale })}`;
          case 'HEAL': return `${icon('rpgHp')} ${m.tower_offer_heal({ percent: merchant.healPercent }, { locale })}`;
          default: return `${icon(SLOT_ICON[offer.gear.slot])} ${offer.gear.name}`;
        }
      };
      textBlock(container, [
        `### ${icon('rpgShop')} ${m.tower_merchant_title({}, { locale })}`,
        ...state.merchant.map((offer) => {
          const detail = offer.kind === 'GEAR' ? ` · ${rarityIcon(offer.gear.rarity)} ${gearStats(offer.gear, locale)}` : '';
          const price = offer.sold ? `~~${offer.price}~~ ${m.tower_offer_sold({}, { locale })}` : `**${offer.price}** ${icon('coins')}`;
          return `${offerLabel(offer)}${detail} — ${price}`;
        }),
      ].join('\n'));
      components.push(row(
        ...state.merchant.map((offer, index) => button(
          actId(ownerId, version, `m${index}`),
          `${offer.kind === 'GEAR' ? offer.gear.name : offer.kind === 'POTION' ? m.tower_offer_potion({}, { locale }) : m.tower_offer_heal({ percent: merchant.healPercent }, { locale })} (${offer.price})`,
          ButtonStyle.Primary,
          undefined,
          offer.sold || state.gold < offer.price,
        )),
        button(actId(ownerId, version, 'ml'), m.tower_btn_leave_shop({}, { locale }), ButtonStyle.Secondary, icon('rpgDoor')),
      ));
      const rerollable = state.merchant.some((offer) => offer.kind === 'GEAR' && !offer.sold);
      if (rerollable) {
        const price = towerRerollPrice(level, merchant);
        components.push(row(button(
          actId(ownerId, version, 'rr'),
          m.tower_btn_reroll({ price }, { locale }),
          ButtonStyle.Secondary,
          icon('rpgRefresh'),
          state.merchantRerolled === true || state.gold < price,
        )));
      }
      break;
    }
  }

  return { embeds: [], components, container, files };
}

/** Bilan d'une ascension terminée. */
export async function buildTowerSettlementView(guildId: string, ownerId: string, locale: Locale, settlement: TowerSettlement): Promise<PanelView> {
  const [config, economy] = await Promise.all([getTowerConfig(guildId), getOrCreateEconomyConfig(guildId)]);
  const container = new ContainerBuilder().setAccentColor(settlement.outcome === 'DEAD' ? COLOR : RPG_COLORS.wild);

  const title = settlement.outcome === 'DEAD'
    ? m.tower_end_dead({}, { locale })
    : settlement.expired ? m.tower_end_expired({}, { locale }) : m.tower_end_left({}, { locale });

  const lines = [
    header(config, settlement.daily ? `${m.tower_daily_title({}, { locale })} · ${title}` : title),
    `${icon('rpgTower')} ${m.tower_end_summary({ floors: settlement.floorsCleared, kills: settlement.kills }, { locale })}`,
    m.tower_end_shards({ shards: settlement.shards, emoji: shardIcon(config), currency: config.currencyName }, { locale }),
  ];
  if (settlement.killedBy) lines.push(`${icon('rpgBoss')} ${m.tower_end_killed_by({ name: settlement.killedBy }, { locale })}`);
  if (settlement.lostToDeath > 0) lines.push(`-# ${m.tower_end_lost_death({ shards: settlement.lostToDeath, percent: 100 - config.deathShardPercent }, { locale })}`);
  // Bilans écrits avant l'ajout de ce champ : il peut manquer.
  if ((settlement.lostToLeave ?? 0) > 0) lines.push(`-# ${m.tower_end_lost_leave({ shards: settlement.lostToLeave, percent: 100 - config.leaveShardPercent }, { locale })}`);
  if (settlement.lostToCap > 0) lines.push(`-# ${m.tower_end_lost_cap({ shards: settlement.lostToCap }, { locale })}`);
  if (settlement.newBest) lines.push(`${icon('trophy')} ${m.tower_end_new_best({ floors: settlement.floorsCleared }, { locale })}`);
  if (settlement.milestones.length > 0) {
    lines.push(`${icon('rpgDaily')} ${m.tower_end_milestones({}, { locale })}`);
    for (const reward of settlement.milestones) {
      const contents = rewardContents(reward, economy.currencyEmoji, config, locale);
      lines.push(`${rewardIcon(reward)} **${reward.name}**${contents ? ` — ${contents}` : ''}`);
    }
  }
  textBlock(container, lines.join('\n'));

  // Le bilan en image : l'étage atteint dans la tour, et l'essentiel de la partie à côté.
  const files: NonNullable<PanelView['files']> = [];
  const image = await renderTowerImage({
    kind: 'shaft',
    title: config.name,
    floor: Math.max(1, settlement.floorsCleared),
    bossEvery: 0,
    floorLabel: (value) => m.tower_floor({ floor: value }, { locale }),
    panel: {
      title,
      lines: [
        m.tower_panel_floors({ floors: settlement.floorsCleared }, { locale }),
        m.tower_panel_rooms({ rooms: settlement.roomsExplored ?? settlement.floorsCleared }, { locale }),
        m.tower_panel_kills({ kills: settlement.kills }, { locale }),
        m.tower_panel_shards({ shards: settlement.shards, currency: config.currencyName }, { locale }),
        settlement.killedBy ? m.tower_end_killed_by({ name: settlement.killedBy }, { locale }) : '',
        ...(settlement.gear ?? []),
      ].filter(Boolean),
    },
  });
  if (image) {
    files.push({ attachment: image, name: TOWER_IMAGE_FILENAME });
    container.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(
      new MediaGalleryItemBuilder({ media: { url: `attachment://${TOWER_IMAGE_FILENAME}` } }),
    ));
  }

  return {
    embeds: [],
    container,
    files,
    components: [row(
      button(`twr:enter:${ownerId}`, m.tower_btn_again({}, { locale }), ButtonStyle.Success, icon('rpgDoor')),
      button(`twr:shop:${ownerId}:0`, m.tower_btn_shop({}, { locale }), ButtonStyle.Primary, icon('rpgShop')),
      button(`twr:top:${ownerId}`, m.tower_btn_leaderboard({}, { locale }), ButtonStyle.Secondary, icon('trophy')),
      button(`twr:home:${ownerId}`, m.tower_btn_home({}, { locale }), ButtonStyle.Secondary, icon('rpgBack')),
    )],
  };
}

/** Ce que coûte un départ maintenant : tout est gardé sur un palier sûr, une part sinon. */
function leaveDescription(config: TowerConfigView, active: ActiveTowerRun, locale: Locale): string {
  const { state } = active;
  const safe = state.safeLeave === true;
  const kept = settleShards(state.shards, 'LEFT', config.deathShardPercent, config.leaveShardPercent, safe);
  const floors = state.floorsCleared;
  if (kept >= state.shards) return m.tower_leave_desc({ shards: state.shards, emoji: shardIcon(config), floors }, { locale });
  return m.tower_leave_desc_partial({ kept, shards: state.shards, percent: config.leaveShardPercent, emoji: shardIcon(config), floors }, { locale });
}

function leaveConfirmView(config: TowerConfigView, ownerId: string, version: number, active: ActiveTowerRun, locale: Locale): PanelView {
  const container = new ContainerBuilder().setAccentColor(COLOR);
  textBlock(container, [
    header(config, m.tower_leave_title({}, { locale })),
    leaveDescription(config, active, locale),
  ].join('\n'));
  return {
    embeds: [],
    container,
    components: [row(
      button(`twr:quit:${ownerId}:${version}`, m.tower_btn_leave_confirm({}, { locale }), ButtonStyle.Danger, icon('rpgLeave')),
      button(`twr:run:${ownerId}`, m.tower_btn_continue({}, { locale }), ButtonStyle.Success, icon('rpgDoor')),
    )],
  };
}

async function buildTowerShopView(guildId: string, ownerId: string, locale: Locale, page: number): Promise<PanelView> {
  const [config, shop, economy] = await Promise.all([getTowerConfig(guildId), getTowerShop(guildId, ownerId), getOrCreateEconomyConfig(guildId)]);
  const container = new ContainerBuilder().setAccentColor(RPG_COLORS.trade);
  textBlock(container, [
    header(config, m.tower_shop_title({}, { locale })),
    m.tower_shop_balance({ shards: shard(shop.profile.shards), emoji: shardIcon(config), currency: config.currencyName }, { locale }),
  ].join('\n'));
  separator(container);

  if (shop.upgrades.length > 0) {
    textBlock(container, `### ${m.tower_shop_upgrades_title({}, { locale })}\n-# ${m.tower_shop_upgrades_hint({}, { locale })}`);
  }
  for (const upgrade of shop.upgrades) {
    const level = shop.levels[upgrade.id] ?? 0;
    const maxed = level >= upgrade.maxLevel;
    const cost = towerUpgradeCost(upgrade, level);
    const effect = upgradeEffectText(upgrade.effect, upgrade.perLevel, locale);
    container.addSectionComponents(new SectionBuilder()
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(truncate(
        [
          `${upgradeIcon(upgrade)} **${upgradeName(upgrade, locale)}** (${level}/${upgrade.maxLevel})`,
          `-# ${m.tower_upgrade_per_level({ effect }, { locale })}`,
          upgrade.description ? `-# ${upgrade.description}` : null,
        ].filter((line): line is string => line !== null).join('\n'),
        500,
      )))
      .setButtonAccessory(button(
        `twr:upg:${ownerId}:${upgrade.id}:${page}`,
        maxed ? m.tower_shop_maxed({}, { locale }) : String(cost),
        ButtonStyle.Success,
        maxed ? undefined : shardButtonEmoji(config),
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
        [`${rewardIcon(reward)} **${reward.name}**`, contents || null, reward.description ? `-# ${reward.description}` : null]
          .filter((line): line is string => line !== null)
          .join('\n'),
        500,
      )))
      .setButtonAccessory(button(
        `twr:buy:${ownerId}:${reward.id}:${current}`,
        owned ? m.tower_shop_owned({}, { locale }) : String(reward.price),
        ButtonStyle.Success,
        owned ? undefined : shardButtonEmoji(config),
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
        const line = m.tower_shop_milestone_line({ emoji: rewardIcon(reward), name: reward.name, floor: reward.floor }, { locale });
        return contents ? `${line}\n-# ${contents}` : line;
      }),
    ].join('\n'));
  }

  const nav: ButtonBuilder[] = [];
  if (pageCount > 1) {
    nav.push(
      button(`twr:shop:${ownerId}:${current - 1}`, m.rpg_shop_prev({}, { locale }), ButtonStyle.Secondary, icon('rpgPrev'), current <= 0),
      button(`twr:shop:${ownerId}:${current + 1}:n`, m.rpg_shop_next({}, { locale }), ButtonStyle.Secondary, icon('rpgNext'), current >= pageCount - 1),
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
  const container = new ContainerBuilder().setAccentColor(COLOR);
  const lines = top.map((entry, index) =>
    `${index < 3 ? rankEmoji(index + 1) : `**${index + 1}.**`} <@${entry.userId}> — ${m.tower_top_floors({ floors: entry.bestFloor }, { locale })}`
    + (entry.bestRooms > 0 ? ` · ${m.tower_top_rooms({ rooms: entry.bestRooms }, { locale })}` : ''));

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

/** Classement de l'ascension du jour. */
async function buildTowerDailyView(guildId: string, ownerId: string, locale: Locale): Promise<PanelView> {
  const [config, top] = await Promise.all([getTowerConfig(guildId), getTowerDailyLeaderboard(guildId)]);
  const container = new ContainerBuilder().setAccentColor(COLOR);
  const lines = top.map((entry, index) =>
    `${index < 3 ? rankEmoji(index + 1) : `**${index + 1}.**`} <@${entry.userId}> — ${m.tower_top_floors({ floors: entry.floorsCleared }, { locale })}`
    + ` · ${m.tower_top_rooms({ rooms: entry.roomsExplored }, { locale })}`);
  textBlock(container, [
    header(config, m.tower_daily_title({}, { locale })),
    `-# ${m.tower_daily_rules({}, { locale })}`,
    '',
    lines.length > 0 ? lines.join('\n') : `*${m.tower_daily_empty({}, { locale })}*`,
  ].join('\n'));
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
  if (code === 'fl') return { type: 'flee' };
  if (code === 'rr') return { type: 'reroll' };
  if (code === 'hi') return { type: 'hire' };
  if (code.startsWith('s-')) return { type: 'skill', id: code.slice(2) };
  const index = Number.parseInt(code.slice(1), 10);
  if (!Number.isInteger(index) || index < 0 || index > 4) return null;
  if (code.startsWith('d')) return { type: 'door', index };
  if (code.startsWith('b')) return { type: 'bless', index };
  if (code.startsWith('m')) return { type: 'buy', index };
  if (code.startsWith('e')) return { type: 'event', index };
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
        const { upgrade, level } = await buyTowerUpgrade(guildId, ownerId, rest[0] ?? '');
        const view = await buildTowerShopView(guildId, ownerId, locale, Number.parseInt(rest[1] ?? '0', 10) || 0);
        await respond(interaction, withNote(view, m.tower_shop_upgraded({ name: upgradeName(upgrade, locale), level }, { locale })));
        return;
      }
      case 'top': await respond(interaction, await buildTowerLeaderboardView(guildId, ownerId, locale)); return;
      case 'daily': {
        const active = await startTowerRun(client, guildId, ownerId, { daily: true });
        await respond(interaction, await buildTowerRunView(guildId, ownerId, locale, active));
        return;
      }
      case 'dtop': await respond(interaction, await buildTowerDailyView(guildId, ownerId, locale)); return;
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
