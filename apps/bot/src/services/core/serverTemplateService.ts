/**
 * Mise en place guidee du serveur : pose d'un coup l'arborescence complete -
 * categories, salons, role staff - et branche chaque element sur le module
 * Kotbo correspondant.
 *
 * Le plan est declare une seule fois ici. Le dashboard le lit pour composer sa
 * previsualisation et l'application le parcourt pour creer : ce que l'admin
 * voit avant de cliquer ne peut pas differer de ce qui sera cree.
 *
 * Comme les mises en route par module, la reprise se fait par identifiant :
 * un element deja enregistre - dans son champ de configuration ou dans la
 * trace `serverTemplateRefs` - est repris, jamais recree.
 */
import {
  PermissionFlagsBits,
  type Guild,
  type NonThreadGuildBasedChannel,
  type OverwriteResolvable,
} from 'discord.js';
import { Prisma } from '@prisma/client';
import prisma from '../../utils/db.js';
import { cache } from '../../utils/cache.js';
import { logger } from '../../utils/logger.js';
import { errorMessage } from '../../utils/errors.js';
import type { BotLocale } from '../../utils/i18n.js';
import * as m from '../../lib/paraglide/messages.js';
import {
  type ProvisionedEntry,
  acquireProvisionLock,
  ensureCategory,
  ensureRole,
  ensureTextChannel,
  ensureVoiceChannel,
  missingProvisionPermissions,
  releaseProvisionLock,
} from './channelProvisioningService.js';
import { defaultLevelUpMessage, getOrCreateLevelConfig, invalidateLevelConfigCache } from '../progression/levelingService.js';
import { setDashboardModuleStatus } from './moduleActivationService.js';
import type { TicketProvisionOutcome } from '../features/ticketProvisioning.js';

export const SERVER_TEMPLATE_SECTIONS = ['access', 'staff', 'captcha', 'tickets', 'welcome', 'text', 'bots', 'voice', 'modules'] as const;
export type ServerTemplateSection = (typeof SERVER_TEMPLATE_SECTIONS)[number];

type ItemKind = 'role' | 'category' | 'text' | 'voice' | 'module';

/**
 * Ce qu'un element branche cote Kotbo. Le dashboard traduit ce code en une
 * phrase : le service ne connait pas la langue de l'admin, seulement celle du
 * serveur, qui sert a nommer les salons.
 */
type ItemWiring = 'staff' | 'logs' | 'tickets' | 'leveling' | 'rpg' | 'tempvoice' | 'welcome' | 'rules' | 'member' | 'captcha' | null;

/**
 * A qui le salon s'ouvre. Sert a la previsualisation : tout le plan etant
 * desormais ferme a @everyone, un simple « salon restreint » ne dirait plus
 * rien - c'est le role a qui il est rouvert qui distingue les salons entre eux.
 */
type ItemAudience =
  /** Staff seul. */
  | 'staff'
  /** Role Membre, donc apres verification quand le captcha est en place. */
  | 'member'
  /** Role Non-verifie : le salon disparait une fois le captcha reussi. */
  | 'pending'
  /** Ouvert a tous, y compris a qui n'a encore aucun role. */
  | 'everyone';

type TemplateItem = {
  key: string;
  section: ServerTemplateSection;
  kind: ItemKind;
  /** Categorie parente, pour les salons. */
  parent: string | null;
  /** Nom pose sur Discord, dans la langue du serveur. */
  name: (locale: BotLocale) => string;
  wiring: ItemWiring;
  audience: ItemAudience;
  /** Salon visible de son public mais ou seul le bot ecrit. */
  readOnly: boolean;
  /**
   * Ne peut pas etre decoche tant que sa section est retenue : le module ne
   * fonctionnerait pas sans lui.
   */
  required: boolean;
  /** Module du dashboard a activer, pour les elements de la section modules. */
  moduleId: string | null;
  /**
   * Salon dont la creation vaut activation. Cocher ce salon coche le module :
   * poser un salon de niveaux sans allumer le leveling ne produirait rien.
   * Le lien ne joue que dans ce sens, un module se tenant tres bien sans salon
   * dedie.
   */
  linkedTo: string | null;
  /**
   * Element sans lequel celui-ci ne peut pas fonctionner : le retenir le ramene
   * dans la selection. Le lien traverse les sections, la ou `required` ne vaut
   * qu'a l'interieur de l'une d'elles.
   */
  dependsOn: string | null;
};

const item = (
  key: string,
  section: ServerTemplateSection,
  kind: ItemKind,
  name: (locale: BotLocale) => string,
  options: {
    parent?: string;
    wiring?: ItemWiring;
    audience?: ItemAudience;
    readOnly?: boolean;
    required?: boolean;
    moduleId?: string;
    linkedTo?: string;
    dependsOn?: string;
  } = {},
): TemplateItem => ({
  key,
  section,
  kind,
  parent: options.parent ?? null,
  name,
  wiring: options.wiring ?? null,
  audience: options.audience ?? 'member',
  readOnly: options.readOnly ?? false,
  required: options.required ?? false,
  moduleId: options.moduleId ?? null,
  linkedTo: options.linkedTo ?? null,
  dependsOn: options.dependsOn ?? null,
});

