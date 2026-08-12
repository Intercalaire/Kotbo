/**
 * Déploiement des commandes serveur par serveur.
 *
 * Toutes les commandes étaient publiées globalement. Or Discord ne sait pas
 * retirer une commande globale sur un seul serveur : éteindre un module laissait
 * ses commandes dans la liste de tout le monde, et le bot ne pouvait que les
 * refuser une fois invoquées. Le déploiement descend donc au scope guilde, où la
 * liste envoyée ne contient que les commandes des modules allumés.
 *
 * Deux contraintes dictent la forme de ce fichier :
 *
 *   — Discord limite les *créations* de commandes de guilde à 200 par jour et
 *     par serveur. Une bascule de module ne doit donc pas republier à l'aveugle :
 *     on compare une empreinte de la charge utile avant d'envoyer quoi que ce
 *     soit, et un enchaînement de bascules ne produit qu'un seul envoi.
 *
 *   — La republication est une opération réseau lente, déclenchée depuis une
 *     route HTTP du dashboard. Elle est donc groupée et différée : la route rend
 *     la main tout de suite, la synchronisation suit.
 *
 * La garde d'exécution (`enforceModuleGate`) reste en place : Discord met un
 * moment à propager une liste de commandes, et un client peut envoyer une
 * commande qu'il a encore en cache.
 */
import { createHash } from 'node:crypto';
import { InteractionContextType, Routes, type Client } from 'discord.js';
import {
  getCommandDeploymentScope,
  getCommandModuleKey,
  globalScopedCommands,
  guildContextCommands,
  guildScopedCommands,
} from '../../commands.js';
import { logger } from '../../utils/logger.js';
import { getRedis } from '../../infra/redis.js';
import { getModuleStates } from './moduleGate.js';

type CommandPayload = Record<string, unknown>;

function toJSON(data: { toJSON: () => unknown }): CommandPayload {
  return data.toJSON() as CommandPayload;
}

/**
 * Empreinte de la liste déployée sur un serveur.
 *
 * Conservée hors du préfixe `guild:<id>:`, que `cache.invalidateGuild()` balaie
 * à chaque écriture du dashboard : rangée là, elle serait effacée en permanence
 * et chaque enregistrement de réglage relancerait une republication complète.
 */
const fingerprintKey = (guildId: string) => `commands:deployed:${guildId}`;

/** 30 jours : l'empreinte doit survivre aux redémarrages, pas être éternelle. */
const FINGERPRINT_TTL_SECONDS = 30 * 24 * 3600;

function fingerprint(payload: CommandPayload[]): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 32);
}

async function readFingerprint(guildId: string): Promise<string | null> {
  try {
    const redis = getRedis();
    if (!redis) return null;
    return (await redis.get(fingerprintKey(guildId))) ?? null;
  } catch {
    // Sans Redis on republie : un envoi de trop vaut mieux qu'un serveur laissé
    // avec les commandes d'un module éteint.
    return null;
  }
}

async function writeFingerprint(guildId: string, value: string): Promise<void> {
  try {
    await getRedis()?.setex(fingerprintKey(guildId), FINGERPRINT_TTL_SECONDS, value);
    return;
  } catch {
    /* l'absence d'empreinte ne coûte qu'une republication au prochain passage */
  }
}

/**
 * Commandes à publier sur un serveur : celles sans module, plus celles dont le
 * module est allumé. Les menus contextuels de guilde suivent la même règle.
 */
export async function buildGuildCommandPayload(guildId: string): Promise<CommandPayload[]> {
  const states = await getModuleStates(guildId);

  const isEnabled = (commandName: string): boolean => {
    const moduleKey = getCommandModuleKey(commandName);
    if (!moduleKey) return true;
    return states[moduleKey] !== false;
  };

  const slash = guildScopedCommands
    .filter((command) => isEnabled(command.data.name))
    .map((command) => ({
      ...toJSON(command.data),
      // Sans cette restriction, l'exemplaire de guilde d'une commande
      // `guild+dm` réapparaîtrait en message privé en doublon du global.
      contexts: [InteractionContextType.Guild],
    }));

  const contextMenus = guildContextCommands
    .filter((command) => isEnabled(command.data.name))
    .map((command) => toJSON(command.data));

  return [...slash, ...contextMenus];
}

