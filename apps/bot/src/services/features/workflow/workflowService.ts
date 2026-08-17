import { hasBlockingIssue, validateGraph, getNodeDef, type WorkflowGraph } from '@kotbo/shared';
import type { Client, Guild } from 'discord.js';
import prisma from '../../../utils/db.js';
import { logger } from '../../../utils/logger.js';
import { cache } from '../../../utils/cache.js';
import { isGuildActivated } from '../../../utils/activation.js';
import { createWorkflowEffects, toChannelValue, toMemberValue, toMessageValue, toRoleValue } from './effects.js';
import { runWorkflow, type ExecutionOutcome, type ExecutionState, type StepRecord } from './engine.js';

/**
 * Orchestration des workflows : déclenchement depuis le bus d'événements,
 * persistance des exécutions et reprise de celles suspendues par un « Attendre ».
 */

/** Au-delà, on cesse de conserver le détail pas-à-pas d'une exécution. */
const MAX_STEPS_PERSISTED = 200;

/**
 * Court volontairement : l'invalidation explicite ne touche que le cache
 * mémoire du processus qui écrit. En mode distribué (`EVENTBUS_DISTRIBUTED`),
 * le processus qui traite les événements garde sa copie jusqu'à expiration, et
 * cette borne fixe le délai maximal avant qu'un workflow fraîchement activé
 * ne parte.
 */
const TRIGGER_EVENTS_TTL_SECONDS = 60;

/** Préfixe `guild:` : `cache.invalidateGuild` balaie la clé avec le reste. */
function triggerEventsKey(guildId: string): string {
  return `guild:${guildId}:workflow-trigger-events`;
}

async function invalidateTriggerEvents(guildId: string): Promise<void> {
  await cache.delete(triggerEventsKey(guildId)).catch(() => null);
}

/**
 * Événements pour lesquels le serveur a au moins un workflow actif.
 *
 * `dispatchEvent` est appelée à chaque message, chaque réaction et chaque
 * arrivée : sans cette liste, un serveur sans le moindre workflow paierait une
 * requête SQL par message. La liste tient dans le cache mémoire de premier
 * niveau, et toute écriture sur un workflow la périme.
 */
async function activeTriggerEvents(guildId: string): Promise<string[]> {
  const key = triggerEventsKey(guildId);

  const cached = await cache.get<string[]>(key);
  if (cached) return cached;

  const rows = await prisma.workflow.findMany({
    where: { guildId, enabled: true },
    select: { triggerEvent: true },
    distinct: ['triggerEvent'],
  });

  const events = rows.map((row) => row.triggerEvent);
  await cache.set(key, events, TRIGGER_EVENTS_TTL_SECONDS);
  return events;
}

// ============================================================================
// ENREGISTREMENT
// ============================================================================

export interface SaveWorkflowInput {
  name: string;
  description?: string | null;
  enabled?: boolean;
  graph: WorkflowGraph;
}

export class WorkflowValidationError extends Error {
  constructor(public readonly issues: { code: string; message: string }[]) {
    super(issues.map((i) => i.message).join(' '));
    this.name = 'WorkflowValidationError';
  }
}

/**
 * Le type et l'événement du déclencheur sont extraits du graphe et stockés à
 * plat : c'est ce qui permet de retrouver en une requête indexée les workflows
 * concernés par un événement, sans désérialiser tous les graphes du serveur.
 */
function extractTrigger(graph: WorkflowGraph): { triggerType: string; triggerEvent: string } {
  const trigger = graph.nodes.find((node) => getNodeDef(node.type)?.category === 'trigger');
  const def = trigger ? getNodeDef(trigger.type) : undefined;
  if (!trigger || !def?.event) {
    throw new WorkflowValidationError([{ code: 'NO_TRIGGER', message: 'Le workflow n\'a aucun déclencheur.' }]);
  }
  return { triggerType: trigger.type, triggerEvent: def.event };
}

function assertValid(graph: WorkflowGraph): void {
  const issues = validateGraph(graph);
  if (hasBlockingIssue(issues)) {
    throw new WorkflowValidationError(issues.filter((i) => i.severity === 'error'));
  }
}

