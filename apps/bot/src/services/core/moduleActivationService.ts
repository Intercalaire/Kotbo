/**
 * Activation d'un module depuis le dashboard.
 *
 * Un module se lit a deux endroits : `dashboardFeatureConfig`, qui porte le
 * statut affiche, et le champ propre au module quand il en a un
 * (`autoNicknameModerationEnabled`, `levelConfig.enabled`...). Ecrire l'un sans
 * l'autre laisse le serveur dans un etat ou la page dit une chose et le bot en
 * fait une autre. Les deux colonnes a ecrire ne sont plus enumerees ici : elles
 * viennent du registre (`@kotbo/contracts`), qui decrit aussi les dependances
 * entre modules.
 *
 * La bascule depuis la page Modules et la mise en place guidee du serveur
 * passent donc toutes deux par ici plutot que d'ecrire chacune sa version.
 */
import {
  canonicalModuleKey,
  getModuleDefinition,
  getModuleDependents,
  getModuleRequirements,
  isCoreModule,
} from '@kotbo/contracts';
import prisma from '../../utils/db.js';
import { logger } from '../../utils/logger.js';
import { invalidateLevelConfigCache } from '../progression/levelingService.js';
import { invalidateRankedConfigCache } from '../progression/ranked/rankedConfigService.js';
import { type KotboModule, setModuleActivation } from '../analytics/moduleStatsService.js';
import { getModuleStates, invalidateModuleStates } from './moduleGate.js';

const KOTBO_MODULE_BY_KEY: Record<string, KotboModule> = {
  'codepolice': 'codePolice',
  'daily_algo': 'dailyAlgo',
  'translation': 'translation',
  'sanctions': 'sanction',
  'nickname_moderation': 'nicknameModeration',
  'auto_thread': 'autoThread',
  'fun': 'fun',
  'leveling': 'leveling',
  'tickets': 'ticket',
  'analytics': 'analytics',
};

export class CoreModuleError extends Error {
  constructor(moduleKey: string) {
    super(`Le module « ${moduleKey} » fait partie du cœur du bot et ne peut pas être désactivé.`);
    this.name = 'CoreModuleError';
  }
}

/** Ce qu'une bascule a réellement changé, au-delà du module demandé. */
export interface ModuleActivationResult {
  moduleKey: string;
  enabled: boolean;
  /** Dépendances allumées en même temps (activation). */
  enabledRequirements: string[];
  /** Dépendants éteints en même temps (désactivation). */
  disabledDependents: string[];
}

/** Écrit l'état d'un seul module, sans se soucier des dépendances. */
async function writeModuleState(
  guildId: string,
  moduleKey: string,
  enabled: boolean,
  featureName?: string,
): Promise<void> {
  const definition = getModuleDefinition(moduleKey);

  const fields = Object.fromEntries((definition?.guildFields ?? []).map((field) => [field, enabled]));
  if (Object.keys(fields).length > 0) {
    await prisma.guild.update({ where: { id: guildId }, data: fields });
  }

  // Le niveau vit dans sa propre table, creee au besoin : un serveur qui n'a
  // jamais touche au module n'a pas encore de ligne.
  if (moduleKey === 'leveling') {
    await prisma.levelConfig.upsert({
      where: { guildId },
      create: { guildId, enabled },
      update: { enabled },
    });
    await invalidateLevelConfigCache(guildId);
  }

  // Meme cas que le leveling : le prestige porte son etat dans sa propre table.
  // Sans cette ecriture, la bascule du Centre de gestion ne changeait que la
  // pastille, et la page Prestige continuait d'afficher son propre interrupteur
  // dans l'etat inverse.
  if (moduleKey === 'prestige') {
    await prisma.rankedConfig.upsert({
      where: { guildId },
      create: { guildId, enabled },
      update: { enabled },
    });
    await invalidateRankedConfigCache(guildId);
  }

  // Idem pour les appels de bannissement : leur formulaire public lit
  // `BanAppealConfig.enabled` sans passer par la garde.
  if (moduleKey === 'ban_appeals') {
    await prisma.banAppealConfig.upsert({
      where: { guildId },
      create: { guildId, enabled },
      update: { enabled },
    });
  }

  const kotboModule = KOTBO_MODULE_BY_KEY[moduleKey];
  if (kotboModule) {
    // Suivi statistique : son echec ne doit pas faire echouer la bascule.
    await setModuleActivation(guildId, kotboModule, enabled, { featureKey: moduleKey })
      .catch((err) => logger.warn('ModuleActivation', 'Suivi d\'activation impossible :', err));
  }

  await prisma.dashboardFeatureConfig.upsert({
    where: { guildId_featureKey: { guildId, featureKey: moduleKey } },
    create: {
      guildId,
      featureKey: moduleKey,
      featureName: featureName ?? definition?.name ?? moduleKey.charAt(0).toUpperCase() + moduleKey.slice(1),
      enabled,
      loggingEnabled: true,
      userActivityTracking: true,
      notifyViaDiscordChannel: true,
    },
    update: { enabled },
  });
}

