/**
 * Ce que reçoit un membre arrivé par un partenaire.
 *
 * Les avantages de `partnershipBenefitService` visent les représentants du
 * partenaire - leur rôle, leurs accès. Ceux-ci visent les membres qu'il
 * apporte, et ne s'appliquent donc qu'au moment de leur arrivée. D'où un
 * fichier séparé : le premier s'applique à l'activation du dossier, le second
 * à chaque arrivée, et rien ne gagnait à les mélanger.
 *
 * Trois gestes, tous facultatifs et tous idempotents - une arrivée rejouée
 * (reprise après incident, membre revenu puis reparti) ne doit pas créditer
 * deux fois :
 *   - le rôle « venu d'un partenaire », qui sert aussi de levier au
 *     multiplicateur d'XP par rôle déjà géré par le module Niveaux ;
 *   - la prime de bienvenue, en monnaie du serveur ;
 *   - le rôle VIP temporaire, quand l'avantage en déclare un.
 */
import type { Client } from 'discord.js';
import prisma from '../../utils/db.js';
import { logger } from '../../utils/logger.js';
import { getClient } from '../../utils/client.js';
import { isModuleEnabled } from '../core/moduleGate.js';
import { getPartnershipSettings } from './partnershipSettings.js';
import { recordPartnershipEvent } from './partnershipEvents.js';

/**
 * Applique les avantages d'arrivée. Silencieux quand rien n'est configuré :
 * c'est le cas le plus fréquent, et ce n'est pas une anomalie.
 */
export async function grantReferralBenefits(params: {
  guildId: string;
  userId: string;
  partnershipId: string;
  client?: Client;
}): Promise<void> {
  const settings = await getPartnershipSettings(params.guildId);

  const benefits = await prisma.partnershipBenefit.findMany({
    where: {
      partnershipId: params.partnershipId,
      state: 'APPLIED',
      direction: 'GRANTED',
      kind: { in: ['COIN_BONUS', 'XP_BONUS', 'RAID_WHITELIST'] },
    },
  });

  const coinBenefit = benefits.find((benefit) => benefit.kind === 'COIN_BONUS');

  if (!settings.referredRoleId && !coinBenefit) return;

  const discord = params.client ?? getClient();
  const guild = await discord.guilds.fetch(params.guildId).catch(() => null);
  if (!guild) return;

  if (settings.referredRoleId) {
    const member = await guild.members.fetch(params.userId).catch(() => null);
    if (member && !member.roles.cache.has(settings.referredRoleId)) {
      await member.roles
        .add(settings.referredRoleId, 'Membre venu par un partenaire')
        .catch((error) => {
          logger.warn('Partenariats : role d\'arrivee non applique', { userId: params.userId, error });
        });
    }
  }

  if (coinBenefit) await grantWelcomeCoins(params, coinBenefit.targetRef);
}

/**
 * Crédite la prime de bienvenue.
 *
 * L'idempotence repose sur `PartnershipBenefitGrant` : la prime n'est versée
 * que si aucune trace n'existe pour ce membre. Sans cela, un membre qui part et
 * revient par la même invitation se ferait créditer à chaque passage, ce qui
 * est exactement le genre de boucle qu'un partenaire peu scrupuleux cherche.
 */
async function grantWelcomeCoins(
  params: { guildId: string; userId: string; partnershipId: string },
  targetRef: string | null,
): Promise<void> {
  const amount = Number.parseInt(targetRef ?? '', 10);
  if (!Number.isFinite(amount) || amount <= 0) return;

  if (!(await isModuleEnabled(params.guildId, 'economy'))) return;

  const benefit = await prisma.partnershipBenefit.findFirst({
    where: { partnershipId: params.partnershipId, kind: 'COIN_BONUS', state: 'APPLIED' },
    select: { id: true },
  });
  if (!benefit) return;

  const already = await prisma.partnershipBenefitGrant.findUnique({
    where: { benefitId_subjectId: { benefitId: benefit.id, subjectId: params.userId } },
    select: { id: true },
  });
  if (already) return;

  await prisma.rpgProfile.upsert({
    where: { guildId_userId: { guildId: params.guildId, userId: params.userId } },
    create: { guildId: params.guildId, userId: params.userId, balance: amount },
    update: { balance: { increment: amount } },
  });

  await prisma.partnershipBenefitGrant.create({
    data: {
      benefitId: benefit.id,
      subjectId: params.userId,
      subjectType: 'member',
      // La prime est versée, pas prêtée : la révocation du partenariat ne la
      // reprend pas. `preExisting` le dit au service de retrait.
      preExisting: true,
    },
  });

  await recordPartnershipEvent({
    partnershipId: params.partnershipId,
    kind: 'referral_bonus',
    summary: `Prime de bienvenue versée (${amount}).`,
    payload: { userId: params.userId, amount },
  });
}
