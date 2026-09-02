/** Mise en place guidee du serveur. */
import { authStore } from '../stores/auth.svelte';
import { dashboardRequest } from './client';

export type ServerTemplateSection =
  | 'access' | 'security' | 'staff' | 'captcha' | 'tickets' | 'welcome' | 'text' | 'bots' | 'voice' | 'modules';
export type ServerTemplateWiring =
  | 'staff' | 'logs' | 'tickets' | 'leveling' | 'rpg' | 'tempvoice' | 'welcome' | 'rules' | 'member' | 'captcha' | 'honeypot' | null;
/** A qui le salon s'ouvre : tout le plan etant ferme a @everyone, c'est ce qui les distingue. */
export type ServerTemplateAudience = 'staff' | 'member' | 'pending' | 'everyone';

export type ServerTemplatePlanItem = {
  key: string;
  section: ServerTemplateSection;
  kind: 'role' | 'category' | 'text' | 'voice' | 'module';
  parent: string | null;
  name: string;
  wiring: ServerTemplateWiring;
  audience: ServerTemplateAudience;
  readOnly: boolean;
  required: boolean;
  /** Module du dashboard active par cet element. */
  moduleId: string | null;
  /** Salon dont la creation coche ce module. */
  linkedTo: string | null;
  /** Element sans lequel celui-ci ne fonctionne pas : le cocher le ramene. */
  dependsOn: string | null;
};

export type ServerTemplateState = {
  locale: 'fr' | 'en';
  plan: ServerTemplatePlanItem[];
  defaultSelection: string[];
  missingPermissions: string[];
  canCreateChannels: boolean;
  /** Un salon de logs est deja configure : la sante des salons a ou parler. */
  hasLogChannel: boolean;
  isAdministrator: boolean;
  /**
   * Serveur neuf a batir, ou serveur habite a reprendre. Lu sur les faits (age,
   * membres, salons, roles) et non demande a l'administrateur : il repond
   * « nouveau serveur » parce que Kotbo est nouveau pour lui, pas parce que le
   * serveur l'est.
   */
  maturity: {
    maturity: 'fresh' | 'established';
    ageDays: number;
    /** Ce qui a fait pencher la balance, affiche tel quel. */
    reasons: string[];
  };
  /**
   * Maquette complete. Sur un serveur habite, `defaultSelection` n'en retient
   * que les modules : ce champ permet de proposer quand meme tout cocher, sans
   * que la page ait a reconstruire la liste.
   */
  fullSelection: string[];
  applied: { at: string; by: string | null; selection: string[] } | null;
};

export type ServerTemplateApplyResult = {
  success: boolean;
  items: { key: string; id: string; name: string; created: boolean }[];
  modules: string[];
  /**
   * Modules configures mais encore inertes, faute d'abonnement. Ils s'allument
   * seuls le jour ou le serveur souscrit : rien a rejouer, la mise en place n'a
   * pas a etre refaite.
   */
  preparedModules: string[];
  /** Etapes facultatives qui n'ont pas abouti, sans arreter la mise en place. */
  warnings: string[];
  panelSent: boolean;
};

export async function fetchServerTemplate(guildId = authStore.selectedGuildId): Promise<ServerTemplateState> {
  return dashboardRequest('/server-template', { method: 'GET', guildId, errorContext: 'API Error (Server Template):' });
}

/**
 * Ce que le serveur avait deja fait quand la mise en place s'est interrompue.
 * `appliedAt` distingue le refus d'une mise en place menee ailleurs de celui
 * d'une mise en place encore en cours : la premiere est definitive, la seconde
 * se retente.
 */
export type ServerTemplateApplyFailure = Partial<ServerTemplateApplyResult> & {
  error?: string;
  appliedAt?: string;
};

export async function applyServerTemplate(selection: string[], guildId = authStore.selectedGuildId): Promise<ServerTemplateApplyResult> {
  return dashboardRequest('/server-template/apply', {
    method: 'POST',
    payload: { selection },
    guildId,
    errorContext: 'API Error (Server Template Apply):',
    // La page rend elle-meme le detail de ce qui a ete cree, et son propre
    // message d'erreur : le toast generique du socle ferait doublon.
    silent: true,
  });
}