/**
 * `featureName` ne sert qu'a la creation de la ligne, et seulement pour les
 * modules absents du registre : sans lui, ils s'afficheraient dans le Centre de
 * gestion sous leur identifiant brut, « Channel_health » par exemple.
 *
 * Les dependances sont propagees dans les deux sens, sinon la page laisserait
 * exister des etats impossibles : eteindre « Leveling » en gardant « Saisons »
 * allume, ou allumer « Marche entre membres » sans economie.
 */
export async function setDashboardModuleStatus(
  guildId: string,
  moduleId: string,
  enabled: boolean,
  featureName?: string,
): Promise<ModuleActivationResult> {
  const key = canonicalModuleKey(moduleId);

  if (isCoreModule(key)) {
    throw new CoreModuleError(key);
  }

  const states = await getModuleStates(guildId);

  // Activation : tout ce dont le module a besoin doit suivre, sans quoi la
  // cascade de lecture le rendrait inactif juste apres l'avoir allume.
  const enabledRequirements = enabled
    ? getModuleRequirements(key).filter((requirement) => states[requirement] === false)
    : [];

  // Desactivation : ce qui repose dessus s'arrete aussi. On ne touche qu'aux
  // dependants reellement actifs, pour que le rallumage du parent ne rallume
  // pas des modules que l'admin avait eteints de son cote.
  const disabledDependents = !enabled
    ? getModuleDependents(key).filter((dependent) => states[dependent] !== false)
    : [];

  for (const requirement of enabledRequirements) {
    await writeModuleState(guildId, requirement, true);
  }

  await writeModuleState(guildId, key, enabled, featureName);

  for (const dependent of disabledDependents) {
    await writeModuleState(guildId, dependent, false);
  }

  // Sans cette invalidation, la garde d'execution continuerait de repondre avec
  // l'etat d'avant pendant toute la duree du cache : une desactivation ne
  // prendrait effet qu'une demi-minute plus tard, ce qui se lit comme un bug.
  await invalidateModuleStates(guildId);

  // Les commandes du module doivent disparaitre de la liste Discord, pas
  // seulement etre refusees a l'execution. La republication est differee et
  // groupee : appliquer un preset bascule une dizaine de modules d'affilee.
  scheduleCommandSync(guildId);

  return { moduleKey: key, enabled, enabledRequirements, disabledDependents };
}

/**
 * Republication differee, sans faire dependre ce service du client Discord.
 *
 * La bascule est appelee depuis une route HTTP, depuis la mise en place guidee
 * et depuis les outils MCP ; certains de ces contextes n'ont pas de client sous
 * la main. On le resout au moment de planifier, et son absence n'est pas une
 * erreur : le script de deploiement et la reconciliation au demarrage
 * rattraperont.
 */
function scheduleCommandSync(guildId: string): void {
  void (async () => {
    try {
      const [{ getClient }, { scheduleGuildCommandSync }] = await Promise.all([
        import('../../utils/client.js'),
        import('./commandDeployment.js'),
      ]);
      scheduleGuildCommandSync(getClient(), guildId);
    } catch {
      /* pas de client dans ce contexte (script, test) : rien a republier */
    }
  })();
}
