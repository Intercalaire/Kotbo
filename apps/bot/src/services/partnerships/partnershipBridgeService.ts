/**
 * Ponts entre deux dossiers, quand les deux serveurs ont Kotbo.
 *
 * Chaque équipe garde son dossier : ses notes, son responsable, ses avantages.
 * Le pont dit seulement que les deux dossiers parlent du même accord, et
 * synchronise ce que les deux ont accepté de synchroniser (`syncedFields`).
 *
 * ── Ce que le pont ne fait jamais ───────────────────────────────────────────
 *
 * Il ne pousse pas d'état : il en propose. Concrètement, une étape reçue du
 * dossier distant n'écrase pas l'étape locale - elle déclenche une alerte pour
 * que l'équipe locale statue. Sans cette règle, l'équipe d'en face pourrait
 * activer un partenariat chez nous, donc appliquer des rôles et des exemptions
 * sur notre serveur, sans que personne de chez nous ait rien décidé.
 *
 * Les deux exceptions, sûres parce qu'elles ne font que retirer : la rupture et
 * la fin. Si l'autre partie a mis fin au partenariat, le maintenir actif chez
 * nous n'aurait aucun sens.
 */
import type { PartnershipBridge } from '@prisma/client';
import prisma from '../../utils/db.js';
import { logger } from '../../utils/logger.js';
import { recordPartnershipEvent, sendPartnershipAlert } from './partnershipEvents.js';
import { changePartnershipStage } from './partnershipService.js';

/** Champs qu'un pont peut synchroniser. */
export const SYNCABLE_FIELDS = ['stage', 'agreement', 'commitments', 'promotions'] as const;
export type SyncableField = (typeof SYNCABLE_FIELDS)[number];

/**
 * Propose un pont entre un dossier local et un dossier distant. Non confirmé
 * tant que l'autre côté n'a pas accepté : un pont posé unilatéralement
 * laisserait un serveur lire l'état d'un dossier qui ne le regarde pas.
 */
export async function proposeBridge(params: {
  localPartnershipId: string;
  remotePartnershipId: string;
  syncedFields?: SyncableField[];
}): Promise<PartnershipBridge> {
  const [local, remote] = await Promise.all([
    prisma.partnership.findUnique({ where: { id: params.localPartnershipId }, select: { guildId: true } }),
    prisma.partnership.findUnique({ where: { id: params.remotePartnershipId }, select: { guildId: true } }),
  ]);

  if (!local?.guildId || !remote?.guildId) throw new Error('Dossier introuvable ou hors serveur.');
  if (local.guildId === remote.guildId) throw new Error('Un pont relie deux serveurs distincts.');

  return prisma.partnershipBridge.upsert({
    where: {
      localPartnershipId_remotePartnershipId: {
        localPartnershipId: params.localPartnershipId,
        remotePartnershipId: params.remotePartnershipId,
      },
    },
    create: {
      localPartnershipId: params.localPartnershipId,
      remotePartnershipId: params.remotePartnershipId,
      localGuildId: local.guildId,
      remoteGuildId: remote.guildId,
      syncedFields: (params.syncedFields ?? ['stage']) as string[],
    },
    update: { syncedFields: (params.syncedFields ?? ['stage']) as string[] },
  });
}

export async function confirmBridge(bridgeId: string): Promise<PartnershipBridge> {
  const bridge = await prisma.partnershipBridge.update({
    where: { id: bridgeId },
    data: { confirmed: true, confirmedAt: new Date() },
  });

  for (const partnershipId of [bridge.localPartnershipId, bridge.remotePartnershipId]) {
    await recordPartnershipEvent({
      partnershipId,
      kind: 'bridge_confirmed',
      summary: 'Pont confirmé : les deux serveurs suivent le même accord.',
      source: 'bridge',
    });
  }

  return bridge;
}

export async function removeBridge(bridgeId: string): Promise<void> {
  await prisma.partnershipBridge.delete({ where: { id: bridgeId } }).catch(() => null);
}

/**
 * Propage un changement d'étape au dossier d'en face.
 *
 * Fin et rupture sont appliquées directement - elles ne font que retirer des
 * droits. Tout le reste est signalé à l'équipe distante, qui décide.
 */
