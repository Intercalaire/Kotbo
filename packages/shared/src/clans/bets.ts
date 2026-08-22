/**
 * Règles des paris en points de clan, partagées entre le bot et le dashboard.
 *
 * Les bornes vivent ici pour qu'un réglage refusé par l'API le soit aussi dans
 * le formulaire : sans source unique, la page laisse saisir une valeur que le
 * serveur rejette ensuite sans explication utile.
 */

export const BET_STAKE_FLOOR = 1;
/** Aligné sur le plafond d'un versement de points de clan. */
export const BET_STAKE_CEILING = 1_000_000;
export const BET_SUBJECT_MAX_LENGTH = 200;
export const BET_OPEN_PER_MEMBER_CEILING = 25;
export const BET_ACCEPT_WINDOW_HOURS_MIN = 1;
export const BET_ACCEPT_WINDOW_HOURS_MAX = 720;
/**
 * Plafond de la dette autorisée. Une dette non bornée permet de miser sans fin
 * des points qu'on n'a pas : le classement de la saison deviendrait une liste
 * de promesses plutôt qu'un relevé de contributions.
 */
export const BET_DEBT_CEILING = 1_000_000;

export interface ClanBetSettings {
  betsEnabled: boolean;
  betChannelId: string | null;
  betAnnouncementChannelId: string | null;
  betMinStake: number;
  betMaxStake: number;
  betMaxOpenPerMember: number;
  betAcceptWindowHours: number;
  betAllowDebt: boolean;
  betMaxDebt: number;
  betDebtResetOnSeason: boolean;
  betResolverRoleIds: string[];
}

export const DEFAULT_CLAN_BET_SETTINGS: ClanBetSettings = {
  betsEnabled: false,
  betChannelId: null,
  betAnnouncementChannelId: null,
  betMinStake: 10,
  betMaxStake: 10_000,
  betMaxOpenPerMember: 5,
  betAcceptWindowHours: 48,
  betAllowDebt: false,
  betMaxDebt: 5_000,
  betDebtResetOnSeason: false,
  betResolverRoleIds: [],
};

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

/**
 * Ramène des réglages venus de la base ou du formulaire dans leurs bornes.
 *
 * Une mise minimale au-dessus de la maximale rendrait tout pari impossible sans
 * que rien ne le signale : les deux sont donc réordonnées plutôt que refusées.
 */
export function normalizeClanBetSettings(raw: Partial<ClanBetSettings> | null | undefined): ClanBetSettings {
  const source = raw ?? {};
  const minStake = clampInt(source.betMinStake, BET_STAKE_FLOOR, BET_STAKE_CEILING, DEFAULT_CLAN_BET_SETTINGS.betMinStake);
  const maxStake = clampInt(source.betMaxStake, BET_STAKE_FLOOR, BET_STAKE_CEILING, DEFAULT_CLAN_BET_SETTINGS.betMaxStake);

  return {
    betsEnabled: source.betsEnabled ?? DEFAULT_CLAN_BET_SETTINGS.betsEnabled,
    betChannelId: source.betChannelId ?? null,
    betAnnouncementChannelId: source.betAnnouncementChannelId ?? null,
    betMinStake: Math.min(minStake, maxStake),
    betMaxStake: Math.max(minStake, maxStake),
    betMaxOpenPerMember: clampInt(source.betMaxOpenPerMember, 1, BET_OPEN_PER_MEMBER_CEILING, DEFAULT_CLAN_BET_SETTINGS.betMaxOpenPerMember),
    betAcceptWindowHours: clampInt(
      source.betAcceptWindowHours,
      BET_ACCEPT_WINDOW_HOURS_MIN,
      BET_ACCEPT_WINDOW_HOURS_MAX,
      DEFAULT_CLAN_BET_SETTINGS.betAcceptWindowHours,
    ),
    betAllowDebt: source.betAllowDebt ?? DEFAULT_CLAN_BET_SETTINGS.betAllowDebt,
    betMaxDebt: clampInt(source.betMaxDebt, 0, BET_DEBT_CEILING, DEFAULT_CLAN_BET_SETTINGS.betMaxDebt),
    betDebtResetOnSeason: source.betDebtResetOnSeason ?? DEFAULT_CLAN_BET_SETTINGS.betDebtResetOnSeason,
    betResolverRoleIds: Array.isArray(source.betResolverRoleIds) ? source.betResolverRoleIds : [],
  };
}

export type StakeRejection =
  | { ok: false; reason: 'not-integer' }
  | { ok: false; reason: 'below-min'; min: number }
  | { ok: false; reason: 'above-max'; max: number };

export type StakeCheck = { ok: true; stake: number } | StakeRejection;