/** Ordre de la liste = ordre d'affichage dans la previsualisation et ordre de creation. */
export const SERVER_TEMPLATE_PLAN: TemplateItem[] = [
  // Tout le plan est ferme a @everyone et rouvert a ce seul role : sans lui,
  // les salons crees ne seraient visibles de personne. Il est donc pose en
  // premier, et les autres sections en dependent.
  item('role.member', 'access', 'role', (l) => m.setup_template_role_member({}, { locale: l }), { wiring: 'member', required: true }),

  // Indispensable a sa section : les salons staff sont fermes a @everyone, et
  // sans role a qui les rouvrir ils ne seraient visibles que du bot.
  item('role.staff', 'staff', 'role', (l) => m.setup_template_role_staff({}, { locale: l }), { wiring: 'staff', required: true }),
  item('staff.category', 'staff', 'category', (l) => m.setup_template_category_staff({}, { locale: l }), { audience: 'staff' }),
  item('staff.general', 'staff', 'text', (l) => m.setup_template_channel_staff_general({}, { locale: l }), { parent: 'staff.category', wiring: 'staff', audience: 'staff' }),
  item('staff.log', 'staff', 'text', (l) => m.setup_template_channel_staff_logs({}, { locale: l }), { parent: 'staff.category', wiring: 'logs', audience: 'staff' }),

  // Le captcha ne se prend pas par morceaux : tout y est indispensable, et la
  // section entiere se coche ou se decoche d'un bloc depuis le choix de
  // verification. Sans role Membre, il n'aurait rien a accorder a l'arrivee.
  item('captcha.role', 'captcha', 'role', (l) => m.setup_template_role_unverified({}, { locale: l }), { wiring: 'captcha', required: true, dependsOn: 'role.member' }),
  item('captcha.category', 'captcha', 'category', (l) => m.setup_template_category_captcha({}, { locale: l }), { audience: 'pending', required: true, dependsOn: 'role.member' }),
  item('captcha.text', 'captcha', 'text', (l) => m.setup_template_channel_captcha({}, { locale: l }), { parent: 'captcha.category', wiring: 'captcha', audience: 'pending', required: true, dependsOn: 'role.member' }),
  item('captcha.voice', 'captcha', 'voice', (l) => m.setup_template_voice_captcha({}, { locale: l }), { parent: 'captcha.category', wiring: 'captcha', audience: 'pending', required: true, dependsOn: 'role.member' }),

  item('tickets.category', 'tickets', 'category', (l) => m.setup_channel_tickets_category({}, { locale: l }), { wiring: 'tickets', audience: 'staff', required: true }),
  item('tickets.panel', 'tickets', 'text', (l) => m.setup_channel_tickets_panel({}, { locale: l }), { parent: 'tickets.category', wiring: 'tickets', readOnly: true, required: true }),
  item('tickets.logs', 'tickets', 'text', (l) => m.setup_channel_tickets_logs({}, { locale: l }), { parent: 'tickets.category', wiring: 'tickets', audience: 'staff', required: true }),

  item('welcome.category', 'welcome', 'category', (l) => m.setup_template_category_welcome({}, { locale: l })),
  item('welcome.welcome', 'welcome', 'text', (l) => m.setup_template_channel_welcome({}, { locale: l }), { parent: 'welcome.category', wiring: 'welcome', readOnly: true }),
  // Seule exception a la fermeture generale : Discord exige un salon de regles
  // lisible publiquement pour activer le mode communautaire, et le fermer
  // reviendrait a demander a un arrivant d'accepter des regles qu'il ne voit pas.
  item('welcome.rules', 'welcome', 'text', (l) => m.setup_template_channel_rules({}, { locale: l }), { parent: 'welcome.category', wiring: 'rules', audience: 'everyone', readOnly: true }),

  item('text.category', 'text', 'category', (l) => m.setup_template_category_text({}, { locale: l })),
  item('text.general', 'text', 'text', (l) => m.setup_template_channel_general({}, { locale: l }), { parent: 'text.category' }),
  item('text.media', 'text', 'text', (l) => m.setup_template_channel_media({}, { locale: l }), { parent: 'text.category' }),
  item('text.random', 'text', 'text', (l) => m.setup_template_channel_random({}, { locale: l }), { parent: 'text.category' }),

  item('bots.category', 'bots', 'category', (l) => m.setup_template_category_bots({}, { locale: l })),
  item('bots.rpg', 'bots', 'text', (l) => m.setup_template_channel_rpg({}, { locale: l }), { parent: 'bots.category', wiring: 'rpg' }),
  item('bots.level', 'bots', 'text', (l) => m.setup_channel_leveling({}, { locale: l }), { parent: 'bots.category', wiring: 'leveling', readOnly: true }),

  item('voice.category', 'voice', 'category', (l) => m.setup_template_category_voice({}, { locale: l })),
  item('voice.general', 'voice', 'voice', (l) => m.setup_template_voice_general({}, { locale: l }), { parent: 'voice.category' }),
  item('voice.generator', 'voice', 'voice', (l) => m.setup_template_voice_generator({}, { locale: l }), { parent: 'voice.category', wiring: 'tempvoice' }),

  // Modules allumes en meme temps. Leur nom ne part pas sur Discord et ne suit
  // donc pas la langue du serveur : la page les traduit elle-meme depuis
  // `moduleId`. Il sert de repli, et de libelle dans le Centre de gestion pour
  // ceux qui n'y figurent pas encore - sans quoi ils s'y afficheraient sous
  // leur identifiant brut.
  item('module.tickets', 'modules', 'module', () => 'Tickets', { moduleId: 'tickets', linkedTo: 'tickets.category' }),
  item('module.leveling', 'modules', 'module', () => 'Niveaux & XP', { moduleId: 'leveling', linkedTo: 'bots.level' }),
  item('module.economy', 'modules', 'module', () => 'Économie & RPG', { moduleId: 'economy', linkedTo: 'bots.rpg' }),
  item('module.nickname_moderation', 'modules', 'module', () => 'Modération des pseudos', { moduleId: 'nickname_moderation' }),
  item('module.automod', 'modules', 'module', () => 'AutoMod', { moduleId: 'automod' }),
  item('module.channel_health', 'modules', 'module', () => 'Santé des salons', { moduleId: 'channel_health', linkedTo: 'staff.log' }),
];

const ITEMS_BY_KEY = new Map(SERVER_TEMPLATE_PLAN.map((entry) => [entry.key, entry]));

/**
 * Toutes les cles cochees par defaut : la maquette complete, sauf le captcha.
 *
 * Lui ferme le serveur a tout arrivant tant qu'il n'a pas repondu, et cela se
 * choisit. A defaut c'est l'auto-role qui joue, et le role Membre est donne des
 * l'arrivee.
 */
export const DEFAULT_SELECTION = SERVER_TEMPLATE_PLAN
  .filter((entry) => entry.section !== 'captcha')
  .map((entry) => entry.key);

export type ServerTemplatePlanItem = {
  key: string;
  section: ServerTemplateSection;
  kind: ItemKind;
  parent: string | null;
  name: string;
  wiring: ItemWiring;
  audience: ItemAudience;
  readOnly: boolean;
  required: boolean;
  moduleId: string | null;
  linkedTo: string | null;
  dependsOn: string | null;
};

/** Le plan resolu dans la langue du serveur, tel qu'il sera pose sur Discord. */
export function buildServerTemplatePlan(locale: BotLocale): ServerTemplatePlanItem[] {
  return SERVER_TEMPLATE_PLAN.map((entry) => ({
    key: entry.key,
    section: entry.section,
    kind: entry.kind,
    parent: entry.parent,
    name: entry.name(locale),
    wiring: entry.wiring,
    audience: entry.audience,
    readOnly: entry.readOnly,
    required: entry.required,
    moduleId: entry.moduleId,
    linkedTo: entry.linkedTo,
    dependsOn: entry.dependsOn,
  }));
}

/**
 * Remet une selection venue du dashboard en etat coherent : cles inconnues
 * ecartees, categorie ajoutee des qu'un de ses salons est retenu, elements
 * indispensables a une section retenue rajoutes, et section videe de sa seule
 * categorie ecartee a son tour.
 *
 * Faite cote serveur et non seulement dans la page : la route ne peut pas
 * supposer que le corps de requete vient de notre interface.
 */