export async function propagateStageChange(partnershipId: string, stage: string): Promise<void> {
  const bridges = await prisma.partnershipBridge.findMany({
    where: {
      confirmed: true,
      OR: [{ localPartnershipId: partnershipId }, { remotePartnershipId: partnershipId }],
    },
  });

  for (const bridge of bridges) {
    if (!bridge.syncedFields.includes('stage')) continue;

    const otherId =
      bridge.localPartnershipId === partnershipId ? bridge.remotePartnershipId : bridge.localPartnershipId;

    const other = await prisma.partnership.findUnique({
      where: { id: otherId },
      include: { partner: { select: { displayName: true } } },
    });
    if (!other?.guildId) continue;

    try {
      if (stage === 'ENDED' || stage === 'BREACHED') {
        if (!['ENDED', 'BREACHED', 'ARCHIVED'].includes(other.stage)) {
          await changePartnershipStage({
            partnershipId: otherId,
            stage: stage === 'BREACHED' ? 'BREACHED' : 'ENDED',
            reason:
              stage === 'BREACHED'
                ? "Rompu par l'autre partie."
                : "Terminé par l'autre partie.",
            actor: { userId: 'bridge', source: 'bridge' },
          });
        }
      } else {
        await sendPartnershipAlert({
          guildId: other.guildId,
          title: 'Le partenaire a fait avancer son dossier',
          description: `${other.partner.displayName} est passé à l'étape ${stage} de son côté. À vous de statuer sur le vôtre.`,
          tone: 'info',
          ownerUserId: other.ownerUserId,
          link: `/partnerships/${otherId}`,
        });
        await recordPartnershipEvent({
          partnershipId: otherId,
          kind: 'bridge_stage_notice',
          summary: `Le partenaire est passé à l'étape ${stage}.`,
          payload: { remoteStage: stage },
          source: 'bridge',
        });
      }

      await prisma.partnershipBridge.update({
        where: { id: bridge.id },
        data: { lastSyncAt: new Date(), lastSyncError: null },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn('Partenariats : synchronisation de pont en echec', { bridgeId: bridge.id, error: message });
      await prisma.partnershipBridge.update({
        where: { id: bridge.id },
        data: { lastSyncError: message.slice(0, 500), lastSyncAt: new Date() },
      });
    }
  }
}

/**
 * Retrouve le dossier d'en face, pour les contrôles de réciprocité et
 * l'affichage « ce que le partenaire voit de son côté ».
 */
export async function findBridgedPartnership(partnershipId: string) {
  const bridge = await prisma.partnershipBridge.findFirst({
    where: {
      confirmed: true,
      OR: [{ localPartnershipId: partnershipId }, { remotePartnershipId: partnershipId }],
    },
  });
  if (!bridge) return null;

  const otherId =
    bridge.localPartnershipId === partnershipId ? bridge.remotePartnershipId : bridge.localPartnershipId;

  return prisma.partnership.findUnique({
    where: { id: otherId },
    select: {
      id: true,
      guildId: true,
      stage: true,
      healthScore: true,
      referredJoins: true,
      promotions: { where: { active: true }, select: { direction: true, postCount: true, lastPostedAt: true } },
    },
  });
}

/**
 * Cherche un dossier distant qui parle du même couple de serveurs, pour
 * proposer le pont sans que personne ait à échanger d'identifiant technique.
 */
export async function findBridgeCandidate(partnershipId: string): Promise<string | null> {
  const local = await prisma.partnership.findUnique({
    where: { id: partnershipId },
    include: { partner: { select: { partnerGuildId: true } } },
  });
  if (!local?.guildId || !local.partner.partnerGuildId) return null;

  const candidate = await prisma.partnership.findFirst({
    where: {
      guildId: local.partner.partnerGuildId,
      partner: { partnerGuildId: local.guildId },
      stage: { notIn: ['ENDED', 'BREACHED', 'REJECTED', 'ARCHIVED'] },
    },
    select: { id: true },
    orderBy: { updatedAt: 'desc' },
  });

  return candidate?.id ?? null;
}
