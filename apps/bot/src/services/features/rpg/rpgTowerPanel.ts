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
  escapeMarkdown,
  type ButtonInteraction,
  type Client,
} from 'discord.js';
import { truncate } from '../../../utils/embeds.js';
import { rankEmoji } from '../../../utils/emojis.js';
import { getEffectiveLocale } from '../../../utils/i18n.js';
import * as m from '../../../lib/paraglide/messages.js';
import { getOrCreateEconomyConfig } from '../economyService.js';
import { combatHpBar, gaugeNumber, icon, rarityIcon, RPG_COLORS } from './rpgIcons.js';
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
  AUTO_STOP_HEALTH,
  TRIAL_WAVES,
  canFlee,
  combatStats,
  heatShardBonus,
  floorModifier,
  towerLevel,
  towerStats,
  type TowerAction,
  type TowerCaptiveGift,
  type TowerLockProgress,
  type TowerLogEntry,
  type TowerMapState,
  type TowerMove,
  type TowerNotice,
  type TowerRoomInfo,
  type TowerState,
} from './rpgTowerEngine.js';
import {
  TOWER_COLLAPSE_STEPS,
  TOWER_FLOOR_MODIFIERS,
  TOWER_HIDDEN_ROOMS,
  TOWER_TOLL_GOLD,
  exitLocks,
  exitRoom,
  floorLayout,
  isExitRoom,
  occupancy,
  roomDistance,
  towerFloorCount,
  resolveTowerTheme,
  towerLayoutHasFog,
  visibleRooms,
  type TowerDirection,
  type TowerExitType,
  type TowerFloorModifier,
  type TowerHiddenRoom,
  type TowerRoom,
  type TowerRoomType,
} from './rpgTowerMap.js';
import {
  HEAT_FAMINE_HEAL,
  HEAT_FOE_BOOST,
  HEAT_GREED_PRICE,
  HEAT_SHARD_BONUS,
  TOWER_HEATS,
  FOUNTAIN_HEAL,
  blacksmithPrice,
  fountainDonation,
  fountainDrinkCost,
  heatsFromMask,
  oraclePrice,
  mentorPrice,
  mercenaryPrice,
  type TowerBossMechanic,
  type TowerEventId,
  type TowerHeat,
  type TowerRelicPerk,
  type TowerTrait,
} from './rpgTowerContent.js';
import {
  TOWER_IMAGE_FILENAME,
  renderTowerImage,
  type TowerLadderEntry,
  type TowerLegendEntry,
  type TowerLegendMarker,
} from './rpgTowerRender.js';
import {
  MAX_POTIONS,
  TOWER_DAILY_PODIUM_SHARDS,
  TOWER_GEAR_SLOTS,
  findBlessing,
  previousTowerDayKey,
  scrapValue,
  settleShards,
  towerRerollPrice,
  towerDailyChallenge,
  towerDailyStreakBonus,
  towerSkillPrice,
  towerStatGrant,
  towerUpgradeCost,
  type TowerDoor,
  type TowerGear,
  type TowerGearSlot,
  type TowerMerchantSettings,
  type TowerOffer,
  type TowerSkill,
  type TowerStatGrant,
  type TowerUpgradeDef,
  type TowerUpgradeEffect,
} from './rpgTowerPolicy.js';
import { MAX_HEALTH_PER_POINT } from './rpgProgressionService.js';
import {
  TowerRefused,
  abandonTowerRun,
  actTowerRun,
  buyTowerReward,
  buyTowerUpgrade,
  getActiveTowerRun,
  getClanTowerStatus,
  getTowerDiscoveries,
  getOrCreateTowerProfile,
  getTowerConfig,
  getTowerPlayConfig,
  currentTowerDay,
  getTowerDailyLeaderboard,
  getTowerLeaderboard,
  hasPlayedDaily,
  getTowerShop,
  getTowerServerRecord,
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
import { listClanTowerStandings } from './rpgClanTowerService.js';
import type { ClanTowerBonus } from './rpgClanTowerPolicy.js';

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
  EXIT: 'rpgUp',
  COLLAPSE: 'rpgUp',
  TOLL: 'coins',
  WELL: 'rpgDoor',
  ENTRANCE: 'rpgDoor',
  FOUNTAIN: 'rpgPotion',
  // Une embuscade et le repaire d'un errant se présentent comme des couloirs.
  AMBUSH: 'dot',
  WANDERER: 'dot',
  PRISONER: 'rpgKey',
  ORACLE: 'star',
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
  MENTOR: 'rpgXp',
  TRAP: 'warning',
  WARP_A: 'rpgTravel',
  WARP_B: 'rpgTravel',
  EMPTY: 'dot',
};

/**
 * Glyphes de la mini-carte. Elle reste en Unicode : un emoji d'application pèse une trentaine
 * de caractères, et une grille de 20×20 dépasserait la limite de texte d'un message.
 */
const MINIMAP_GLYPH: Record<Exclude<TowerRoomType, 'MIMIC' | 'AMBUSH' | 'WANDERER'>, string> = {
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
  EXIT: '↑',
  COLLAPSE: '⇡',
  TOLL: '＄',
  WELL: '◌',
  ENTRANCE: '▽',
  FOUNTAIN: '≈',
  PRISONER: 'Ｐ',
  ORACLE: '◈',
  TRIAL: 'Ｔ',
  GATE: 'Ｇ',
  SEAL: '◎',
  WARP_A: 'Ａ',
  WARP_B: 'Ｂ',
  MERCENARY: 'Ｍ',
  MENTOR: 'Ｌ',
  TRAP: '▲',
  EMPTY: '⬜',
};

/** Ce que le joueur croit voir : une mimique passe pour un coffre. */
function disguised(type: TowerRoomType): Exclude<TowerRoomType, 'MIMIC' | 'AMBUSH' | 'WANDERER'> {
  if (type === 'MIMIC') return 'CHEST';
  // Une embuscade se cache en couloir ; le repaire d'un errant n'est qu'un couloir, lui se déplace.
  if (type === 'AMBUSH' || type === 'WANDERER') return 'EMPTY';
  return type;
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
    case 'EXIT': return m.tower_room_exit({}, { locale });
    case 'COLLAPSE': return m.tower_room_collapse({}, { locale });
    case 'TOLL': return m.tower_room_toll({}, { locale });
    case 'WELL': return m.tower_room_well({}, { locale });
    case 'ENTRANCE': return m.tower_room_entrance({}, { locale });
    case 'FOUNTAIN': return m.tower_room_fountain({}, { locale });
    case 'PRISONER': return m.tower_room_prisoner({}, { locale });
    case 'ORACLE': return m.tower_room_oracle({}, { locale });
    case 'TRIAL': return m.tower_room_trial({}, { locale });
    case 'GATE': return m.tower_room_gate({}, { locale });
    case 'SEAL': return m.tower_room_seal({}, { locale });
    case 'WARP_A': return m.tower_room_warp_a({}, { locale });
    case 'WARP_B': return m.tower_room_warp_b({}, { locale });
    case 'MERCENARY': return m.tower_room_mercenary({}, { locale });
    case 'MENTOR': return m.tower_room_mentor({}, { locale });
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
    case 'EXIT': return m.tower_room_exit_desc({}, { locale });
    case 'COLLAPSE': return m.tower_room_collapse_desc({}, { locale });
    case 'TOLL': return m.tower_room_toll_desc({}, { locale });
    case 'WELL':
    case 'ENTRANCE': return m.tower_room_entry_desc({}, { locale });
    case 'FOUNTAIN': return m.tower_room_fountain_desc({}, { locale });
    case 'PRISONER': return m.tower_room_prisoner_desc({}, { locale });
    case 'ORACLE': return m.tower_room_oracle_desc({}, { locale });
    case 'TRIAL': return m.tower_room_trial_desc({ waves }, { locale });
    case 'GATE': return m.tower_room_gate_desc({}, { locale });
    case 'SEAL': return m.tower_room_seal_desc({}, { locale });
    case 'WARP_A':
    case 'WARP_B': return m.tower_room_warp_desc({}, { locale });
    case 'MERCENARY': return m.tower_room_mercenary_desc({}, { locale });
    case 'MENTOR': return m.tower_room_mentor_desc({}, { locale });
    case 'TRAP': return m.tower_room_trap_desc({}, { locale });
    default: return m.tower_room_empty_desc({}, { locale });
  }
}