export function normalizeSelection(selection: readonly string[]): string[] {
  const kept = new Set(selection.filter((key) => ITEMS_BY_KEY.has(key)));

  for (const key of [...kept]) {
    const entry = ITEMS_BY_KEY.get(key);
    if (entry?.parent) kept.add(entry.parent);
  }

  const activeSections = new Set(
    SERVER_TEMPLATE_PLAN.filter((entry) => kept.has(entry.key)).map((entry) => entry.section),
  );
  for (const entry of SERVER_TEMPLATE_PLAN) {
    if (entry.required && activeSections.has(entry.section)) kept.add(entry.key);
  }

  // Apres les indispensables : ce sont eux qui viennent d'entrer, et leurs
  // dependances traversent les sections.
  for (const entry of SERVER_TEMPLATE_PLAN) {
    if (entry.dependsOn && kept.has(entry.key)) kept.add(entry.dependsOn);
  }

  // Une categorie seule ne vaut pas d'etre creee : elle n'apparaitrait meme pas
  // dans la liste des salons du serveur.
  for (const entry of SERVER_TEMPLATE_PLAN) {
    if (entry.kind !== 'category') continue;
    const hasChild = SERVER_TEMPLATE_PLAN.some((child) => child.parent === entry.key && kept.has(child.key));
    if (!hasChild) kept.delete(entry.key);
  }

  return SERVER_TEMPLATE_PLAN.filter((entry) => kept.has(entry.key)).map((entry) => entry.key);
}

/**
 * Permissions exigees du bot pour la selection donnee.
 *
 * Seule la creation d'un role reclame « Gerer les roles ». Les surcharges
 * posees sur les salons fermes n'en demandent pas de plus que « Gerer les
 * salons » - c'est deja ce dont vit la mise en route des tickets, qui pose la
 * meme categorie fermee. L'exiger ici bloquerait des serveurs qui fonctionnent.
 */
export function requiredPermissionsFor(selection: readonly string[]): bigint[] {
  const required: bigint[] = [PermissionFlagsBits.ManageChannels];
  const createsRole = selection.some((key) => ITEMS_BY_KEY.get(key)?.kind === 'role');
  if (createsRole) required.push(PermissionFlagsBits.ManageRoles);
  return required;
}

type StoredRefs = Record<string, string>;

function readRefs(value: Prisma.JsonValue | null | undefined): StoredRefs {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const refs: StoredRefs = {};
  for (const [key, id] of Object.entries(value as Record<string, unknown>)) {
    if (typeof id === 'string') refs[key] = id;
  }
  return refs;
}

/**
 * Le bot peut etre exclu du serveur ou perdre ses permissions pendant que la
 * mise en place se deroule. Chaque section reverifie donc avant de creer, au
 * lieu de se fier au controle d'entree.
 */
async function assertStillAllowed(guild: Guild, required: bigint[]): Promise<string> {
  const me = guild.members.me ?? await guild.members.fetchMe().catch(() => null);
  if (!me) {
    throw new Error("Kotbo n'est plus membre de ce serveur.");
  }
  const missing = await missingProvisionPermissions(guild, required);
  if (missing.length > 0) {
    throw new Error(`Kotbo n'a plus les permissions nécessaires : ${missing.join(', ')}.`);
  }
  return me.id;
}

export type ServerTemplateResult = {
  items: ProvisionedEntry[];
  /** Modules allumes, par identifiant du dashboard. */
  modules: string[];
  /**
   * Ce qui n'a pas pu etre fait sans pour autant arreter la mise en place :
   * une etape facultative refusee faute de permission, par exemple. Sans les
   * remonter, l'admin croirait tout en place.
   */
  warnings: string[];
  panelSent: boolean;
  interrupted: string | null;
};