export function checkStake(raw: number, settings: Pick<ClanBetSettings, 'betMinStake' | 'betMaxStake'>): StakeCheck {
  if (!Number.isInteger(raw)) return { ok: false, reason: 'not-integer' };
  if (raw < settings.betMinStake) return { ok: false, reason: 'below-min', min: settings.betMinStake };
  if (raw > settings.betMaxStake) return { ok: false, reason: 'above-max', max: settings.betMaxStake };
  return { ok: true, stake: raw };
}

export type FundingPlan =
  | { ok: true; fromPoints: number; fromDebt: number }
  | { ok: false; reason: 'insufficient-points'; available: number }
  | { ok: false; reason: 'debt-ceiling'; available: number; maxDebt: number; currentDebt: number };

/**
 * Comment couvrir une mise : d'abord les points disponibles, le reste à crédit
 * quand le mode dette est ouvert.
 *
 * Les points sont toujours consommés en premier. L'inverse laisserait un membre
 * accumuler de la dette tout en gardant un score au classement, ce qui revient à
 * afficher des points déjà engagés ailleurs.
 */
export function planStakeFunding(params: {
  stake: number;
  availablePoints: number;
  allowDebt: boolean;
  maxDebt: number;
  currentDebt: number;
}): FundingPlan {
  const { stake, allowDebt, maxDebt } = params;
  const availablePoints = Math.max(0, params.availablePoints);
  const currentDebt = Math.max(0, params.currentDebt);

  if (stake <= availablePoints) return { ok: true, fromPoints: stake, fromDebt: 0 };
  if (!allowDebt) return { ok: false, reason: 'insufficient-points', available: availablePoints };

  const missing = stake - availablePoints;
  if (currentDebt + missing > maxDebt) {
    return { ok: false, reason: 'debt-ceiling', available: availablePoints, maxDebt, currentDebt };
  }

  return { ok: true, fromPoints: availablePoints, fromDebt: missing };
}

/**
 * Répartition d'un gain de points entre remboursement de dette et solde.
 *
 * La dette se rembourse avant tout crédit : un membre endetté qui verrait ses
 * gains arriver au classement pourrait miser à l'infini sans jamais rembourser.
 */
export function applyDebtRepayment(gain: number, debt: number): { repaid: number; credited: number; remainingDebt: number } {
  const amount = Math.max(0, Math.floor(gain));
  const owed = Math.max(0, Math.floor(debt));
  const repaid = Math.min(amount, owed);
  return { repaid, credited: amount - repaid, remainingDebt: owed - repaid };
}

/**
 * Le sujet part dans un titre d'embed et dans un nom de fil : les retours à la
 * ligne y sont invisibles ou cassants, ils sont donc aplatis à la saisie plutôt
 * qu'à chaque affichage.
 */
export function normalizeBetSubject(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim();
}

/** Nom du fil ouvert sous l'annonce, borné aux 100 caractères de Discord. */
export function buildBetThreadName(subject: string): string {
  return `Pari - ${subject}`.slice(0, 100);
}

export interface BetStakeLedger {
  challengerEscrow: number;
  opponentEscrow: number;
  challengerDebt: number;
  opponentDebt: number;
}

/**
 * Enjeu total d'un pari : ce qui a été prélevé des deux côtés, plus ce qui a été
 * engagé à crédit.
 *
 * Le crédit compte dans le pot, sinon le gagnant d'un pari contre un membre
 * endetté toucherait moins que la mise annoncée. Le prélèvement peut avoir été
 * rogné par le plafond de saison : c'est bien le montant inscrit qui est
 * redistribué, jamais la mise théorique, sous peine de créer des points.
 */
export function computeBetPot(ledger: BetStakeLedger): number {
  return Math.max(0, ledger.challengerEscrow) + Math.max(0, ledger.opponentEscrow)
    + Math.max(0, ledger.challengerDebt) + Math.max(0, ledger.opponentDebt);
}

/**
 * Ce qu'un parieur a réellement engagé : ses points prélevés, plus sa part à
 * crédit.
 */
export function betSideStake(ledger: BetStakeLedger, side: 'challenger' | 'opponent'): number {
  return side === 'challenger'
    ? Math.max(0, ledger.challengerEscrow) + Math.max(0, ledger.challengerDebt)
    : Math.max(0, ledger.opponentEscrow) + Math.max(0, ledger.opponentDebt);
}

/**
 * Gain net du gagnant : ce qu'il empoche en plus de sa propre mise, qui lui
 * revient.
 *
 * C'est le seul chiffre à annoncer publiquement. Le pot vaut deux mises, dont
 * une lui appartenait déjà : afficher « +200 » face à « -100 » donnerait à lire
 * une création de points là où il n'y a qu'un transfert.
 */
export function computeBetNetGain(ledger: BetStakeLedger, side: 'challenger' | 'opponent'): number {
  return computeBetPot(ledger) - betSideStake(ledger, side);
}