/**
 * Carte de l'étage en emojis, en repli de l'image : salles restantes par type, salles faites en vert, murs en
 * noir, le joueur en personnage. Une ligne par rangée de la grille, 20 cases au plus.
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
function exitStatus(type: TowerRoomType, map: TowerMapState, room: TowerRoom | undefined, locale: Locale): string {
  const locks = exitLocks(map.layout, map.cleared);
  if (type === 'COLLAPSE' && room) {
    const left = collapseLeft(map, room);
    return left > 0 ? m.tower_exit_collapse_left({ steps: left }, { locale }) : m.tower_exit_collapsed({}, { locale });
  }
  if (type === 'TOLL' && room) return m.tower_exit_toll({ gold: room.tollGold ?? TOWER_TOLL_GOLD.default, coin: icon('coins') }, { locale });
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
  const conquered = map.conquered?.includes(move.roomId) === true;
  const status = move.direction === 'WARP'
    ? m.tower_move_warp({}, { locale })
    : conquered
      ? `*${m.tower_room_conquered({}, { locale })}*`
      : move.cleared
      ? `*${m.tower_room_visited({}, { locale })}*`
      : roomDescription(move.type, locale, room?.waves);
  // Mimique et embuscade se font passer pour autre chose : traits, fantôme ou puissance les
  // trahiraient. Un escalier encore debout ne dit rien de son gardien de secours.
  const hidden = move.type === 'MIMIC' || move.type === 'AMBUSH';
  const standing = move.type === 'COLLAPSE' && room !== undefined && collapseLeft(map, room) > 0;
  const extras = move.cleared || conquered ? [] : [
    hidden || standing ? '' : roomInfoLine(info, locale),
    exitStatus(move.type, map, room, locale),
    room?.key ? `${icon('rpgKey')} ${m.tower_room_holds_key({}, { locale })}` : '',
    !hidden && map.ghosts?.some((ghost) => ghost.roomId === move.roomId) ? `${icon('rpgBoss')} ${m.tower_room_ghost({}, { locale })}` : '',
    map.oraclePath?.includes(move.roomId) ? `${icon('star')} ${m.tower_room_oracle_path({}, { locale })}` : '',
    room && !hidden && !standing ? powerLine((room.powerPercent ?? 100) / 100, room.powerReward === true, locale) : '',
  ].filter(Boolean);
  // Un monstre errant se tient dans la salle : on le verra avant d'y entrer.
  const wanderer = map.wanderers?.some((candidate) => candidate.pos === move.roomId)
    ? `\n-# ${icon('warning')} **${m.tower_room_wanderer_here({}, { locale })}**`
    : '';
  return `${icon(DIRECTION_ICON[move.direction])} ${icon(ROOM_ICON[disguised(move.type)])} **${roomLabel(move.type, locale)}** — ${status}${extras.length > 0 ? `\n-# ${extras.join(' · ')}` : ''}${wanderer}`;
}

function modifierName(modifier: TowerFloorModifier, locale: Locale): string {
  switch (modifier) {
    case 'FLOODED': return m.tower_modifier_flooded({}, { locale });
    case 'BURNING': return m.tower_modifier_burning({}, { locale });
    case 'BLESSED': return m.tower_modifier_blessed({}, { locale });
    case 'MIST': return m.tower_modifier_mist({}, { locale });
    case 'FROST': return m.tower_modifier_frost({}, { locale });
    case 'MOONLESS': return m.tower_modifier_moonless({}, { locale });
    default: return '';
  }
}

function modifierDescription(modifier: TowerFloorModifier, locale: Locale): string {
  switch (modifier) {
    case 'FLOODED': return m.tower_modifier_flooded_desc({}, { locale });
    case 'BURNING': return m.tower_modifier_burning_desc({}, { locale });
    case 'BLESSED': return m.tower_modifier_blessed_desc({}, { locale });
    case 'MIST': return m.tower_modifier_mist_desc({}, { locale });
    case 'FROST': return m.tower_modifier_frost_desc({}, { locale });
    case 'MOONLESS': return m.tower_modifier_moonless_desc({}, { locale });
    default: return '';
  }
}

function exitName(exit: TowerExitType, locale: Locale): string {
  return exit === 'BOSS' ? doorLabel('BOSS', locale) : roomLabel(exit, locale);
}

/** Ce qu'a rendu le captif libéré. */
function captiveLine(gift: TowerCaptiveGift, coin: string, locale: Locale): string {
  if (gift.kind === 'ALLY') return m.tower_captive_ally({}, { locale });
  if (gift.kind === 'POTION') return m.tower_captive_potion({}, { locale });
  return m.tower_captive_gold({ gold: gift.amount, coin }, { locale });
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
function towerLadder(state: TowerState, floor: number, config: TowerConfigView, locale: Locale, recordFloor: number | null, mode: string): TowerLadderEntry[] {
  // Le défi du jour ne monte que sur des étages générés : les étages dessinés n'y figurent pas.
  const floors = mode === 'DAILY' ? [] : config.floors;
  const entries: TowerLadderEntry[] = [];
  for (let n = floor + 2; n >= Math.max(1, floor - 2); n--) {
    const layout = n === floor ? state.map?.layout : floorLayout(floors, n, state.seed ?? 0);
    entries.push({
      label: floorTitle(n, layout?.name ?? '', locale),
      status: n === floor ? 'current' : n > floor ? 'next' : 'done',
      theme: resolveTowerTheme(layout?.theme, n),
      record: n === recordFloor,
    });
  }
  return entries;
}

/** Image de la tour pour l'écran de déplacement ; `null` si le rendu échoue. */
async function towerImage(guildId: string, mode: string, state: TowerState, floor: number, config: TowerConfigView, locale: Locale): Promise<Buffer | null> {
  if (state.map) {
    const map = state.map;
    // Le record de tous les temps ne se bat qu'en ascension classique : ailleurs, il n'a pas de sens.
    const record = mode === 'CLASSIC' ? await getTowerServerRecord(guildId).catch(() => null) : null;
    // Devant les entrées au choix, toutes se voient, et rien d'autre sous le brouillard.
    const entries = state.phase === 'ENTRY' ? map.entryChoices ?? [] : [];
    // Révélé par un oracle, l'étage se voit en entier.
    const visible = map.revealed ? null : entries.length > 0 && towerLayoutHasFog(map.layout) ? new Set(entries) : visibleRooms(map.layout, map.pos, map.cleared);
    const mimics = new Set(map.layout.rooms.filter((room) => room.type === 'MIMIC' || room.type === 'AMBUSH' || room.type === 'WANDERER').map((room) => room.id));
    const badges = Object.fromEntries(Object.entries(map.rooms ?? {})
      .filter(([id]) => !mimics.has(id))
      .map(([id, info]) => [id, info.traits.length + (info.mechanic ? 1 : 0)] as const)
      .filter(([, count]) => count > 0));
    return renderTowerImage({
      kind: 'map',
      title: modifierName(map.layout.modifier ?? 'NONE', locale)
        ? `${floorTitle(floor, map.layout.name, locale)} · ${modifierName(map.layout.modifier ?? 'NONE', locale)}`
        : floorTitle(floor, map.layout.name, locale),
      floor,
      layout: map.layout,
      pos: map.pos,
      cleared: map.cleared,
      targets: entries.length > 0 ? entries : state.moves.filter((move) => !move.cleared).map((move) => move.roomId),
      ladder: towerLadder(state, floor, config, locale, record?.floor ?? null, mode),
      recordLabel: record
        ? record.name
          ? m.tower_ladder_record_named({ floor: record.floor, name: record.name }, { locale })
          : m.tower_ladder_record({ floor: record.floor }, { locale })
        : null,
      visible: visible ? [...visible] : null,
      badges,
      keys: map.layout.rooms.filter((room) => room.key && !map.cleared.includes(room.id)).map((room) => room.id),
      wanderers: (map.wanderers ?? []).map((wanderer) => wanderer.pos),
      path: map.oraclePath ?? [],
      conquered: map.conquered ?? [],
      fire: map.fire ?? [],
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

const STAT_LABELS: Record<Exclude<TowerStatGrant['field'], 'statPoints' | 'maxHealth'>, (locale: Locale) => string> = {
  attack: (locale) => m.rpg_stat_attack({}, { locale }),
  defense: (locale) => m.rpg_stat_defense({}, { locale }),
  speed: (locale) => m.rpg_stat_speed({}, { locale }),
};

const STAT_ICONS: Record<TowerStatGrant['field'], string> = {
  statPoints: 'rpgUp',
  attack: 'rpgAtk',
  defense: 'rpgDef',
  speed: 'rpgSpd',
  maxHealth: 'rpgHp',
};

/** Une stat versée au profil RPG : « +1 Attaque », « +8 PV max », « 2 points à répartir ». */
function statGrantText(grant: TowerStatGrant, locale: Locale): string {
  const glyph = icon(STAT_ICONS[grant.field]);
  if (grant.field === 'statPoints') return `${glyph} ${m.tower_reward_stat_points({ amount: grant.gain }, { locale })}`;
  if (grant.field === 'maxHealth') return `${glyph} ${m.tower_reward_stat_health({ gain: grant.gain }, { locale })}`;
  return `${glyph} ${m.tower_reward_stat({ gain: grant.gain, stat: STAT_LABELS[grant.field](locale) }, { locale })}`;
}

/** Ce qu'une récompense verse au profil RPG, sur une ligne. */
function rewardContents(reward: TowerRewardView, coinEmoji: string, config: TowerConfigView, locale: Locale): string {
  const parts: string[] = [];
  if (reward.coins > 0) parts.push(`${coinEmoji || icon('coins')} ${reward.coins}`);
  if (reward.xp > 0) parts.push(`${icon('rpgXp')} ${m.tower_reward_xp({ amount: reward.xp }, { locale })}`);
  if (reward.maxEnergy > 0) parts.push(`${icon('rpgEnergy')} ${m.tower_reward_max_energy({ amount: gaugeNumber(reward.maxEnergy) }, { locale })}`);
  if (reward.reclassVouchers > 0) parts.push(`🎟️ ${m.tower_reward_reclass_vouchers({ count: reward.reclassVouchers }, { locale })}`);
  if (reward.stat === 'RANDOM') {
    parts.push(`${icon('rpgUp')} ${m.tower_reward_stat_random({ amount: reward.statAmount }, { locale })}`);
  } else {
    const grant = towerStatGrant(reward.stat, reward.statAmount, 0, MAX_HEALTH_PER_POINT);
    if (grant) parts.push(statGrantText(grant, locale));
  }
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
      // Un joueur tombé ici : son équipement est dans l'écran de butin qui suit.
      const ghost = notice.ghost ? `\n> ${icon('rpgChest')} ${m.tower_notice_ghost({ user: `<@${notice.ghost}>` }, { locale })}` : '';
      const freed = notice.captive ? `\n> ${icon('rpgKey')} ${captiveLine(notice.captive, gold, locale)}` : '';
      return notice.climbed
        ? `${line}${ghost}${freed}\n> ${icon('rpgUp')} ${m.tower_notice_climbed({ floor: floorTitle(notice.climbed.floor, notice.climbed.name, locale) }, { locale })}`
        : `${line}${ghost}${freed}${lockLine(notice.lock, locale)}`;
    }
    case 'treasure': return `${icon('rpgChest')} ${notice.gold > 0
      ? m.tower_notice_treasure({ gold: notice.gold, coin: gold }, { locale })
      : m.tower_notice_chest_item({}, { locale })}${lockLine(notice.lock, locale)}`;
    case 'wave': return `${icon('rpgWar')} ${m.tower_notice_wave({ wave: notice.wave, waves: notice.waves, gold: notice.gold, coin: gold }, { locale })}`;
    case 'exit': return `${icon('rpgUp')} ${notice.conquered
      ? m.tower_notice_exit_conquered({ exit: exitName(notice.exit, locale) }, { locale })
      : m.tower_notice_exit({ exit: exitName(notice.exit, locale) }, { locale })}${notice.climbed
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
    case 'ambush': return `${icon('warning')} ${m.tower_notice_ambush({ hp: notice.dmg }, { locale })}`;
    case 'wanderer': {
      // Le coffre ou le soin de la salle restent annoncés, avant l'attaque qui suit.
      const before = noticeLine(notice.before ?? null, locale);
      return `${before ? `${before}\n` : ''}${icon('warning')} ${m.tower_notice_wanderer({}, { locale })}`;
    }
    case 'oracle': return `${icon('star')} ${notice.revealed
      ? m.tower_notice_oracle_revealed({ gold: notice.gold, coin: gold }, { locale })
      : m.tower_notice_oracle_path({ gold: notice.gold, coin: gold }, { locale })}`;
    case 'collapsed': return `${icon('warning')} ${m.tower_notice_collapsed({}, { locale })}`;
    case 'toll_paid': return `${icon('coins')} ${m.tower_notice_toll_paid({ gold: notice.gold, coin: gold }, { locale })}${notice.climbed
      ? `\n> ${m.tower_notice_climbed({ floor: floorTitle(notice.climbed.floor, notice.climbed.name, locale) }, { locale })}`
      : ''}`;
    case 'fountain_drink': return `${icon('rpgPotion')} ${m.tower_notice_fountain_drink({ hp: notice.hp, gold: notice.cost, coin: gold }, { locale })}`;
    case 'fountain_donate': return `${icon('coins')} ${m.tower_notice_fountain_donate({ gold: notice.gold, coin: gold }, { locale })}`;
    case 'learned': return `${icon('rpgXp')} ${m.tower_notice_learned({ emoji: notice.emoji, name: notice.name, gold: notice.gold, coin: gold }, { locale })}`;
    case 'mentor_empty': return `${icon('rpgXp')} ${m.tower_notice_mentor_empty({}, { locale })}`;
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
    case 'limit':
      if (refusal.period === 'DAILY') return m.tower_refused_limit_daily({ max: refusal.max }, { locale });
      if (refusal.period === 'WEEKLY') return m.tower_refused_limit_weekly({ max: refusal.max }, { locale });
      return m.tower_refused_limit({ max: refusal.max }, { locale });
    case 'unavailable': return m.tower_refused_unavailable({}, { locale });
    case 'upgrade_max': return m.tower_refused_upgrade_max({}, { locale });
    case 'daily_disabled': return m.tower_refused_daily_disabled({}, { locale });
    case 'daily_done': return m.tower_refused_daily_done({}, { locale });
    case 'clan_closed': return m.tower_refused_clan_closed({}, { locale });
    case 'clan_none': return m.tower_refused_clan_none({}, { locale });
    case 'clan_done': return refusal.next
      ? m.tower_refused_clan_done({ next: discordTime(refusal.next) }, { locale })
      : m.tower_refused_clan_done_last({}, { locale });
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
        case 'no_auto': return m.tower_refused_no_auto({}, { locale });
        case 'fountain_dry': return m.tower_refused_fountain_dry({}, { locale });
        default: return m.tower_refused_stale({}, { locale });
      }
    }
  }
}

/** Date affichée par Discord dans le fuseau de chaque lecteur. */
function discordTime(date: Date, style: 'F' | 'R' = 'R'): string {
  return `<t:${Math.floor(date.getTime() / 1000)}:${style}>`;
}

const UPGRADE_ICON: Record<TowerUpgradeEffect, string> = {
  POTION: 'rpgPotion',
  HEALTH: 'rpgHp',
  ATTACK: 'rpgAtk',
  DEFENSE: 'rpgDef',
  SPEED: 'rpgSpd',
  CRIT: 'rpgCrit',
  GOLD: 'coins',
  FORTUNE: 'rpgChest',
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
    case 'FORTUNE': return m.tower_upgrade_name_fortune({}, { locale });
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
    case 'FORTUNE': return m.tower_upgrade_effect_fortune({ value }, { locale });
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
  const [profile, preview, dailyDone, clanTower] = await Promise.all([
    getOrCreateTowerProfile(guildId, ownerId),
    previewTowerEntry(guildId, ownerId),
    config.dailyEnabled ? hasPlayedDaily(guildId, ownerId) : Promise.resolve(true),
    getClanTowerStatus(client, guildId, ownerId),
  ]);

  const container = new ContainerBuilder().setAccentColor(COLOR);
  const rules = config.floors.length > 0
    ? m.tower_rules_map({ floors: towerFloorCount(config.floors) }, { locale })
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
    preview.skills.length > 0 ? `-# ${m.tower_home_skills_price({ price: Math.min(...preview.skills.map((skill) => towerSkillPrice(config.skillPrice, skill))), emoji: shardIcon(config) }, { locale })}` : null,
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
      button(`twr:guide:${ownerId}:0`, m.tower_btn_guide({}, { locale }), ButtonStyle.Secondary, icon('rpgMap')),
      ...(economy.rpgEnabled ? [button(`rpg:nav:${ownerId}:hub`, m.rpg_hub_btn_back({}, { locale }), ButtonStyle.Secondary, icon('rpgBack'))] : []),
    ),
  ];
  if (config.dailyEnabled) {
    textBlock(container, await dailyChallengeLines(guildId, profile, locale));
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
  // La Tour de clan n'apparaît que pendant sa semaine.
  if (clanTower) {
    textBlock(container, [
      `-# ${icon('trophy')} ${clanTower.clan
        ? m.tower_home_clan_hint({ name: clanTower.name, clan: clanTower.clan.name, end: discordTime(clanTower.endsAt, 'F') }, { locale })
        : m.tower_home_clan_no_clan({ name: clanTower.name }, { locale })}`,
      clanTower.clan ? `-# ${clanMilestoneLine(clanTower.totalFloors, clanTower.bonus, locale)}` : null,
    ].filter(Boolean).join('\n'));
    components.push(row(
      button(
        `twr:clan:${ownerId}`,
        clanTower.played ? m.tower_btn_clan_done({}, { locale }) : m.tower_btn_clan({ name: clanTower.name }, { locale }),
        ButtonStyle.Success,
        icon('rpgDoor'),
        clanTower.played || !clanTower.clan || active !== null,
      ),
      button(`twr:ctop:${ownerId}`, m.tower_btn_clan_top({}, { locale }), ButtonStyle.Secondary, icon('trophy')),
    ));
  }

  const view: PanelView = { embeds: [], components, container, files };
  // Partie close à l'ouverture de l'écran, ou plus tôt par le balayage en l'absence du joueur.
  const closed = expired ?? await takePendingTowerSettlement(guildId, ownerId);
  return closed ? withNote(view, m.tower_expired_note({ minutes: config.idleTimeoutMinutes, shards: closed.shards, emoji: shardIcon(config) }, { locale })) : view;
}

/** Effet d'une compétence dans la Tour, en une ligne courte. */
function skillSummary(skill: TowerSkill, locale: Locale): string {
  const e = skill.effect;
  const pct = (value: number) => Math.round(value * 100);
  return [
    e.damageMultiplier > 0 ? m.tower_skill_damage({ mult: e.damageMultiplier }, { locale }) : null,
    e.lifesteal ? m.tower_skill_lifesteal({ percent: pct(e.lifesteal) }, { locale }) : null,
    e.healPercent ? m.tower_skill_heal({ percent: pct(e.healPercent) }, { locale }) : null,
    e.armorPiercing ? m.tower_skill_pierce({ percent: pct(e.armorPiercing) }, { locale }) : null,
    e.defenseMultiplier ? m.tower_skill_defense({ mult: e.defenseMultiplier }, { locale }) : null,
    e.evadeNextAttack ? m.tower_skill_evade({}, { locale }) : null,
    m.tower_skill_cooldown({ turns: skill.cooldownTurns }, { locale }),
  ].filter(Boolean).join(' · ');
}

function heatName(heat: TowerHeat, locale: Locale): string {
  switch (heat) {
    case 'FEROCIOUS': return m.tower_heat_ferocious({}, { locale });
    case 'FAMINE': return m.tower_heat_famine({}, { locale });
    case 'GREED': return m.tower_heat_greed({}, { locale });
    default: return m.tower_heat_dry({}, { locale });
  }
}

function heatDescription(heat: TowerHeat, locale: Locale): string {
  switch (heat) {
    case 'FEROCIOUS': return m.tower_heat_ferocious_desc({ percent: Math.round((HEAT_FOE_BOOST - 1) * 100) }, { locale });
    case 'FAMINE': return m.tower_heat_famine_desc({ percent: Math.round((1 - HEAT_FAMINE_HEAL) * 100) }, { locale });
    case 'GREED': return m.tower_heat_greed_desc({ percent: Math.round((HEAT_GREED_PRICE - 1) * 100) }, { locale });
    default: return m.tower_heat_dry_desc({}, { locale });
  }
}

/**
 * Préparation d'une ascension : les compétences du RPG s'achètent en éclats, pour cette
 * ascension seulement, et la chaleur se choisit contre plus d'éclats. Les deux masques
 * cochent une compétence ou une malédiction par bit.
 */
export async function buildTowerPrepView(guildId: string, ownerId: string, locale: Locale, skillMask: number, heatMask: number): Promise<PanelView> {
  const [config, profile, preview] = await Promise.all([
    getTowerConfig(guildId),
    getOrCreateTowerProfile(guildId, ownerId),
    previewTowerEntry(guildId, ownerId),
  ]);
  const skills = preview.skills.slice(0, 10);
  const valid = skillMask & ((1 << skills.length) - 1);
  const heats = heatMask & ((1 << TOWER_HEATS.length) - 1);
  const chosen = skills.filter((_, index) => (valid & (1 << index)) !== 0);
  const cost = chosen.reduce((sum, skill) => sum + towerSkillPrice(config.skillPrice, skill), 0);
  const emoji = shardIcon(config);
  const bonus = Math.round(HEAT_SHARD_BONUS * heatsFromMask(heats).length * 100);

  const container = new ContainerBuilder().setAccentColor(COLOR);
  textBlock(container, [
    header(config, m.tower_prep_title({}, { locale })),
    `-# ${m.tower_prep_balance({ shards: profile.shards, emoji }, { locale })}`,
  ].join('\n'));
  if (skills.length > 0) {
    textBlock(container, [
      `### ${m.tower_prep_skills_title({}, { locale })}`,
      m.tower_prep_desc({}, { locale }),
      ...skills.map((skill, index) => {
        const on = (valid & (1 << index)) !== 0;
        const price = m.tower_prep_skill_price({ price: towerSkillPrice(config.skillPrice, skill), emoji, tier: skill.tier ?? 1 }, { locale });
        return `${on ? `${icon('success')} ` : ''}${skill.emoji} **${skill.name}** · ${price}\n-# ${skillSummary(skill, locale)}`;
      }),
    ].join('\n'));
  }
  textBlock(container, [
    `### ${m.tower_prep_heat_title({}, { locale })}`,
    m.tower_prep_heat_desc({ percent: Math.round(HEAT_SHARD_BONUS * 100) }, { locale }),
    ...TOWER_HEATS.map((heat, index) => {
      const on = (heats & (1 << index)) !== 0;
      return `${on ? `${icon('warning')} ` : ''}**${heatName(heat, locale)}** — ${heatDescription(heat, locale)}`;
    }),
    bonus > 0 ? `-# ${m.tower_prep_heat_bonus({ percent: bonus }, { locale })}` : null,
  ].filter((line): line is string => line !== null).join('\n'));

  const prep = (nextSkills: number, nextHeats: number) => `twr:prep:${ownerId}:${nextSkills}:${nextHeats}`;
  const toggles = skills.map((skill, index) => {
    const on = (valid & (1 << index)) !== 0;
    return button(prep(valid ^ (1 << index), heats), skill.name, on ? ButtonStyle.Success : ButtonStyle.Secondary, skill.emoji || undefined);
  });
  const components: PanelRow[] = [];
  for (let index = 0; index < toggles.length; index += 5) components.push(row(...toggles.slice(index, index + 5)));
  components.push(row(...TOWER_HEATS.map((heat, index) => {
    const on = (heats & (1 << index)) !== 0;
    return button(prep(valid, heats ^ (1 << index)), heatName(heat, locale), on ? ButtonStyle.Danger : ButtonStyle.Secondary, icon('warning'));
  })));
  components.push(row(
    button(
      `twr:go:${ownerId}:${valid}:${heats}`,
      cost > 0 ? m.tower_btn_enter_paid({ cost, currency: config.currencyName }, { locale }) : m.tower_btn_enter({}, { locale }),
      ButtonStyle.Primary,
      icon('rpgDoor'),
      cost > profile.shards,
    ),
    button(`twr:home:${ownerId}`, m.tower_btn_home({}, { locale }), ButtonStyle.Secondary, icon('rpgBack')),
  ));
  return { embeds: [], components, container };
}

/** Pas restants avant qu'un escalier ne s'effondre ; zéro une fois effondré. */
function collapseLeft(map: TowerMapState, room: TowerRoom): number {
  return Math.max(0, (room.collapseSteps ?? TOWER_COLLAPSE_STEPS.default) - (map.steps ?? 0));
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
    case 'EXIT': return m.tower_objective_exit({}, { locale });
    case 'COLLAPSE': return collapseLeft(map, exit) > 0
      ? m.tower_objective_collapse({ steps: collapseLeft(map, exit) }, { locale })
      : m.tower_objective_collapsed({}, { locale });
    case 'TOLL': return m.tower_objective_toll({ gold: exit.tollGold ?? TOWER_TOLL_GOLD.default, coin: icon('coins') }, { locale });
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
    (state.heat ?? []).length > 0
      ? `-# ${icon('warning')} ${m.tower_run_heat({ list: (state.heat ?? []).map((heat) => heatName(heat, locale)).join(', '), percent: Math.round((heatShardBonus(state) - 1) * 100) }, { locale })}`
      : null,
    state.safeLeave ? `-# ${icon('success')} ${m.tower_run_safe({}, { locale })}` : null,
    floorModifier(state) !== 'NONE'
      ? `-# ${icon('rpgMap')} **${modifierName(floorModifier(state), locale)}** : ${modifierDescription(floorModifier(state), locale)}`
      : null,
    state.ally ? `-# ${icon('rpgClan')} ${m.tower_run_ally({}, { locale })}` : null,
    (state.burned ?? 0) > 0 ? `-# ${icon('warning')} ${m.tower_run_burned({ hp: state.burned ?? 0 }, { locale })}` : null,
    state.weather === 'mist_lifted' ? `-# ${icon('rpgMap')} ${m.tower_run_mist_lifted({}, { locale })}` : null,
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
  const config = await getTowerPlayConfig(guildId, active.run.mode);
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
      const image = await towerImage(guildId, run.mode, state, run.floor, config, locale);
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
        // Combat automatique : seulement contre un monstre ordinaire, et pas à PV bas.
        ...(foe.kind === 'COMBAT'
          ? [button(actId(ownerId, version, 'au'), m.tower_btn_auto({}, { locale }), ButtonStyle.Primary, icon('rpgNext'), state.hp < maxHealth * AUTO_STOP_HEALTH)]
          : []),
        button(actId(ownerId, version, 'def'), m.rpg_fight_btn_defend({}, { locale }), foe.charging ? ButtonStyle.Success : ButtonStyle.Secondary, icon('rpgDef')),
        button(actId(ownerId, version, 'pot'), m.rpg_fight_btn_potion({ count: state.potions }, { locale }), ButtonStyle.Success, icon('rpgPotion'), state.potions === 0 || state.hp >= maxHealth),
        // On ne fuit ni un gardien, ni une épreuve, ni une embuscade.
        ...(!canFlee(state, foe) ? [] : [button(actId(ownerId, version, 'fl'), m.tower_btn_flee({}, { locale }), ButtonStyle.Danger, icon('rpgLeave'))]),
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
      components.push(runControls(ownerId, state, version, locale));
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
      components.push(runControls(ownerId, state, version, locale));
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

    case 'ENTRY': {
      // Arrivée devant plusieurs entrées : chacune dit combien de salles la séparent de la sortie.
      const map = state.map!;
      const image = await towerImage(guildId, run.mode, state, run.floor, config, locale);
      if (image) {
        files.push({ attachment: image, name: TOWER_IMAGE_FILENAME });
        container.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(
          new MediaGalleryItemBuilder({ media: { url: `attachment://${TOWER_IMAGE_FILENAME}` } }),
        ));
      }
      const choices = map.entryChoices ?? [];
      const exit = exitRoom(map.layout);
      const distance = (id: string) => {
        const room = map.layout.rooms.find((candidate) => candidate.id === id);
        return room && exit ? roomDistance(map.layout, room.id, exit.id) : null;
      };
      textBlock(container, [
        `### ${m.tower_entry_title({}, { locale })}`,
        m.tower_entry_desc({}, { locale }),
        ...choices.map((id, index) => {
          const rooms = distance(id);
          return `${icon('rpgDoor')} **${m.tower_entry_option({ n: index + 1 }, { locale })}** — ${rooms !== null ? m.tower_entry_distance({ rooms }, { locale }) : '?'}`;
        }),
      ].join('\n'));
      components.push(row(...choices.map((id, index) => {
        const rooms = distance(id);
        return button(actId(ownerId, version, `d${index}`), `${m.tower_entry_option({ n: index + 1 }, { locale })}${rooms !== null ? ` · ${rooms}` : ''}`, ButtonStyle.Primary, icon('rpgDoor'));
      })));
      components.push(runControls(ownerId, state, version, locale));
      break;
    }

    case 'TOLL': {
      const map = state.map!;
      const room = map.layout.rooms.find((candidate) => candidate.id === map.pos);
      const price = room?.tollGold ?? TOWER_TOLL_GOLD.default;
      textBlock(container, [
        `### ${icon('coins')} ${m.tower_room_toll({}, { locale })}`,
        m.tower_toll_desc({ price, coin: icon('coins'), gold: state.gold }, { locale }),
      ].join('\n'));
      components.push(row(
        button(actId(ownerId, version, 'py'), m.tower_btn_toll_pay({ price }, { locale }), ButtonStyle.Success, icon('coins'), state.gold < price),
        button(actId(ownerId, version, 'fc'), m.tower_btn_toll_force({}, { locale }), ButtonStyle.Danger, icon('rpgBoss')),
        button(actId(ownerId, version, 'ml'), m.tower_btn_turn_back({}, { locale }), ButtonStyle.Secondary, icon('rpgBack')),
      ));
      components.push(runControls(ownerId, state, version, locale));
      break;
    }

    case 'ORACLE': {
      const price = oraclePrice(level);
      const fog = state.map ? towerLayoutHasFog(state.map.layout) : false;
      textBlock(container, [
        `### ${icon('star')} ${m.tower_room_oracle({}, { locale })}`,
        fog ? m.tower_oracle_desc_fog({ price, coin: icon('coins') }, { locale }) : m.tower_oracle_desc_path({ price, coin: icon('coins') }, { locale }),
      ].join('\n'));
      components.push(row(
        button(actId(ownerId, version, 're'), m.tower_btn_oracle({ price }, { locale }), ButtonStyle.Success, icon('star'), state.gold < price),
        button(actId(ownerId, version, 'ml'), m.tower_btn_leave_shop({}, { locale }), ButtonStyle.Secondary, icon('rpgDoor')),
      ));
      components.push(runControls(ownerId, state, version, locale));
      break;
    }

    case 'FOUNTAIN': {
      const cost = fountainDrinkCost(level);
      const gift = fountainDonation(level);
      const pool = config.fountainGold;
      textBlock(container, [
        `### ${icon('rpgPotion')} ${m.tower_room_fountain({}, { locale })}`,
        m.tower_fountain_desc({ pool, coin: icon('coins'), percent: Math.round(FOUNTAIN_HEAL * 100), cost, gift }, { locale }),
      ].join('\n'));
      components.push(row(
        button(actId(ownerId, version, 'dk'), m.tower_btn_fountain_drink({ cost }, { locale }), ButtonStyle.Success, icon('rpgPotion'), pool < cost || state.hp >= towerStats(state).maxHealth),
        // La Tour de clan n'a pas accès à la source : y verser ferait perdre l'or pour rien.
        button(actId(ownerId, version, 'dn'), m.tower_btn_fountain_donate({ gift }, { locale }), ButtonStyle.Primary, icon('coins'), state.gold < gift || run.mode === 'CLAN'),
        button(actId(ownerId, version, 'ml'), m.tower_btn_leave_shop({}, { locale }), ButtonStyle.Secondary, icon('rpgDoor')),
      ));
      components.push(runControls(ownerId, state, version, locale));
      break;
    }

    case 'MENTOR': {
      const price = mentorPrice(level);
      const offered = (state.mentor ?? [])
        .map((id) => (state.skillPool ?? []).find((skill) => skill.id === id))
        .filter((skill): skill is TowerSkill => Boolean(skill));
      textBlock(container, [
        `### ${icon('rpgXp')} ${m.tower_room_mentor({}, { locale })}`,
        m.tower_mentor_desc({ price, coin: icon('coins') }, { locale }),
        '',
        ...offered.map((skill) => `${skill.emoji} **${skill.name}**\n-# ${skillSummary(skill, locale)}`),
      ].join('\n'));
      components.push(row(
        ...offered.map((skill, index) => button(actId(ownerId, version, `l${index}`), skill.name, ButtonStyle.Success, skill.emoji || undefined, state.gold < price)),
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
  const [config, economy] = await Promise.all([
    getTowerPlayConfig(guildId, settlement.clan ? 'CLAN' : 'CLASSIC'),
    getOrCreateEconomyConfig(guildId),
  ]);
  const container = new ContainerBuilder().setAccentColor(settlement.outcome === 'DEAD' ? COLOR : RPG_COLORS.wild);

  const title = settlement.outcome === 'DEAD'
    ? m.tower_end_dead({}, { locale })
    : settlement.expired ? m.tower_end_expired({}, { locale }) : m.tower_end_left({}, { locale });

  const lines = [
    header(config, settlement.daily ? `${m.tower_daily_title({}, { locale })} · ${title}` : title),
    `${icon('rpgTower')} ${m.tower_end_summary({ floors: settlement.floorsCleared, kills: settlement.kills }, { locale })}`,
    settlement.clan
      ? m.tower_end_clan({}, { locale })
      : m.tower_end_shards({ shards: settlement.shards, emoji: shardIcon(config), currency: config.currencyName }, { locale }),
  ];
  if (settlement.killedBy) lines.push(`${icon('rpgBoss')} ${m.tower_end_killed_by({ name: settlement.killedBy }, { locale })}`);
  if (settlement.lostToDeath > 0) lines.push(`-# ${m.tower_end_lost_death({ shards: settlement.lostToDeath, percent: 100 - config.deathShardPercent }, { locale })}`);
  // Bilans écrits avant l'ajout de ce champ : il peut manquer.
  if ((settlement.lostToLeave ?? 0) > 0) lines.push(`-# ${m.tower_end_lost_leave({ shards: settlement.lostToLeave, percent: 100 - config.leaveShardPercent }, { locale })}`);
  if ((settlement.streakBonus ?? 0) > 0) lines.push(`-# ${icon('rpgDaily')} ${m.tower_end_streak_bonus({ shards: settlement.streakBonus ?? 0 }, { locale })}`);
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
        settlement.clan ? '' : m.tower_panel_shards({ shards: settlement.shards, currency: config.currencyName }, { locale }),
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
    components: [settlement.clan
      ? row(
        button(`twr:ctop:${ownerId}`, m.tower_btn_clan_top({}, { locale }), ButtonStyle.Primary, icon('trophy')),
        button(`twr:home:${ownerId}`, m.tower_btn_home({}, { locale }), ButtonStyle.Secondary, icon('rpgBack')),
      )
      : row(
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
  if (active.run.mode === 'CLAN') return m.tower_leave_desc_clan({ floors: state.floorsCleared }, { locale });
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
    const bought = shop.purchases[reward.id] ?? 0;
    const limited = reward.maxPurchases > 0;
    const soldOut = limited && bought >= reward.maxPurchases;
    const contents = rewardContents(reward, economy.currencyEmoji, config, locale);
    const counter = { count: bought, max: reward.maxPurchases };
    const title = `${rewardIcon(reward)} **${reward.name}**` + (!limited ? '' : ` · ${
      reward.limitPeriod === 'DAILY' ? m.tower_shop_purchases_daily(counter, { locale })
        : reward.limitPeriod === 'WEEKLY' ? m.tower_shop_purchases_weekly(counter, { locale })
          : m.tower_shop_purchases(counter, { locale })}`);
    const unavailable = owned || soldOut;
    container.addSectionComponents(new SectionBuilder()
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(truncate(
        [title, contents || null, reward.description ? `-# ${reward.description}` : null]
          .filter((line): line is string => line !== null)
          .join('\n'),
        500,
      )))
      .setButtonAccessory(button(
        `twr:buy:${ownerId}:${reward.id}:${current}`,
        owned ? m.tower_shop_owned({}, { locale }) : soldOut ? m.tower_shop_limit({}, { locale }) : String(reward.price),
        ButtonStyle.Success,
        unavailable ? undefined : shardButtonEmoji(config),
        unavailable || shop.profile.shards < reward.price,
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

/**
 * Le défi du jour tel que le joueur le voit : l'ambiance et la malédiction imposées, puis sa
 * série de jours joués d'affilée (rompue s'il a sauté un jour) et le bonus qu'elle donne.
 */
async function dailyChallengeLines(guildId: string, profile: { dailyStreak: number; dailyLastKey: string | null }, locale: Locale): Promise<string> {
  const dayKey = await currentTowerDay(guildId);
  const challenge = towerDailyChallenge(guildId, dayKey);
  const alive = profile.dailyLastKey === dayKey || profile.dailyLastKey === previousTowerDayKey(dayKey);
  const streak = alive ? profile.dailyStreak : 0;
  // Joué hier et pas encore aujourd'hui : c'est la série de demain qui compte pour le bonus.
  const next = profile.dailyLastKey === dayKey ? streak : streak + 1;
  return [
    `${icon('rpgDaily')} ${m.tower_daily_challenge({ modifier: modifierName(challenge.modifier, locale), heat: heatName(challenge.heat, locale) }, { locale })}`,
    `-# ${modifierDescription(challenge.modifier, locale)} · ${heatDescription(challenge.heat, locale)}`,
    `-# ${m.tower_daily_streak({ days: streak, bonus: Math.round(towerDailyStreakBonus(next) * 100) }, { locale })}`,
  ].join('\n');
}

/** Classement de l'ascension du jour. */
async function buildTowerDailyView(guildId: string, ownerId: string, locale: Locale): Promise<PanelView> {
  const [config, top, profile] = await Promise.all([getTowerConfig(guildId), getTowerDailyLeaderboard(guildId), getOrCreateTowerProfile(guildId, ownerId)]);
  const container = new ContainerBuilder().setAccentColor(COLOR);
  const lines = top.map((entry, index) =>
    `${index < 3 ? rankEmoji(index + 1) : `**${index + 1}.**`} <@${entry.userId}> — ${m.tower_top_floors({ floors: entry.floorsCleared }, { locale })}`
    + ` · ${m.tower_top_rooms({ rooms: entry.roomsExplored }, { locale })}`);
  textBlock(container, [
    header(config, m.tower_daily_title({}, { locale })),
    await dailyChallengeLines(guildId, profile, locale),
    `-# ${m.tower_daily_rules({}, { locale })}`,
    `-# ${icon('trophy')} ${m.tower_daily_podium({ first: TOWER_DAILY_PODIUM_SHARDS[0], second: TOWER_DAILY_PODIUM_SHARDS[1], third: TOWER_DAILY_PODIUM_SHARDS[2] }, { locale })}`,
    '',
    lines.length > 0 ? lines.join('\n') : `*${m.tower_daily_empty({}, { locale })}*`,
  ].join('\n'));
  return { embeds: [], container, components: [row(button(`twr:home:${ownerId}`, m.tower_btn_home({}, { locale }), ButtonStyle.Secondary, icon('rpgBack')))] };
}

// ─────────────────────────────────────────────────────────────
// Guide des salles
// ─────────────────────────────────────────────────────────────

/**
 * Pages du guide : ce que fait chaque salle, rangé comme on la rencontre. Les salles piégées
 * (`TOWER_HIDDEN_ROOMS`) restent sous cadenas tant que le joueur n'est pas tombé dessus.
 */
const GUIDE_ROOM_PAGES: { title: (locale: Locale) => string; rooms: TowerRoomType[] }[] = [
  { title: (locale) => m.tower_guide_page_paths({}, { locale }), rooms: ['START', 'WELL', 'ENTRANCE', 'BOSS', 'STAIRS', 'GATE', 'SEAL', 'EXIT', 'COLLAPSE', 'TOLL', 'WARP_A'] },
  { title: (locale) => m.tower_guide_page_fights({}, { locale }), rooms: ['MONSTER', 'ELITE', 'TRIAL', 'PRISONER', 'TRAP', 'MIMIC', 'AMBUSH', 'WANDERER'] },
  { title: (locale) => m.tower_guide_page_help({}, { locale }), rooms: ['CHEST', 'CAMPFIRE', 'SHRINE', 'MERCHANT', 'MERCENARY', 'MENTOR', 'ORACLE', 'FOUNTAIN', 'EVENT', 'EMPTY'] },
];
/** Après les salles : les marqueurs de la carte, puis les ambiances d'étage. */
const GUIDE_MARKERS_PAGE = GUIDE_ROOM_PAGES.length;
const GUIDE_MODIFIERS_PAGE = GUIDE_MARKERS_PAGE + 1;
const GUIDE_MARKERS: TowerLegendMarker[] = ['PAWN', 'TARGET', 'CLEARED', 'KEY', 'BADGE', 'POWER', 'WANDERER', 'PATH', 'PENNANT', 'FOG', 'FIRE', 'RECORD'];

function hiddenRoomName(room: TowerHiddenRoom, locale: Locale): string {
  switch (room) {
    case 'MIMIC': return m.tower_guide_mimic({}, { locale });
    case 'AMBUSH': return m.tower_guide_ambush({}, { locale });
    default: return m.tower_guide_wanderer({}, { locale });
  }
}

function hiddenRoomDescription(room: TowerHiddenRoom, locale: Locale): string {
  switch (room) {
    case 'MIMIC': return m.tower_guide_mimic_desc({}, { locale });
    case 'AMBUSH': return m.tower_guide_ambush_desc({}, { locale });
    default: return m.tower_guide_wanderer_desc({}, { locale });
  }
}

function isHiddenRoom(type: TowerRoomType): type is TowerHiddenRoom {
  return (TOWER_HIDDEN_ROOMS as readonly string[]).includes(type);
}

function markerName(marker: TowerLegendMarker, locale: Locale): string {
  switch (marker) {
    case 'PAWN': return m.tower_guide_marker_pawn({}, { locale });
    case 'TARGET': return m.tower_guide_marker_target({}, { locale });
    case 'CLEARED': return m.tower_guide_marker_cleared({}, { locale });
    case 'KEY': return m.tower_guide_marker_key({}, { locale });
    case 'BADGE': return m.tower_guide_marker_badge({}, { locale });
    case 'POWER': return m.tower_guide_marker_power({}, { locale });
    case 'WANDERER': return m.tower_guide_marker_wanderer({}, { locale });
    case 'PATH': return m.tower_guide_marker_path({}, { locale });
    case 'PENNANT': return m.tower_guide_marker_pennant({}, { locale });
    case 'RECORD': return m.tower_guide_marker_record({}, { locale });
    case 'FIRE': return m.tower_guide_marker_fire({}, { locale });
    default: return m.tower_guide_fog({}, { locale });
  }
}

function markerDescription(marker: TowerLegendMarker, locale: Locale): string {
  switch (marker) {
    case 'PAWN': return m.tower_guide_marker_pawn_desc({}, { locale });
    case 'TARGET': return m.tower_guide_marker_target_desc({}, { locale });
    case 'CLEARED': return m.tower_guide_marker_cleared_desc({}, { locale });
    case 'KEY': return m.tower_guide_marker_key_desc({}, { locale });
    case 'BADGE': return m.tower_guide_marker_badge_desc({}, { locale });
    case 'POWER': return m.tower_guide_marker_power_desc({}, { locale });
    case 'WANDERER': return m.tower_guide_marker_wanderer_desc({}, { locale });
    case 'PATH': return m.tower_guide_marker_path_desc({}, { locale });
    case 'PENNANT': return m.tower_guide_marker_pennant_desc({}, { locale });
    case 'RECORD': return m.tower_guide_marker_record_desc({}, { locale });
    case 'FIRE': return m.tower_guide_marker_fire_desc({}, { locale });
    default: return m.tower_guide_fog_desc({}, { locale });
  }
}

/** Nom et description d'une salle du guide, et sa case dans la légende. */
function guideRoom(type: TowerRoomType, known: ReadonlySet<TowerHiddenRoom>, locale: Locale): { name: string; description: string; legend: TowerLegendEntry } {
  if (isHiddenRoom(type)) {
    if (!known.has(type)) {
      return { name: '???', description: `*${m.tower_guide_locked({}, { locale })}*`, legend: { room: type, label: '???', locked: true } };
    }
    const name = hiddenRoomName(type, locale);
    return { name, description: hiddenRoomDescription(type, locale), legend: { room: type, label: name, hidden: disguised(type) } };
  }
  // Les deux portails se lisent ensemble : une seule ligne pour la paire.
  const name = type === 'WARP_A' ? m.tower_guide_warps({}, { locale }) : roomLabel(type, locale);
  return { name, description: roomDescription(type, locale), legend: { room: type, label: name } };
}

/**
 * Guide des salles : une page par famille de salles, une pour les marqueurs de la carte et
 * une pour les ambiances. La légende en image reprend les couleurs et les pictogrammes de la
 * carte ; le texte dessous détaille chaque case.
 */
async function buildTowerGuideView(guildId: string, ownerId: string, locale: Locale, page: number): Promise<PanelView> {
  const [config, discovered] = await Promise.all([getTowerConfig(guildId), getTowerDiscoveries(guildId, ownerId)]);
  const known = new Set(discovered);
  const current = Math.min(GUIDE_MODIFIERS_PAGE, Math.max(0, page));
  const container = new ContainerBuilder().setAccentColor(COLOR);
  const files: NonNullable<PanelView['files']> = [];

  const titles = [
    ...GUIDE_ROOM_PAGES.map((entry) => entry.title(locale)),
    m.tower_guide_page_markers({}, { locale }),
    m.tower_guide_page_modifiers({}, { locale }),
  ];
  const title = titles[current];
  const entries: { name: string; description: string }[] = [];
  let legend: TowerLegendEntry[] = [];
  let footer: string | null = null;

  if (current < GUIDE_MARKERS_PAGE) {
    const rooms = GUIDE_ROOM_PAGES[current].rooms.map((type) => guideRoom(type, known, locale));
    entries.push(...rooms);
    legend = rooms.map((room) => room.legend);
    const hidden = GUIDE_ROOM_PAGES[current].rooms.filter(isHiddenRoom);
    if (hidden.length > 0) {
      footer = m.tower_guide_hidden_count({ found: hidden.filter((room) => known.has(room)).length, total: hidden.length }, { locale });
    }
  } else if (current === GUIDE_MARKERS_PAGE) {
    for (const marker of GUIDE_MARKERS) {
      const name = markerName(marker, locale);
      entries.push({ name, description: markerDescription(marker, locale) });
      legend.push({ marker, label: name });
    }
  } else {
    for (const modifier of TOWER_FLOOR_MODIFIERS.filter((entry) => entry !== 'NONE')) {
      entries.push({ name: modifierName(modifier, locale), description: modifierDescription(modifier, locale) });
    }
    footer = m.tower_guide_ambience_footer({}, { locale });
  }

  textBlock(container, [header(config, `${m.tower_guide_title({}, { locale })} · ${title}`), `-# ${m.tower_guide_intro({}, { locale })}`].join('\n'));
  if (legend.length > 0) {
    const image = await renderTowerImage({ kind: 'legend', title, entries: legend });
    if (image) {
      files.push({ attachment: image, name: TOWER_IMAGE_FILENAME });
      container.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder({ media: { url: `attachment://${TOWER_IMAGE_FILENAME}` } }),
      ));
    }
  }
  separator(container);
  // Le nom sur sa ligne, la description dessous en petit : une liste qui se lit d'un coup d'œil.
  textBlock(container, [
    ...entries.map((entry) => `**${entry.name}**\n-# ${entry.description}`),
    ...(footer ? ['', `-# ${footer}`] : []),
  ].join('\n'));

  return {
    embeds: [],
    container,
    files,
    components: [
      row(...titles.map((label, index) => button(`twr:guide:${ownerId}:${index}`, label, index === current ? ButtonStyle.Primary : ButtonStyle.Secondary, undefined, index === current))),
      row(button(`twr:home:${ownerId}`, m.tower_btn_home({}, { locale }), ButtonStyle.Secondary, icon('rpgBack'))),
    ],
  };
}

/** Paliers collectifs du clan : étages gravis au total, bonus acquis et prochain palier. */
function clanMilestoneLine(total: number, bonus: ClanTowerBonus, locale: Locale): string {
  const parts = [
    bonus.potions > 0 ? m.tower_clan_bonus_potions({ count: bonus.potions }, { locale }) : '',
    bonus.healthPercent > 0 ? m.tower_clan_bonus_health({ percent: bonus.healthPercent }, { locale }) : '',
    bonus.attackPercent > 0 ? m.tower_clan_bonus_attack({ percent: bonus.attackPercent }, { locale }) : '',
  ].filter(Boolean);
  return [
    m.tower_clan_total({ floors: total }, { locale }),
    parts.length > 0 ? m.tower_clan_bonus({ bonus: parts.join(', ') }, { locale }) : m.tower_clan_bonus_none({}, { locale }),
    bonus.next !== null ? m.tower_clan_next_milestone({ floors: bonus.next }, { locale }) : '',
  ].filter(Boolean).join(' · ');
}

/** Classement de la Tour de clan en cours. */
async function buildClanTowerView(client: Client, guildId: string, ownerId: string, locale: Locale): Promise<PanelView> {
  const [config, status] = await Promise.all([getTowerPlayConfig(guildId, 'CLAN'), getClanTowerStatus(client, guildId, ownerId)]);
  const container = new ContainerBuilder().setAccentColor(COLOR);
  const back = row(button(`twr:home:${ownerId}`, m.tower_btn_home({}, { locale }), ButtonStyle.Secondary, icon('rpgBack')));
  if (!status) {
    textBlock(container, `${header(config)}\n${m.tower_refused_clan_closed({}, { locale })}`);
    return { embeds: [], container, components: [back] };
  }
  const standings = await listClanTowerStandings(guildId, status.eventId);
  const lines = standings.slice(0, 15).map((standing) =>
    `${standing.rank <= 3 ? rankEmoji(standing.rank) : `**${standing.rank}.**`} **${escapeMarkdown(standing.name)}** — ${m.tower_top_floors({ floors: standing.floors }, { locale })}`
    + (standing.climbers[0] ? ` · <@${standing.climbers[0].userId}>` : ''));
  const mine = status.clan ? standings.find((standing) => standing.clanId === status.clan!.id) : undefined;
  const you = status.clan
    ? ['', m.tower_clan_top_you({ clan: escapeMarkdown(status.clan.name), floors: mine?.floors ?? 0 }, { locale }), `-# ${clanMilestoneLine(status.totalFloors, status.bonus, locale)}`]
    : [];
  textBlock(container, [
    header(config, m.tower_clan_top_title({}, { locale })),
    `-# ${m.tower_clan_top_rules({ end: discordTime(status.endsAt, 'F') }, { locale })}`,
    '',
    lines.length > 0 ? lines.join('\n') : `*${m.tower_clan_top_empty({}, { locale })}*`,
    ...you,
  ].join('\n'));
  return { embeds: [], container, components: [back] };
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
  if (code === 'au') return { type: 'auto' };
  if (code === 'py') return { type: 'pay' };
  if (code === 'fc') return { type: 'force' };
  if (code === 'dk') return { type: 'drink' };
  if (code === 'dn') return { type: 'donate' };
  if (code === 're') return { type: 'reveal' };
  if (code.startsWith('s-')) return { type: 'skill', id: code.slice(2) };
  const index = Number.parseInt(code.slice(1), 10);
  if (!Number.isInteger(index) || index < 0 || index > 4) return null;
  if (code.startsWith('d')) return { type: 'door', index };
  if (code.startsWith('b')) return { type: 'bless', index };
  if (code.startsWith('m')) return { type: 'buy', index };
  if (code.startsWith('e')) return { type: 'event', index };
  if (code.startsWith('l')) return { type: 'learn', index };
  return null;
}

/** Masque de choix lu dans un identifiant de bouton ; absent ou illisible : rien de coché. */
function mask(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? '0', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
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
      // Toute ascension passe par la préparation : compétences à acheter et chaleur à choisir.
      case 'enter': await respond(interaction, await buildTowerPrepView(guildId, ownerId, locale, 0, 0)); return;
      case 'prep': await respond(interaction, await buildTowerPrepView(guildId, ownerId, locale, mask(rest[0]), mask(rest[1]))); return;
      case 'go': {
        const active = await startTowerRun(client, guildId, ownerId, { skillMask: mask(rest[0]), heatMask: mask(rest[1]) });
        await respond(interaction, await buildTowerRunView(guildId, ownerId, locale, active));
        return;
      }
      case 'a': {
        const version = Number.parseInt(rest[0] ?? '', 10);
        const towerAction = parseActionCode(rest.slice(1).join(':'));
        if (!Number.isInteger(version) || !towerAction) return;
        const result = await actTowerRun(client, guildId, ownerId, version, towerAction);
        const view = result.settlement
          ? await buildTowerSettlementView(guildId, ownerId, locale, result.settlement)
          : result.active ? await buildTowerRunView(guildId, ownerId, locale, result.active) : null;
        if (!view) return;
        // Une salle piégée rencontrée pour la première fois rejoint le guide : on le dit.
        const found = (result.discovered ?? []).map((room) => hiddenRoomName(room, locale)).join(', ');
        await respond(interaction, found ? withNote(view, m.tower_guide_discovered({ rooms: found }, { locale })) : view);
        return;
      }
      case 'quitask': {
        const version = Number.parseInt(rest[0] ?? '', 10);
        const { active } = await getActiveTowerRun(client, guildId, ownerId);
        if (!active || active.run.version !== version) throw new TowerRefused({ kind: 'stale' });
        if (active.state.phase === 'COMBAT') throw new TowerRefused({ kind: 'in_combat' });
        await respond(interaction, leaveConfirmView(await getTowerPlayConfig(guildId, active.run.mode), ownerId, version, active, locale));
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
        const { reward, stat } = await buyTowerReward(client, guildId, ownerId, rest[0] ?? '');
        const view = await buildTowerShopView(guildId, ownerId, locale, Number.parseInt(rest[1] ?? '0', 10) || 0);
        // La stat gagnée est dite en clair : celle d'un article aléatoire n'est connue qu'ici.
        const note = stat
          ? m.tower_shop_bought_stat({ emoji: reward.emoji, name: reward.name, stat: statGrantText(stat, locale) }, { locale })
          : m.tower_shop_bought({ emoji: reward.emoji, name: reward.name }, { locale });
        await respond(interaction, withNote(view, note));
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
      case 'clan': {
        const active = await startTowerRun(client, guildId, ownerId, { clan: true });
        await respond(interaction, await buildTowerRunView(guildId, ownerId, locale, active));
        return;
      }
      case 'ctop': await respond(interaction, await buildClanTowerView(client, guildId, ownerId, locale)); return;
      case 'guide': await respond(interaction, await buildTowerGuideView(guildId, ownerId, locale, Number.parseInt(rest[0] ?? '0', 10) || 0)); return;
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