export async function applyServerTemplate(input: {
  guild: Guild;
  locale: BotLocale;
  selection: readonly string[];
  auditUser: string;
}): Promise<ServerTemplateResult> {
  const { guild, locale, auditUser } = input;
  const guildId = guild.id;
  const selection = new Set(normalizeSelection(input.selection));
  const required = requiredPermissionsFor([...selection]);
  const reason = m.setup_reason_template({ user: auditUser }, { locale });

  const items: ProvisionedEntry[] = [];
  const modules: string[] = [];
  const warnings: string[] = [];
  const data: Prisma.GuildUpdateInput = {};
  const refs: StoredRefs = {};
  let panelSent = false;

  const config = await prisma.guild.findUnique({
    where: { id: guildId },
    select: {
      staffAnnouncementChannelId: true,
      logChannelId: true,
      economyChannelId: true,
      regulationChannelId: true,
      ticketStaffRoleId: true,
      baseStaffRoleId: true,
      moderatorRoleId: true,
      tempVoiceChannelId: true,
      tempVoiceCategoryId: true,
      serverTemplateRefs: true,
    },
  });
  const knownRefs = readRefs(config?.serverTemplateRefs);
  const raidConfig = await prisma.raidProtectionConfig.findUnique({
    where: { guildId },
    select: { captchaUnverifiedRoleId: true, captchaChannelId: true, captchaVoiceChannelId: true },
  });

  // Ecrit au fil de l'eau : une interruption en cours de route doit laisser
  // derriere elle de quoi reprendre sans rien creer deux fois.
  const persist = async () => {
    const payload: Prisma.GuildUpdateInput = { ...data };
    if (Object.keys(refs).length > 0) {
      payload.serverTemplateRefs = { ...knownRefs, ...refs };
    }
    if (Object.keys(payload).length > 0) {
      await prisma.guild.update({ where: { id: guildId }, data: payload });
    }
  };

  const record = (entry: ProvisionedEntry) => {
    items.push(entry);
    refs[entry.key] = entry.id;
    return entry;
  };

  const everyoneId = guild.roles.everyone.id;

  const nameOf = (key: string) => {
    const entry = ITEMS_BY_KEY.get(key);
    if (!entry) throw new Error(`Élément de plan inconnu : ${key}`);
    return entry.name(locale);
  };

  try {
    // Lit aussi le membre du bot hors du cache : sans lui, aucune surcharge ne
    // serait posee a son nom et il ne verrait pas les salons fermes qu'il vient
    // de creer.
    const botId = await assertStillAllowed(guild, required);

    // Le refus pose sur @everyone vaut aussi pour le bot, des lors qu'il n'est
    // pas administrateur du serveur.
    const botOverwrite: OverwriteResolvable[] = [{
      id: botId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.ManageChannels,
      ]
    }];

    // Les roles d'abord : tous les salons du plan s'appuient dessus, et un role
    // cree apres coup laisserait derriere lui des salons que personne ne voit.
    let memberRoleId: string | null = null;
    if (selection.has('role.member')) {
      const member = await ensureRole(guild, {
        key: 'role.member',
        existingId: knownRefs['role.member'],
        name: nameOf('role.member'),
        reason,
      });
      record(member.entry);
      memberRoleId = member.role.id;
      await persist();
    }

    let unverifiedRoleId: string | null = null;
    if (selection.has('captcha.role')) {
      const unverified = await ensureRole(guild, {
        key: 'captcha.role',
        existingId: raidConfig?.captchaUnverifiedRoleId ?? knownRefs['captcha.role'],
        name: nameOf('captcha.role'),
        reason,
      });
      record(unverified.entry);
      unverifiedRoleId = unverified.role.id;
      await persist();
    }

    const configuredRoleId = config?.ticketStaffRoleId ?? config?.baseStaffRoleId ?? config?.moderatorRoleId ?? null;
    let staffRoleId: string | null = null;
    if (selection.has('role.staff')) {
      const staff = await ensureRole(guild, {
        key: 'role.staff',
        existingId: configuredRoleId ?? knownRefs['role.staff'],
        name: nameOf('role.staff'),
        hoist: true,
        reason,
      });
      record(staff.entry);
      staffRoleId = staff.role.id;
      // Sans condition sur la creation : une reprise apres echec retrouve le
      // role par sa trace, mais le branchement n'aurait jamais ete enregistre.
      // Un role deja choisi par l'admin n'est pas ecrase pour autant.
      if (!config?.ticketStaffRoleId) data.ticketStaffRoleId = staff.role.id;
      if (!config?.baseStaffRoleId) data.baseStaffRoleId = staff.role.id;
      await persist();
    } else if (configuredRoleId) {
      // Le role enregistre peut avoir ete supprime depuis : sans ce controle,
      // Discord refuserait la surcharge et la creation de la categorie avec.
      const existing = guild.roles.cache.get(configuredRoleId)
        ?? await guild.roles.fetch(configuredRoleId).catch(() => null);
      staffRoleId = existing?.id ?? null;
    }

    const staffOverwrite: OverwriteResolvable[] = staffRoleId
      ? [{
          id: staffRoleId,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
          ]
        }]
      : [];
    const restrictedOverwrites: OverwriteResolvable[] = [
      { id: everyoneId, deny: [PermissionFlagsBits.ViewChannel] },
      ...botOverwrite,
      ...staffOverwrite,
    ];

    // Refuser `SendMessages` seul ne suffit pas a interdire de parler : ouvrir
    // un fil releve d'une autre permission, et le membre y ecrirait ce que le
    // salon lui refuse. Les trois voies sont donc fermees ensemble.
    const noWrite = [
      PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.SendMessagesInThreads,
      PermissionFlagsBits.CreatePublicThreads,
      PermissionFlagsBits.CreatePrivateThreads,
    ];

    // Les fils lui sont rendus : le refus vise les membres, pas lui. Sans cela,
    // brancher plus tard les fils d'accueil sur un salon en lecture seule
    // echouerait sans que rien n'explique pourquoi.
    const botReadOnlyOverwrite: OverwriteResolvable = {
      id: botId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.EmbedLinks,
        PermissionFlagsBits.AddReactions,
        PermissionFlagsBits.SendMessagesInThreads,
        PermissionFlagsBits.CreatePublicThreads,
        PermissionFlagsBits.CreatePrivateThreads,
      ],
    };

    /**
     * Le serveur est ferme a @everyone et rouvert au seul role Membre : un
     * arrivant qui ne l'a pas encore - parce qu'il doit passer le captcha, ou
     * parce que l'auto-role n'a pas encore joue - ne voit rien.
     *
     * Sans role Membre, rien n'est ferme : l'admin l'a decoche, et des salons
     * fermes sans role a qui les rouvrir ne seraient visibles que du bot.
     */
    const memberOverwrites: OverwriteResolvable[] | undefined = memberRoleId
      ? [
          { id: everyoneId, deny: [PermissionFlagsBits.ViewChannel] },
          ...botOverwrite,
          {
            id: memberRoleId,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.ReadMessageHistory,
            ],
          },
        ]
      : undefined;

    // `Connect` et `Speak` sont accordes explicitement : le refus pose sur
    // @everyone ne porte que sur la visibilite, mais un serveur qui aurait
    // retire la parole a @everyone laisserait sinon un vocal ou personne
    // n'entre.
    const memberVoiceOverwrites: OverwriteResolvable[] | undefined = memberRoleId
      ? [
          { id: everyoneId, deny: [PermissionFlagsBits.ViewChannel] },
          ...botOverwrite,
          {
            id: memberRoleId,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.Connect,
              PermissionFlagsBits.Speak,
            ],
          },
        ]
      : undefined;

    /**
     * Categorie fermee a @everyone et rouverte aux roles cites, en plus du role
     * Membre. Rend `undefined` quand il n'y a personne a qui l'ouvrir : une
     * categorie fermee sans exception ne serait visible que du bot.
     */
    const visibleTo = (extraViewers: Array<string | null> = []): OverwriteResolvable[] | undefined => {
      const viewers = (memberRoleId ? [memberRoleId, ...extraViewers] : extraViewers)
        .filter((id): id is string => !!id);
      if (viewers.length === 0) return undefined;

      return [
        { id: everyoneId, deny: [PermissionFlagsBits.ViewChannel] },
        ...botOverwrite,
        ...viewers.map((id) => ({ id, allow: [PermissionFlagsBits.ViewChannel] })),
      ];
    };

    /**
     * Lisible de son public, ecrit par le seul bot, mais ouvert aux reactions :
     * un membre repond a un accueil par un emoji, pas par un message.
     *
     * `AddReactions` est accorde explicitement plutot que laisse au reglage du
     * serveur : sur une guilde qui l'a retire a @everyone, le salon aurait ete
     * muet des deux cotes.
     *
     * `extraViewers` ouvre le salon a d'autres roles que le role Membre - le
     * role Non-verifie pour l'accueil, qu'un arrivant doit voir avant d'avoir
     * passe le captcha.
     */
    const readOnlyFor = (extraViewers: Array<string | null> = []): OverwriteResolvable[] => {
      const readOnlyAllow = [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AddReactions,
      ];
      const viewers = (memberRoleId ? [memberRoleId, ...extraViewers] : extraViewers)
        .filter((id): id is string => !!id);

      return [
        // Sans role a qui rouvrir le salon, il reste lisible de tous : le
        // fermer le rendrait invisible de son propre public.
        viewers.length > 0
          ? { id: everyoneId, deny: [PermissionFlagsBits.ViewChannel] }
          : { id: everyoneId, allow: readOnlyAllow, deny: noWrite },
        ...viewers.map((id) => ({ id, allow: readOnlyAllow, deny: noWrite })),
        botReadOnlyOverwrite,
      ];
    };

    // Le reglement est la seule exception a la fermeture generale : Discord
    // exige un salon de regles lisible publiquement pour activer le mode
    // communautaire, et un arrivant ne peut pas accepter des regles qu'il ne
    // voit pas.
    const publicReadOnlyOverwrites: OverwriteResolvable[] = [
      {
        id: everyoneId,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.AddReactions,
        ],
        deny: noWrite,
      },
      botReadOnlyOverwrite,
    ];

    /**
     * Repose l'interdiction de parler sur un salon repris.
     *
     * `ensureTextChannel` ne fixe les surcharges qu'a la creation : sans ce
     * rattrapage, le salon des regles de Discord - toujours repris, jamais
     * cree - porterait la mention « lecture seule » de l'apercu sans la
     * respecter.
     *
     * Reserve au reglement, et surtout pas etendu aux autres salons en lecture
     * seule : leur reprise part d'un salon que l'admin a lui-meme designe, et
     * rien n'empeche qu'il ait choisi le salon principal du serveur pour y
     * annoncer les niveaux ou les arrivees. Y poser l'interdiction rendrait
     * muet un salon de discussion. Un salon de regles, lui, est fait pour ca.
     *
     * `edit` complete les surcharges au lieu de les remplacer : les exceptions
     * que l'admin a posees pour d'autres roles sont conservees.
     */
    const enforceReadOnly = async (channel: NonThreadGuildBasedChannel) => {
      try {
        await channel.permissionOverwrites.edit(everyoneId, {
          ViewChannel: true,
          ReadMessageHistory: true,
          AddReactions: true,
          SendMessages: false,
          SendMessagesInThreads: false,
          CreatePublicThreads: false,
          CreatePrivateThreads: false,
        }, { reason });
        await channel.permissionOverwrites.edit(botId, {
          ViewChannel: true,
          SendMessages: true,
          ReadMessageHistory: true,
          EmbedLinks: true,
          AddReactions: true,
          SendMessagesInThreads: true,
          CreatePublicThreads: true,
          CreatePrivateThreads: true,
        }, { reason });
      } catch (err) {
        // Demande « Gerer les roles ». Le salon existe et reste utilisable :
        // seule l'interdiction manque, et il vaut mieux le dire que l'ignorer.
        warnings.push(`Lecture seule sur #${channel.name} : ${errorMessage(err)}`);
      }
    };

    /**
     * Ferme un salon repris a @everyone et le rouvre au role Membre.
     *
     * `ensureTextChannel` et consorts ne posent leurs surcharges qu'a la
     * creation. Sans ce rattrapage, un salon deja enregistre - le salon de
     * niveaux que l'admin avait designe, la categorie vocale des salons
     * temporaires - resterait ouvert a tous au milieu d'un serveur ferme :
     * l'apercu promettrait un cadenas jamais pose, et la fermeture entiere ne
     * tiendrait qu'a la porte restee ouverte.
     *
     * Seule la visibilite est touchee, jamais le droit d'ecrire : rien
     * n'empeche que l'admin ait designe le salon principal du serveur, et le
     * rendre muet ne fait pas partie de ce qu'il a demande.
     *
     * `edit` complete les surcharges au lieu de les remplacer : les exceptions
     * qu'il a posees pour d'autres roles sont conservees.
     */
    const enforceMemberOnly = async (channel: NonThreadGuildBasedChannel, extraViewers: Array<string | null> = []) => {
      if (!memberRoleId) return;
      try {
        await channel.permissionOverwrites.edit(everyoneId, { ViewChannel: false }, { reason });
        await channel.permissionOverwrites.edit(botId, { ViewChannel: true }, { reason });
        for (const roleId of [memberRoleId, ...extraViewers]) {
          if (roleId) await channel.permissionOverwrites.edit(roleId, { ViewChannel: true }, { reason });
        }
      } catch (err) {
        warnings.push(`Fermeture de #${channel.name} impossible, il reste visible de tous : ${errorMessage(err)}`);
      }
    };

    const ensurePlannedCategory = async (
      key: string,
      existingId: string | null | undefined,
      permissionOverwrites: OverwriteResolvable[] | undefined,
    ) => {
      const created = await ensureCategory(guild, {
        key,
        existingId: existingId ?? knownRefs[key],
        name: nameOf(key),
        permissionOverwrites,
        reason,
      });
      record(created.entry);
      return created.channel.id;
    };

    if (selection.has('staff.category')) {
      await assertStillAllowed(guild, required);
      const parentId = await ensurePlannedCategory('staff.category', null, restrictedOverwrites);

      if (selection.has('staff.general')) {
        const channel = await ensureTextChannel(guild, {
          key: 'staff.general',
          existingId: config?.staffAnnouncementChannelId ?? knownRefs['staff.general'],
          name: nameOf('staff.general'),
          parentId,
          reason,
        });
        record(channel.entry);
        if (config?.staffAnnouncementChannelId !== channel.channel.id) {
          data.staffAnnouncementChannelId = channel.channel.id;
        }
      }

      if (selection.has('staff.log')) {
        const channel = await ensureTextChannel(guild, {
          key: 'staff.log',
          existingId: config?.logChannelId ?? knownRefs['staff.log'],
          name: nameOf('staff.log'),
          parentId,
          reason,
        });
        record(channel.entry);
        if (config?.logChannelId !== channel.channel.id) {
          data.logChannelId = channel.channel.id;
        }
      }

      await persist();
    }

    if (selection.has('captcha.category')) {
      await assertStillAllowed(guild, required);

      // Ouverte au seul role Non-verifie : une fois le captcha reussi, le
      // membre perd ce role et la categorie disparait de sa liste de salons.
      const captchaCategoryOverwrites: OverwriteResolvable[] = [
        { id: everyoneId, deny: [PermissionFlagsBits.ViewChannel] },
        ...botOverwrite,
        ...(unverifiedRoleId ? [{ id: unverifiedRoleId, allow: [PermissionFlagsBits.ViewChannel] }] : []),
      ];
      const parentId = await ensurePlannedCategory('captcha.category', null, captchaCategoryOverwrites);

      const captchaText = await ensureTextChannel(guild, {
        key: 'captcha.text',
        existingId: raidConfig?.captchaChannelId ?? knownRefs['captcha.text'],
        name: nameOf('captcha.text'),
        parentId,
        permissionOverwrites: [
          { id: everyoneId, deny: [PermissionFlagsBits.ViewChannel] },
          ...botOverwrite,
          ...(unverifiedRoleId
            ? [{
                id: unverifiedRoleId,
                allow: [
                  PermissionFlagsBits.ViewChannel,
                  PermissionFlagsBits.SendMessages,
                  PermissionFlagsBits.ReadMessageHistory,
                ],
              }]
            : []),
        ],
        reason,
      });
      record(captchaText.entry);

      // Le role Non-verifie voit le vocal sans pouvoir y entrer : c'est
      // l'autorisation individuelle posee a son tour qui lui ouvre la porte
      // (voir voiceCaptchaService). Un role qui aurait deja « Se connecter »
      // ferait s'entasser tout le monde dedans, et chacun entendrait le code
      // des autres.
      //
      // Deux places : le bot et le membre dont c'est le tour, personne de plus.
      const captchaVoice = await ensureVoiceChannel(guild, {
        key: 'captcha.voice',
        existingId: raidConfig?.captchaVoiceChannelId ?? knownRefs['captcha.voice'],
        name: nameOf('captcha.voice'),
        parentId,
        userLimit: 2,
        permissionOverwrites: [
          { id: everyoneId, deny: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect] },
          {
            id: botId,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.Connect,
              PermissionFlagsBits.Speak,
            ],
          },
          ...(unverifiedRoleId
            ? [{
                id: unverifiedRoleId,
                allow: [PermissionFlagsBits.ViewChannel],
                deny: [PermissionFlagsBits.Connect],
              }]
            : []),
        ],
        reason,
      });
      record(captchaVoice.entry);

      // Le salon de log du staff sert aussi de journal au captcha : il vit hors
      // de la categorie de verification, ou les arrivants n'ont rien a lire.
      const captchaLogChannelId = refs['staff.log'] ?? config?.logChannelId ?? null;

      const { upsertRaidProtectionConfig } = await import('../moderation/raidProtectionService.js');
      await upsertRaidProtectionConfig(guildId, {
        captchaEnabled: true,
        // Le vocal reclame un pack audio et une file d'attente serielle : il se
        // choisit depuis la page Protection anti-raid, une fois le salon en
        // place. L'image marche partout, tout de suite.
        captchaMode: 'IMAGE',
        captchaChannelId: captchaText.channel.id,
        captchaVoiceChannelId: captchaVoice.channel.id,
        captchaUnverifiedRoleId: unverifiedRoleId,
        // Le role rendu a la reussite : sans lui le membre resterait devant un
        // serveur vide, verifie mais sans rien voir.
        captchaVerifiedRoleId: memberRoleId,
        ...(captchaLogChannelId ? { captchaLogChannelId } : {}),
      });

      await setDashboardModuleStatus(guildId, 'raid_protection', true, 'Protection anti-raid');
      modules.push('raid_protection');

      await persist();
    }

    if (selection.has('tickets.category')) {
      await assertStillAllowed(guild, required);
      // Le module tickets pose lui-meme sa categorie et ses salons : la mise en
      // place ne les recree pas de son cote, sinon les deux entrees pourraient
      // diverger.
      //
      // Sous le verrou du module, et non seulement celui de la mise en place :
      // les deux entrees font le meme travail, et une mise en route lancee
      // depuis la page Tickets au meme instant creerait un second jeu de salons.
      const ticketLock = `tickets:${guildId}`;
      if (!acquireProvisionLock(ticketLock)) {
        throw new Error('Une mise en route du module tickets est déjà en cours sur ce serveur.');
      }

      // Le module nomme ses elements pour lui ; le plan les nomme autrement.
      // Sans cette table, les identifiants seraient ranges sous des cles que la
      // previsualisation ne connait pas.
      const ticketKeys: Record<string, string> = {
        category: 'tickets.category',
        panelChannel: 'tickets.panel',
        logChannel: 'tickets.logs',
      };

      const { provisionTicketChannels } = await import('../features/ticketProvisioning.js');
      const ticketItems: ProvisionedEntry[] = [];
      // Le role staff est deja enregistre en base a ce stade : le module y lit
      // lui-meme qui ajouter aux tickets ouverts.
      let outcome: TicketProvisionOutcome | null = null;
      try {
        outcome = await provisionTicketChannels(guild, {
          locale,
          reason,
          items: ticketItems,
          data,
          persist,
          // Le panneau est ouvert a tous quand la mise en route vient de la page
          // Tickets. Ici le serveur entier est ferme a @everyone : l'y laisser
          // ouvert en ferait le seul salon visible avant verification.
          panelViewerRoleId: memberRoleId,
        });
      } finally {
        releaseProvisionLock(ticketLock);
        // Repris meme sur un echec : les salons deja crees doivent figurer au
        // compte rendu, et leurs identifiants dans la trace de reprise.
        for (const entry of ticketItems) {
          record({ ...entry, key: ticketKeys[entry.key] ?? `tickets.${entry.key}` });
        }
      }

      if (outcome?.panelCreated) {
        const { sendTicketSetupEmbed } = await import('../features/ticketService.js');
        await sendTicketSetupEmbed(guild.client, guildId);
        panelSent = true;
      }
    }

    if (selection.has('welcome.category')) {
      await assertStillAllowed(guild, required);
      // Ouverte au role Non-verifie en plus du role Membre : un arrivant doit
      // pouvoir lire l'accueil avant d'avoir passe le captcha. Le reglement,
      // lui, porte ses propres surcharges et reste lisible de tous.
      const parentId = await ensurePlannedCategory('welcome.category', null, visibleTo([unverifiedRoleId]));

      if (selection.has('welcome.welcome')) {
        // Charge a l'usage : le service d'accueil tire `@napi-rs/canvas` pour
        // ses images, dont un service de socle n'a pas a dependre.
        const { getOrCreateWelcomeConfig } = await import('../features/welcomeGoodbyeService.js');
        const welcomeConfig = await getOrCreateWelcomeConfig(guildId);
        const channel = await ensureTextChannel(guild, {
          key: 'welcome.welcome',
          existingId: welcomeConfig.welcomeChannelId ?? knownRefs['welcome.welcome'],
          name: nameOf('welcome.welcome'),
          parentId,
          // Le message d'accueil vise l'arrivant : sans le role Non-verifie ici,
          // il ne verrait pas la bienvenue qui lui est adressee.
          permissionOverwrites: readOnlyFor([unverifiedRoleId]),
          reason,
        });
        record(channel.entry);

        // L'accueil est allume en meme temps que son salon : un salon de
        // bienvenue ou rien ne souhaite la bienvenue n'aurait aucun sens. Le
        // message par defaut est deja pose par la configuration.
        if (welcomeConfig.welcomeChannelId !== channel.channel.id || !welcomeConfig.welcomeEnabled) {
          await prisma.welcomeConfig.update({
            where: { guildId },
            data: { welcomeChannelId: channel.channel.id, welcomeEnabled: true },
          });
        }
      }

      if (selection.has('welcome.rules')) {
        // Le salon des regles de Discord compte comme un salon deja enregistre,
        // juste apres le notre : un serveur communautaire en a forcement un, la
        // plateforme l'exigeant pour activer le mode. Sans le reprendre, on
        // poserait un second reglement a cote du sien.
        const channel = await ensureTextChannel(guild, {
          key: 'welcome.rules',
          existingId: config?.regulationChannelId ?? guild.rulesChannelId ?? knownRefs['welcome.rules'],
          name: nameOf('welcome.rules'),
          parentId,
          permissionOverwrites: publicReadOnlyOverwrites,
          reason,
        });
        record(channel.entry);
        if (!channel.entry.created) await enforceReadOnly(channel.channel);
        if (config?.regulationChannelId !== channel.channel.id) {
          data.regulationChannelId = channel.channel.id;
        }
        // Le reglement n'est pas publie ici : un serveur neuf n'a pas encore
        // d'articles, et l'embed vide qui en sortirait devrait de toute facon
        // etre republie depuis la page Reglement une fois le texte ecrit.

        // Reste a designer le notre aupres de Discord quand il ne l'est pas
        // deja. Le cas ou la plateforme en vise un autre ne se produit que si
        // l'admin avait pointe Kotbo ailleurs : son choix tient, mais il doit
        // savoir que les deux ne se rejoignent pas.
        if (guild.rulesChannelId === channel.channel.id) {
          // Rien a faire : c'est le meme salon.
        } else if (guild.rulesChannelId) {
          warnings.push(
            `Le salon des règles de Discord vise un autre salon que #${channel.channel.name} : les deux règlements restent séparés.`,
          );
        } else if (guild.features.includes('COMMUNITY')) {
          // Hors serveur communautaire, Discord n'expose pas ce reglage : le
          // salon reste un salon ordinaire, en lecture seule.
          //
          // L'operation demande « Gérer le serveur ». Son absence ne doit pas
          // emporter la mise en place : le salon existe, et le module y renvoie.
          try {
            await guild.setRulesChannel(channel.channel.id, reason);
          } catch (err) {
            warnings.push(`Salon des règles Discord : ${errorMessage(err)}`);
          }
        }
      }

      await persist();
    }

    if (selection.has('text.category')) {
      await assertStillAllowed(guild, required);
      const parentId = await ensurePlannedCategory('text.category', null, visibleTo());

      for (const key of ['text.general', 'text.media', 'text.random']) {
        if (!selection.has(key)) continue;
        const channel = await ensureTextChannel(guild, {
          key,
          existingId: knownRefs[key],
          name: nameOf(key),
          parentId,
          permissionOverwrites: memberOverwrites,
          reason,
        });
        record(channel.entry);
      }

      await persist();
    }

    if (selection.has('bots.category')) {
      await assertStillAllowed(guild, required);
      const parentId = await ensurePlannedCategory('bots.category', null, visibleTo());

      if (selection.has('bots.rpg')) {
        const channel = await ensureTextChannel(guild, {
          key: 'bots.rpg',
          existingId: config?.economyChannelId ?? knownRefs['bots.rpg'],
          name: nameOf('bots.rpg'),
          parentId,
          permissionOverwrites: memberOverwrites,
          reason,
        });
        record(channel.entry);
        if (config?.economyChannelId !== channel.channel.id) {
          data.economyChannelId = channel.channel.id;
        }
      }

      if (selection.has('bots.level')) {
        // `levelUpChannelId` porte aussi des valeurs qui ne sont pas des salons
        // (vide pour le salon d'origine, `DM` pour le message prive) : seul un
        // identifiant de salon est repris, le reste part sur une creation.
        const levelConfig = await getOrCreateLevelConfig(guildId);
        const existingId = levelConfig.levelUpChannelId && levelConfig.levelUpChannelId !== 'DM'
          ? levelConfig.levelUpChannelId
          : knownRefs['bots.level'];

        // Le refus d'ecriture vaut aussi pour le bot : sans surcharge a son nom,
        // il ne pourrait pas annoncer les niveaux dans le salon qu'il vient de
        // creer, sauf a etre administrateur du serveur.
        const channel = await ensureTextChannel(guild, {
          key: 'bots.level',
          existingId,
          name: nameOf('bots.level'),
          parentId,
          permissionOverwrites: readOnlyFor(),
          reason,
        });
        record(channel.entry);

        // Ecrit des que la configuration ne pointe pas deja sur ce salon : une
        // reprise apres echec retrouve le salon par sa trace, mais le
        // branchement, lui, n'aurait jamais ete enregistre.
        if (levelConfig.levelUpChannelId !== channel.channel.id) {
          // Le message par defaut est depose en meme temps quand l'admin n'en a
          // pas ecrit : la mise en route doit laisser un texte visible et
          // modifiable, pas un champ vide dont on ne devine pas le rendu.
          await prisma.levelConfig.update({
            where: { guildId },
            data: {
              levelUpChannelId: channel.channel.id,
              levelUpMessage: levelConfig.levelUpMessage?.trim() || defaultLevelUpMessage(locale),
            },
          });
          await invalidateLevelConfigCache(guildId);
        }
      }

      await persist();
    }

    if (selection.has('voice.category')) {
      await assertStillAllowed(guild, required);
      // La categorie deja retenue par les vocaux temporaires sert de repli :
      // le generateur doit vivre dedans, pas a cote.
      const parentId = await ensurePlannedCategory('voice.category', knownRefs['voice.category'] ?? config?.tempVoiceCategoryId, visibleTo());

      if (selection.has('voice.general')) {
        const channel = await ensureVoiceChannel(guild, {
          key: 'voice.general',
          existingId: knownRefs['voice.general'],
          name: nameOf('voice.general'),
          parentId,
          permissionOverwrites: memberVoiceOverwrites,
          reason,
        });
        record(channel.entry);
      }

      if (selection.has('voice.generator')) {
        const channel = await ensureVoiceChannel(guild, {
          key: 'voice.generator',
          existingId: config?.tempVoiceChannelId ?? knownRefs['voice.generator'],
          name: nameOf('voice.generator'),
          parentId,
          permissionOverwrites: memberVoiceOverwrites,
          reason,
        });
        record(channel.entry);
        // Ecrit meme sur un salon repris : cocher le generateur veut dire
        // « je veux des vocaux temporaires », et un salon deja en place mais
        // laisse desactive ne les produirait pas. Le modele de nom, lui, ne
        // remplace pas celui que l'admin aurait choisi.
        data.tempVoiceEnabled = true;
        data.tempVoiceChannelId = channel.channel.id;
        data.tempVoiceCategoryId = parentId;
        if (channel.entry.created) {
          data.tempVoiceNameTemplate = m.setup_template_voice_name({ user: '{user}' }, { locale });
        }
      }

      await persist();
    }

    // Les surcharges ne sont posees qu'a la creation. Un element repris - le
    // salon de niveaux que l'admin avait designe, la categorie vocale des salons
    // temporaires, un panneau de tickets deja en place - resterait donc ouvert a
    // tous au milieu d'un serveur ferme : l'apercu promettrait un cadenas jamais
    // pose, et la fermeture entiere ne tiendrait qu'a la porte restee ouverte.
    //
    // Une seule passe a la fin, sur tout ce qui a ete repris, plutot qu'un
    // rattrapage disperse dans chaque section - la reprise vient de partout, y
    // compris du module tickets qui pose ses salons lui-meme.
    if (memberRoleId) {
      for (const entry of items) {
        if (entry.created) continue;
        const planned = ITEMS_BY_KEY.get(entry.key);
        // Le staff, la verification et le reglement ont chacun leur public :
        // seuls les salons rendus au role Membre sont concernes.
        if (!planned || planned.audience !== 'member' || planned.kind === 'role' || planned.kind === 'module') continue;

        const channel = guild.channels.cache.get(entry.id)
          ?? await guild.channels.fetch(entry.id).catch(() => null);
        if (!channel || channel.isThread()) continue;

        // L'accueil s'adresse a l'arrivant : le fermer au role Non-verifie lui
        // cacherait la bienvenue qui le nomme.
        await enforceMemberOnly(channel, entry.key === 'welcome.welcome' ? [unverifiedRoleId] : []);
      }
    }

    // Qui donne le role Membre, et quand. Sans captcha c'est l'auto-role du
    // module Bienvenue, des l'arrivee ; avec, c'est le captcha lui-meme, une
    // fois le code recopie.
    if (memberRoleId) {
      const { getOrCreateWelcomeConfig } = await import('../features/welcomeGoodbyeService.js');
      const welcomeConfig = await getOrCreateWelcomeConfig(guildId);

      if (selection.has('captcha.category')) {
        // Un auto-role qui donnerait Membre a l'arrivee ferait sauter la
        // verification : l'arrivant verrait le serveur entier sans avoir
        // repondu. Seul celui qui pointe le role Membre est retire, un auto-role
        // choisi par l'admin vers un autre role n'ayant pas cet effet.
        if (welcomeConfig.joinRoleId === memberRoleId) {
          await prisma.welcomeConfig.update({ where: { guildId }, data: { joinRoleId: null } });
        }
      } else {
        // Desactiver le captcha s'il etait actif precedemment pour eviter les conflits
        const raidConfig = await prisma.raidProtectionConfig.findUnique({ where: { guildId } });
        if (raidConfig?.captchaEnabled) {
          const { upsertRaidProtectionConfig } = await import('../moderation/raidProtectionService.js');
          await upsertRaidProtectionConfig(guildId, { captchaEnabled: false });
        }

        if (!welcomeConfig.joinRoleId) {
          await prisma.welcomeConfig.update({ where: { guildId }, data: { joinRoleId: memberRoleId } });
        } else if (welcomeConfig.joinRoleId !== memberRoleId) {
          // Le choix de l'admin tient, mais il faut qu'il sache ce qu'il implique :
          // sans auto-role vers le role Membre, personne ne le recevra jamais et
          // chaque arrivant tombera sur un serveur vide.
          const existing = guild.roles.cache.get(welcomeConfig.joinRoleId);
          warnings.push(
            `L'auto-rôle d'arrivée pointe déjà sur @${existing?.name ?? welcomeConfig.joinRoleId} : il n'a pas été remplacé, mais personne ne recevra @${nameOf('role.member')} à l'arrivée. Changez-le sur la page Bienvenue, ou activez le captcha.`,
          );
        }
      }
    }

    // Les salons d'abord, les modules ensuite : allumer le leveling avant que
    // son salon existe laisserait passer des annonces dans le salon d'origine.
    //
    // Rien n'est jamais eteint ici. Un module absent de la selection est un
    // module que l'admin n'a pas demande, pas un module qu'il veut couper : la
    // mise en place ne doit pas defaire une configuration existante.
    for (const entry of SERVER_TEMPLATE_PLAN) {
      if (entry.kind !== 'module' || !entry.moduleId) continue;
      if (!selection.has(entry.key)) continue;

      // Deux modules ne se resument pas a un interrupteur : l'AutoMod n'a aucun
      // effet sans filtres armes, et la sante des salons analyse sans rien dire
      // tant qu'aucun salon ne recoit ses conseils.
      if (entry.moduleId === 'automod') {
        const { applyRecommendedAutomod } = await import('./moduleProvisioningService.js');
        const warning = await applyRecommendedAutomod(guild.client, guildId);
        if (warning) warnings.push(`AutoMod : ${warning}`);
      } else if (entry.moduleId === 'channel_health') {
        // Le salon staff qu'on vient de poser, sinon celui deja configure : sans
        // salon d'alerte, elle analyse sans jamais rien dire.
        const { enableChannelHealth } = await import('./moduleProvisioningService.js');
        await enableChannelHealth(guildId, refs['staff.log'] ?? config?.logChannelId ?? null);
      }

      await setDashboardModuleStatus(guildId, entry.moduleId, true, entry.name(locale));
      modules.push(entry.moduleId);
    }

    await persist();

    // Les salons viennent d'etre fermes a @everyone : sans ce rattrapage, tous
    // les membres deja presents se retrouveraient devant un serveur vide,
    // l'auto-role comme le captcha ne jouant qu'a l'arrivee.
    //
    // `backfill` : ils etaient la avant que la verification existe, leur
    // imposer un captcha qu'ils n'avaient pas a passer les enfermerait dehors.
    if (memberRoleId) {
      const { reconcileMemberAccess } = await import('./memberAccessService.js');
      const access = await reconcileMemberAccess(guild.client, guildId, { backfill: true });
      if (access.blocked) {
        warnings.push(
          `Les membres déjà présents n'ont pas reçu le rôle d'accès (${access.blocked}) : ils ne verront aucun salon tant que ce n'est pas corrigé.`,
        );
      } else if (access.remaining > 0) {
        warnings.push(
          `${access.granted} membre(s) ont reçu le rôle d'accès, ${access.remaining} restent à faire : Kotbo s'en charge automatiquement dans l'heure.`,
        );
      }
    }

    // L'Onboarding de Discord exige un minimum de salons lisibles par
    // @everyone. Il n'est pas lisible depuis l'API : mieux vaut le signaler que
    // laisser l'admin decouvrir un ecran d'accueil casse.
    if (guild.features.includes('COMMUNITY') && memberRoleId) {
      warnings.push(
        "Serveur communautaire : les salons étant désormais fermés à @everyone, vérifiez l'Onboarding Discord, qui exige des salons publics par défaut.",
      );
    }

    await cache.invalidateGuild(guildId);
    return { items, modules, warnings, panelSent, interrupted: null };
  } catch (err) {
    // Ce qui a ete cree est enregistre malgre l'echec : sans cela, une reprise
    // reposerait les memes salons a cote des precedents.
    await persist().catch(() => null);
    await cache.invalidateGuild(guildId).catch(() => null);
    logger.error('ServerTemplate', `Mise en place interrompue sur ${guildId}: ${errorMessage(err)}`);
    return { items, modules, warnings, panelSent, interrupted: errorMessage(err) };
  }
}
