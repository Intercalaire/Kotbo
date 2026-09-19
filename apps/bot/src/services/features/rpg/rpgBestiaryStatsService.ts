/**
 * Le carnet de chasse : ce qu'un joueur a affronté, et comment ça s'est passé.
 *
 * Le bestiaire ne disait que « découvert » ou « pas découvert ». Combien de fois on a
 * abattu une créature, combien de fois elle nous a eu, ce qu'on lui a arraché — rien de
 * tout cela n'était visible, alors que `RpgBattle` le consigne depuis toujours.
 *
 * Aucune colonne n'est ajoutée : tout se dérive du journal de combats, ce qui rend le
 * carnet exact rétroactivement, y compris pour les combats livrés avant cet écran.
 */

import prisma from '../../../utils/db.js';
import { listGuildMonsters, type ResolvedMonster } from './rpgBestiaryService.js';

/** Bilan d'un joueur face à une créature. */
export type MonsterRecord = {
  monsterId: string;
  kills: number;
  defeats: number;
  /** Plus gros total de dégâts infligés en un seul combat. */
  bestDamage: number;
  totalDamageDealt: number;
  totalDamageTaken: number;
  coinsEarned: number;
  xpEarned: number;
  lastFoughtAt: Date | null;
};

const EMPTY_RECORD: Omit<MonsterRecord, 'monsterId'> = {
  kills: 0,
  defeats: 0,
  bestDamage: 0,
  totalDamageDealt: 0,
  totalDamageTaken: 0,
  coinsEarned: 0,
  xpEarned: 0,
  lastFoughtAt: null,
};

/** Une entrée du bestiaire : la créature, et ce que le joueur en sait. */
export type BestiaryEntry = {
  monster: ResolvedMonster;
  record: MonsterRecord;
  /** `false` tant que le joueur ne l'a jamais affrontée. */
  discovered: boolean;
};

export type BestiaryOverview = {
  entries: BestiaryEntry[];
  discoveredCount: number;
  totalCount: number;
  totalKills: number;
  totalDefeats: number;
  /** Part de victoires, de 0 à 1. Vaut 0 quand aucun combat n'a été livré. */
  winRate: number;
  bossesSlain: number;
};

/**
 * Agrège le journal de combats d'un joueur, par créature.
 *
 * Un `groupBy` suffirait pour les compteurs, mais pas pour `bestDamage` : on agrège donc
 * en mémoire, sur des lignes volontairement étroites. Le volume reste celui des combats
 * d'UN joueur sur UN serveur, ce qui tient largement.
 */
export async function loadMonsterRecords(guildId: string, userId: string): Promise<Map<string, MonsterRecord>> {
  const battles = await prisma.rpgBattle.findMany({
    where: { guildId, userId },
    select: {
      monsterId: true,
      won: true,
      damageDealt: true,
      damageTaken: true,
      xpEarned: true,
      coinsEarned: true,
      createdAt: true,
    },
  });

  const records = new Map<string, MonsterRecord>();

  for (const battle of battles) {
    const record = records.get(battle.monsterId)
      ?? { ...EMPTY_RECORD, monsterId: battle.monsterId };

    if (battle.won) record.kills += 1;
    else record.defeats += 1;

    record.bestDamage = Math.max(record.bestDamage, battle.damageDealt);
    record.totalDamageDealt += battle.damageDealt;
    record.totalDamageTaken += battle.damageTaken;
    record.coinsEarned += battle.coinsEarned;
    record.xpEarned += battle.xpEarned;

    if (!record.lastFoughtAt || battle.createdAt > record.lastFoughtAt) {
      record.lastFoughtAt = battle.createdAt;
    }

    records.set(battle.monsterId, record);
  }

  return records;
}

/**
 * Le bestiaire complet du serveur, annoté du carnet du joueur.
 *
 * Les créatures jamais affrontées sont incluses, mais marquées non découvertes : voir
 * qu'il reste vingt bêtes inconnues est précisément ce qui donne envie de les chercher,
 * là où une liste des seules créatures déjà vues ne dit rien de ce qui manque.
 */
export async function getBestiaryOverview(guildId: string, userId: string): Promise<BestiaryOverview> {
  const [monsters, records] = await Promise.all([
    listGuildMonsters(guildId),
    loadMonsterRecords(guildId, userId),
  ]);

  const entries: BestiaryEntry[] = monsters.map((monster) => {
    const record = records.get(monster.id) ?? { ...EMPTY_RECORD, monsterId: monster.id };
    return { monster, record, discovered: record.kills + record.defeats > 0 };
  });

  // Du plus faible au plus fort : c'est l'ordre dans lequel on les rencontre, donc celui
  // où le joueur s'attend à les retrouver.
  entries.sort((a, b) => a.monster.level - b.monster.level || a.monster.name.localeCompare(b.monster.name));

  let totalKills = 0;
  let totalDefeats = 0;
  let bossesSlain = 0;

  for (const entry of entries) {
    totalKills += entry.record.kills;
    totalDefeats += entry.record.defeats;
    if (entry.monster.isBoss) bossesSlain += entry.record.kills;
  }

  const fought = totalKills + totalDefeats;

  return {
    entries,
    discoveredCount: entries.filter((entry) => entry.discovered).length,
    totalCount: entries.length,
    totalKills,
    totalDefeats,
    winRate: fought > 0 ? totalKills / fought : 0,
    bossesSlain,
  };
}

/** Une entrée précise, pour la fiche d'une créature. */
export async function getBestiaryEntry(
  guildId: string,
  userId: string,
  monsterId: string,
): Promise<BestiaryEntry | null> {
  const overview = await getBestiaryOverview(guildId, userId);
  return overview.entries.find((entry) => entry.monster.id === monsterId) ?? null;
}