export async function createWorkflow(guildId: string, input: SaveWorkflowInput, createdById: string) {
  assertValid(input.graph);
  const { triggerType, triggerEvent } = extractTrigger(input.graph);

  const workflow = await prisma.workflow.create({
    data: {
      guildId,
      name: input.name.trim().slice(0, 100) || 'Workflow',
      description: input.description?.slice(0, 500) ?? null,
      enabled: input.enabled ?? false,
      triggerType,
      triggerEvent,
      graph: input.graph as never,
      createdById,
    },
  });

  await invalidateTriggerEvents(guildId);
  return workflow;
}

export async function updateWorkflow(guildId: string, id: string, input: SaveWorkflowInput) {
  assertValid(input.graph);
  const { triggerType, triggerEvent } = extractTrigger(input.graph);

  const { count } = await prisma.workflow.updateMany({
    where: { id, guildId },
    data: {
      name: input.name.trim().slice(0, 100) || 'Workflow',
      description: input.description?.slice(0, 500) ?? null,
      enabled: input.enabled ?? false,
      triggerType,
      triggerEvent,
      graph: input.graph as never,
    },
  });

  if (count === 0) return null;

  await invalidateTriggerEvents(guildId);
  return prisma.workflow.findUnique({ where: { id } });
}

export async function deleteWorkflow(guildId: string, id: string): Promise<boolean> {
  const { count } = await prisma.workflow.deleteMany({ where: { id, guildId } });
  if (count > 0) await invalidateTriggerEvents(guildId);
  return count > 0;
}

/**
 * Bascule l'état d'un workflow. Passe par le service plutôt que par une écriture
 * directe depuis la route : c'est ce qui garantit que la liste des événements
 * actifs est périmée en même temps.
 */
export async function setWorkflowEnabled(guildId: string, id: string, enabled: boolean): Promise<boolean> {
  const { count } = await prisma.workflow.updateMany({ where: { id, guildId }, data: { enabled } });
  if (count > 0) await invalidateTriggerEvents(guildId);
  return count > 0;
}

export async function listWorkflows(guildId: string) {
  return prisma.workflow.findMany({
    where: { guildId },
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true, name: true, description: true, enabled: true,
      triggerType: true, triggerEvent: true,
      runCount: true, successCount: true, failureCount: true,
      lastRunAt: true, lastError: true, updatedAt: true,
    },
  });
}

export async function getWorkflow(guildId: string, id: string) {
  return prisma.workflow.findFirst({ where: { id, guildId } });
}

// ============================================================================
// DÉCLENCHEMENT
// ============================================================================

/**
 * Traduit le payload d'un événement du bus en valeurs typées exposées par les
 * ports du nœud déclencheur.
 *
 * Retourne `null` quand l'événement ne peut pas être exploité (membre parti
 * entre-temps, salon supprimé) : le workflow n'est alors pas lancé.
 */
