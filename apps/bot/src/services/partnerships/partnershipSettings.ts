/**
 * Réglages du module Partenariats.
 *
 * Une seule ligne par serveur, créée à la première écriture et jamais à la
 * lecture : un serveur qui n'a jamais ouvert le module ne doit pas se voir
 * fabriquer une configuration au premier passage d'un cron.
 *
 * La lecture renvoie donc toujours un objet complet - la ligne si elle existe,
 * les valeurs par défaut sinon - ce qui évite à chaque appelant de refaire le
 * même `?? valeurParDéfaut` sur trente champs.
 */
import type { PartnershipSettings } from '@prisma/client';
import prisma from '../../utils/db.js';
import { cache } from '../../utils/cache.js';
import { isModuleEnabled } from '../core/moduleGate.js';

/** Clé du module dans `MODULE_REGISTRY`. */
export const PARTNERSHIPS_MODULE = 'partnerships';

/**
 * Réglages effectifs. Reprend champ pour champ les valeurs par défaut du
 * schéma : elles y sont déclarées une fois, ici elles servent aux serveurs qui
 * n'ont pas encore de ligne.
 */
export type EffectivePartnershipSettings = Omit<PartnershipSettings, 'createdAt' | 'updatedAt'>;

function defaults(guildId: string): EffectivePartnershipSettings {
  return {
    guildId,
    enabled: false,
    defaultTier: 'PIPELINE',
    requireDualApproval: false,
    staffChannelId: null,
    showcaseChannelId: null,
    adsChannelId: null,
    dedicatedCategoryId: null,
    partnerRoleId: null,
    referredRoleId: null,
    applicationsOpen: false,
    applicationFormId: null,
    applicationTicketTypeId: null,
    minMemberCount: 0,
    minServerAgeDays: 0,
    autoRejectBelowThreshold: false,
    autoPublishAds: false,
    adRotationHours: 0,
    reciprocityChecks: false,
    reciprocityIntervalHours: 24,
    reciprocityGraceCount: 2,
    autoApplyBenefits: true,
    autoBreachOnFailure: false,
    renewalNoticeDays: 14,
    autoArchiveAfterDays: 0,
    trackInvites: true,
    trackReferredActivity: true,
    retentionWindowDays: 30,
    notifyStaffChannel: true,
    notifyDashboard: true,
    notifyOwnerDm: false,
    digestFrequency: 'weekly',
    digestChannelId: null,
    alertRoleIds: [],
    directoryOptIn: false,
    directoryAcceptProposals: true,
    matchmakingEnabled: false,
    reputationShare: false,
    reputationConsume: false,
    financeEnabled: false,
    currency: 'EUR',
    paymentReminderDays: 3,
  };
}

/**
 * Relus deux fois par message sur les serveurs où le module tourne (garde
 * `isPartnershipsActive` puis suivi des arrivées) : mis en cache sous le
 * préfixe `guild:<id>:`, et invalidés par `updatePartnershipSettings`.
 */
const SETTINGS_TTL_SECONDS = 60;
const settingsKey = (guildId: string) => `guild:${guildId}:partnership-settings`;

export async function getPartnershipSettings(guildId: string): Promise<EffectivePartnershipSettings> {
  return cache.wrap(settingsKey(guildId), SETTINGS_TTL_SECONDS, async () => {
    const row = await prisma.partnershipSettings.findUnique({
      where: { guildId },
      omit: { createdAt: true, updatedAt: true },
    });
    return row ?? defaults(guildId);
  });
}

/**
 * Réglages de plusieurs serveurs en une requête. Les crons balaient tous les
 * serveurs actifs : sans cela, chaque passage ferait une lecture par serveur.
 */
export async function getPartnershipSettingsMany(
  guildIds: string[],
): Promise<Map<string, EffectivePartnershipSettings>> {
  const rows = await prisma.partnershipSettings.findMany({ where: { guildId: { in: guildIds } } });
  const byGuild = new Map<string, EffectivePartnershipSettings>(rows.map((row) => [row.guildId, row]));
  for (const guildId of guildIds) {
    if (!byGuild.has(guildId)) byGuild.set(guildId, defaults(guildId));
  }
  return byGuild;
}

export async function updatePartnershipSettings(
  guildId: string,
  patch: Partial<Omit<EffectivePartnershipSettings, 'guildId'>>,
): Promise<EffectivePartnershipSettings> {
  const settings = await prisma.partnershipSettings.upsert({
    where: { guildId },
    create: { ...defaults(guildId), ...patch, guildId },
    update: patch,
  });
  await cache.delete(settingsKey(guildId));
  return settings;
}

/**
 * Le module tourne-t-il pour ce serveur ?
 *
 * Deux conditions, et les deux comptent : le module activé dans le registre
 * (qui porte aussi l'offre commerciale, cf. `moduleGate`) **et** le drapeau
 * propre au module. Le second permet d'arrêter les automatismes - publications,
 * relances, contrôles - sans faire disparaître les pages ni les données.
 */
export async function isPartnershipsActive(guildId: string): Promise<boolean> {
  if (!(await isModuleEnabled(guildId, PARTNERSHIPS_MODULE))) return false;
  const settings = await getPartnershipSettings(guildId);
  return settings.enabled;
}

/** Serveurs dont le module est allumé, pour les balayages périodiques. */
export async function listActivePartnershipGuildIds(): Promise<string[]> {
  const rows = await prisma.partnershipSettings.findMany({
    where: { enabled: true },
    select: { guildId: true },
  });

  const active: string[] = [];
  for (const row of rows) {
    // La garde reste consultée serveur par serveur : elle porte l'offre
    // commerciale et la cascade des dépendances, qu'une lecture de cette table
    // seule ignorerait.
    if (await isModuleEnabled(row.guildId, PARTNERSHIPS_MODULE)) active.push(row.guildId);
  }
  return active;
}