/** Commandes globales : amorçage, utilitaires hors serveur, menus contextuels. */
export function buildGlobalCommandPayload(): CommandPayload[] {
  return globalScopedCommands.map((command) => {
    const json = toJSON(command.data);
    if (getCommandDeploymentScope(command) !== 'guild+dm') return json;

    // L'exemplaire global d'une commande `guild+dm` ne sert qu'aux contextes
    // privés : dans un serveur, c'est l'exemplaire de guilde qui doit
    // apparaître, et lui seul suit l'état du module.
    return {
      ...json,
      contexts: [InteractionContextType.BotDM, InteractionContextType.PrivateChannel],
    };
  });
}

export interface GuildSyncResult {
  guildId: string;
  /** `false` quand l'empreinte était déjà à jour : rien n'a été envoyé. */
  changed: boolean;
  commandCount: number;
}

async function putGuildCommands(
  client: Client,
  guildId: string,
  payload: CommandPayload[],
): Promise<void> {
  const applicationId = client.application?.id ?? client.user?.id;
  if (!applicationId) throw new Error("Identifiant d'application indisponible.");

  await client.rest.put(Routes.applicationGuildCommands(applicationId, guildId), { body: payload });
}

/**
 * Aligne les commandes d'un serveur sur l'état de ses modules.
 *
 * `force` ignore l'empreinte : utilisé par le script de déploiement, où l'on
 * veut republier même si rien n'a changé côté modules (le code des commandes,
 * lui, a pu changer).
 */
export async function syncGuildCommands(
  client: Client,
  guildId: string,
  options: { force?: boolean } = {},
): Promise<GuildSyncResult> {
  const payload = await buildGuildCommandPayload(guildId);
  const current = fingerprint(payload);

  if (!options.force && (await readFingerprint(guildId)) === current) {
    return { guildId, changed: false, commandCount: payload.length };
  }

  await putGuildCommands(client, guildId, payload);
  await writeFingerprint(guildId, current);

  logger.info('Commandes', `${payload.length} commande(s) publiée(s) sur le serveur ${guildId}.`);
  return { guildId, changed: true, commandCount: payload.length };
}

/** Retire toutes les commandes de guilde : serveur désactivé ou bot exclu. */
export async function clearGuildCommands(client: Client, guildId: string): Promise<void> {
  const empty: CommandPayload[] = [];
  if ((await readFingerprint(guildId)) === fingerprint(empty)) return;

  await putGuildCommands(client, guildId, empty);
  await writeFingerprint(guildId, fingerprint(empty));
  logger.info('Commandes', `Commandes retirées du serveur ${guildId}.`);
}

/**
 * Regroupement des demandes de synchronisation.
 *
 * Appliquer un preset bascule une dizaine de modules d'affilée. Sans ce délai,
 * chaque bascule enverrait sa propre republication — dix allers-retours pour un
 * seul résultat, et autant de créations décomptées du quota quotidien.
 */
const SYNC_DEBOUNCE_MS = 3_000;
const pendingSyncs = new Map<string, ReturnType<typeof setTimeout>>();

export function scheduleGuildCommandSync(client: Client, guildId: string): void {
  const existing = pendingSyncs.get(guildId);
  if (existing) clearTimeout(existing);

  const timer = setTimeout(() => {
    pendingSyncs.delete(guildId);
    void syncGuildCommands(client, guildId).catch((err) =>
      logger.error('Commandes', `Synchronisation impossible pour ${guildId}:`, err),
    );
  }, SYNC_DEBOUNCE_MS);

  // Ne pas retenir le processus au moment de l'arrêt pour une republication.
  timer.unref?.();
  pendingSyncs.set(guildId, timer);
}

/**
 * Réconcilie les serveurs présents sur ce shard au démarrage.
 *
 * Chaque shard ne voit que ses propres serveurs : le partage se fait donc de
 * lui-même, sans coordination. Les serveurs inchangés ne coûtent qu'une lecture
 * d'empreinte.
 */
export async function reconcileGuildCommands(
  client: Client,
  guildIds: Iterable<string>,
  isActivated: (guildId: string) => boolean,
): Promise<void> {
  let changed = 0;
  let failed = 0;

  for (const guildId of guildIds) {
    try {
      if (isActivated(guildId)) {
        const result = await syncGuildCommands(client, guildId);
        if (result.changed) changed++;
      } else {
        await clearGuildCommands(client, guildId);
      }
    } catch (err) {
      failed++;
      logger.error('Commandes', `Réconciliation impossible pour ${guildId}:`, err);
    }
  }

  logger.success(
    'Commandes',
    `Réconciliation terminée : ${changed} serveur(s) republié(s), ${failed} en échec.`,
  );
}