export async function buildTriggerOutputs(
  guild: Guild,
  triggerType: string,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  const memberOf = async (userId: unknown) => {
    if (typeof userId !== 'string') return null;
    const member = guild.members.cache.get(userId) ?? await guild.members.fetch(userId).catch(() => null);
    return member ? toMemberValue(member) : null;
  };

  const channelOf = (channelId: unknown) => {
    if (typeof channelId !== 'string') return null;
    const channel = guild.channels.cache.get(channelId);
    return channel && 'name' in channel ? toChannelValue(channel) : null;
  };

  const roleOf = (roleId: unknown) => {
    if (typeof roleId !== 'string') return null;
    const role = guild.roles.cache.get(roleId);
    return role ? toRoleValue(role) : null;
  };

  switch (triggerType) {
    case 'OnMemberJoin':
    case 'OnMemberLeave': {
      const member = await memberOf(payload.userId);
      // À la sortie d'un membre, Discord ne le résout plus : on reconstitue le
      // minimum exploitable à partir du payload.
      if (!member && triggerType === 'OnMemberLeave') {
        return {
          member: {
            kind: 'Member', id: String(payload.userId ?? ''), tag: String(payload.userTag ?? ''),
            displayName: String(payload.userTag ?? ''), isBot: Boolean(payload.isBot),
            roleIds: [], accountCreatedAt: null, joinedAt: null,
          },
        };
      }
      return member ? { member } : null;
    }

    case 'OnRoleAdded':
    case 'OnRoleRemoved': {
      const member = await memberOf(payload.userId);
      const roleIds = triggerType === 'OnRoleAdded' ? payload.addedRoles : payload.removedRoles;
      const roleId = Array.isArray(roleIds) ? roleIds[0] : null;
      const role = roleOf(roleId);
      return member && role ? { member, role } : null;
    }

    case 'OnMessageSend': {
      const member = await memberOf(payload.authorId);
      const channel = channelOf(payload.channelId);
      if (!member || !channel) return null;
      return {
        member,
        channel,
        message: toMessageValue({
          id: String(payload.messageId ?? ''),
          content: String(payload.content ?? ''),
          channelId: String(payload.channelId ?? ''),
          authorId: String(payload.authorId ?? ''),
        }),
      };
    }

    case 'OnReactionAdd': {
      const member = await memberOf(payload.userId);
      const channel = channelOf(payload.channelId);
      return member ? { member, channel, emoji: String(payload.emoji ?? '') } : null;
    }

    case 'OnVoiceJoin': {
      const member = await memberOf(payload.userId);
      const channel = channelOf(payload.channelId);
      return member ? { member, channel } : null;
    }

    case 'OnVoiceLeave': {
      const member = await memberOf(payload.userId);
      const channel = channelOf(payload.channelId);
      const durationMs = typeof payload.durationMs === 'number' ? payload.durationMs : 0;
      return member ? { member, channel, minutes: Math.floor(durationMs / 60_000) } : null;
    }

    case 'OnSanctionApplied': {
      const member = await memberOf(payload.targetId);
      return member
        ? { member, type: String(payload.type ?? ''), reason: String(payload.reason ?? '') }
        : null;
    }

    case 'OnTicketCreated': {
      const member = await memberOf(payload.userId);
      const channel = channelOf(payload.channelId);
      return member ? { member, channel, subject: String(payload.subject ?? '') } : null;
    }

    case 'OnLevelUp': {
      const member = await memberOf(payload.userId);
      return member ? { member, level: Number(payload.level ?? 0) } : null;
    }

    default:
      return null;
  }
}

/**
 * Lance tous les workflows actifs d'un serveur abonnés à un événement.
 *
 * Les exécutions sont lancées en parallèle mais chacune est isolée : l'échec de
 * l'une n'empêche pas les autres de tourner.
 */
export async function dispatchEvent(
  client: Client,
  guildId: string,
  busEvent: string,
  payload: Record<string, unknown>,
): Promise<void> {
  if (!isGuildActivated(guildId)) return;

  // Sortie immédiate et sans requête pour l'immense majorité des événements,
  // qui n'intéressent aucun workflow du serveur.
  if (!(await activeTriggerEvents(guildId)).includes(busEvent)) return;

  const workflows = await prisma.workflow.findMany({
    where: { guildId, enabled: true, triggerEvent: busEvent },
  });
  if (workflows.length === 0) return;

  const guild = client.guilds.cache.get(guildId);
  if (!guild) return;

  await Promise.all(workflows.map(async (workflow) => {
    try {
      const graph = workflow.graph as unknown as WorkflowGraph;
      const triggerOutputs = await buildTriggerOutputs(guild, workflow.triggerType, payload);
      // Payload inexploitable pour ce déclencheur : rien à faire, ce n'est pas
      // une erreur du workflow.
      if (!triggerOutputs) return;

      const outcome = await runWorkflow({
        graph,
        effects: createWorkflowEffects(guild),
        triggerOutputs,
      });

      await persistOutcome(workflow.id, guildId, outcome, payload);
    } catch (error) {
      logger.error('Workflow', `Échec du workflow ${workflow.id} sur ${busEvent}:`, error);
    }
  }));
}

// ============================================================================
// PERSISTANCE DES EXÉCUTIONS
// ============================================================================

async function writeSteps(executionId: string, steps: StepRecord[]): Promise<void> {
  if (steps.length === 0) return;
  const kept = steps.slice(0, MAX_STEPS_PERSISTED);

  await prisma.workflowExecutionStep.createMany({
    data: kept.map((step) => ({
      executionId,
      order: step.order,
      nodeId: step.nodeId,
      nodeType: step.nodeType,
      status: step.status,
      inputs: step.inputs as never,
      outputs: step.outputs as never,
      error: step.error ?? null,
      durationMs: step.durationMs,
    })),
  });
}

export async function persistOutcome(
  workflowId: string,
  guildId: string,
  outcome: ExecutionOutcome,
  triggerPayload: Record<string, unknown>,
  existingExecutionId?: string,
): Promise<string> {
  const suspended = outcome.status === 'SUSPENDED';
  const failed = outcome.status === 'FAILED';

  const data = {
    status: suspended ? 'WAITING' : failed ? 'FAILED' : 'COMPLETED',
    context: outcome.state as never,
    resumeAt: suspended ? outcome.resumeAt : null,
    nodeVisits: outcome.state.nodeVisits,
    iterations: outcome.state.iterations,
    error: failed ? outcome.error.slice(0, 1000) : null,
    completedAt: suspended ? null : new Date(),
  };

  const executionId = existingExecutionId
    ? (await prisma.workflowExecution.update({ where: { id: existingExecutionId }, data })).id
    : (await prisma.workflowExecution.create({
      data: { workflowId, guildId, triggerPayload: triggerPayload as never, ...data },
    })).id;

  await writeSteps(executionId, outcome.steps);

  // Les compteurs du workflow ne bougent qu'une fois l'exécution terminée :
  // une suspension n'est ni un succès ni un échec.
  if (!suspended) {
    await prisma.workflow.update({
      where: { id: workflowId },
      data: {
        runCount: { increment: 1 },
        successCount: failed ? undefined : { increment: 1 },
        failureCount: failed ? { increment: 1 } : undefined,
        lastRunAt: new Date(),
        lastError: failed ? outcome.error.slice(0, 500) : null,
      },
    });
  }

  return executionId;
}

// ============================================================================
// REPRISE DES EXÉCUTIONS SUSPENDUES
// ============================================================================

/**
 * Relance les exécutions dont l'attente est écoulée.
 *
 * Appelée par un cron : c'est ce qui rend un nœud « Attendre » fiable au-delà
 * d'un redémarrage du bot, contrairement à une minuterie en mémoire.
 */
export async function resumePendingExecutions(client: Client): Promise<void> {
  const due = await prisma.workflowExecution.findMany({
    where: { status: 'WAITING', resumeAt: { lte: new Date() } },
    include: { workflow: true },
    take: 50,
  });

  for (const execution of due) {
    try {
      const guild = client.guilds.cache.get(execution.guildId);
      if (!guild) continue;

      if (!execution.workflow.enabled) {
        await prisma.workflowExecution.update({
          where: { id: execution.id },
          data: { status: 'CANCELLED', completedAt: new Date(), error: 'Workflow désactivé pendant l\'attente.' },
        });
        continue;
      }

      // On marque immédiatement l'exécution comme relancée pour qu'un second
      // passage du cron ne la reprenne pas en parallèle.
      await prisma.workflowExecution.update({
        where: { id: execution.id },
        data: { status: 'RUNNING', resumeAt: null },
      });

      const outcome = await runWorkflow({
        graph: execution.workflow.graph as unknown as WorkflowGraph,
        effects: createWorkflowEffects(guild),
        state: execution.context as unknown as ExecutionState,
      });

      await persistOutcome(
        execution.workflowId,
        execution.guildId,
        outcome,
        (execution.triggerPayload as Record<string, unknown>) ?? {},
        execution.id,
      );
    } catch (error) {
      logger.error('Workflow', `Échec de la reprise de l'exécution ${execution.id}:`, error);
      await prisma.workflowExecution.update({
        where: { id: execution.id },
        data: { status: 'FAILED', completedAt: new Date(), error: String(error).slice(0, 1000) },
      }).catch(() => null);
    }
  }
}

export async function listExecutions(guildId: string, workflowId?: string, take = 25) {
  return prisma.workflowExecution.findMany({
    where: { guildId, ...(workflowId ? { workflowId } : {}) },
    orderBy: { startedAt: 'desc' },
    take: Math.min(100, Math.max(1, take)),
    select: {
      id: true, workflowId: true, status: true, error: true,
      nodeVisits: true, iterations: true, resumeAt: true,
      startedAt: true, completedAt: true,
    },
  });
}

export async function getExecutionDetail(guildId: string, executionId: string) {
  return prisma.workflowExecution.findFirst({
    where: { id: executionId, guildId },
    include: { steps: { orderBy: { order: 'asc' } } },
  });
}
