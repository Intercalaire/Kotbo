/**
 * Mise en service du module Partenariats.
 *
 * Le module demande quatre choses avant de servir a quoi que ce soit : un
 * salon ou le staff travaille, un salon vitrine, un salon de publicites et un
 * role a donner aux partenaires. Les faire creer a la main, un par un, dans
 * quatre listes deroulantes, c'est quatre occasions d'abandonner en route -
 * et un module a moitie regle qui ne previent personne quand un partenariat
 * derape.
 *
 * D'ou `runPartnershipSetup` : un geste qui pose ce qui manque et laisse
 * intact ce qui existe.
 *
 * ── Ce que la mise en service ne fait jamais ────────────────────────────────
 *
 * Elle ne rallume pas les automatismes. Publier des publicites, controler la
 * reciprocite ou rompre un partenariat restent des decisions : la mise en
 * service prepare le terrain, elle ne choisit pas a la place du staff. Seul le
 * module lui-meme est allume, et l'application des avantages, qui n'a de sens
 * que si le reste existe.
 *
 * Elle ne touche pas non plus a ce qui est deja renseigne : un serveur qui a
 * designe son salon partenaires le retrouve tel quel. `ensureTextChannel` et
 * `ensureRole` reprennent l'existant par identifiant, c'est le meme contrat
 * que pour la mise en route des autres modules.
 */
import { PermissionFlagsBits, type Guild, type OverwriteResolvable } from 'discord.js';
import { getPartnershipPreset } from '@kotbo/contracts';
import prisma from '../../utils/db.js';
import {
  ensureCategory,
  ensureRole,
  ensureTextChannel,
  missingProvisionPermissions,
  type ProvisionedEntry,
} from '../core/channelProvisioningService.js';
import { logger } from '../../utils/logger.js';
import { getPartnershipSettings, updatePartnershipSettings } from './partnershipSettings.js';

/** Ce qui manque pour que le module tienne sa promesse. */
export interface PartnershipReadiness {
  /** Le module est allume et tout le necessaire est en place. */
  ready: boolean;
  enabled: boolean;
  /** Elements absents, dans l'ordre ou ils comptent. */
  missing: {
    key: 'staffChannel' | 'showcaseChannel' | 'adsChannel' | 'partnerRole' | 'category';
    label: string;
    /** Pourquoi cet element compte, en une phrase. */
    why: string;
    /** Le module fonctionne sans, mais moins bien. */
    optional: boolean;
  }[];
  /** Permissions Discord qui empecheraient la mise en service. */
  missingPermissions: string[];
}

const NEEDS: {
  key: PartnershipReadiness['missing'][number]['key'];
  field: 'staffChannelId' | 'showcaseChannelId' | 'adsChannelId' | 'partnerRoleId' | 'dedicatedCategoryId';
  label: string;
  why: string;
  optional: boolean;
}[] = [
  {
    key: 'staffChannel',
    field: 'staffChannelId',
    label: 'Salon de travail du staff',
    why: "Sans lui, aucune alerte n'a d'endroit ou aller : demandes recues, engagements non tenus, echeances.",
    optional: false,
  },
  {
    key: 'partnerRole',
    field: 'partnerRoleId',
    label: 'Role Partenaire',
    why: "C'est ce que le module donne aux representants d'un partenaire actif, et reprend a la fin.",
    optional: false,
  },
  {
    key: 'showcaseChannel',
    field: 'showcaseChannelId',
    label: 'Salon vitrine',
    why: 'Les fiches des partenaires actifs y sont publiees et tenues a jour.',
    optional: true,
  },
  {
    key: 'adsChannel',
    field: 'adsChannelId',
    label: 'Salon des publicites',
    why: 'Les annonces des partenaires y sont publiees, avec rotation si vous le demandez.',
    optional: true,
  },
  {
    key: 'category',
    field: 'dedicatedCategoryId',
    label: 'Categorie Partenariats',
    why: 'Range les salons dedies crees pour chaque partenariat.',
    optional: true,
  },
];

/**
 * Diagnostic, sans rien modifier. Sert au bandeau du dashboard : dire ce qui
 * manque et pourquoi, plutot que laisser decouvrir a l'usage qu'une alerte
 * n'est jamais partie.
 */
export async function checkPartnershipReadiness(guild: Guild): Promise<PartnershipReadiness> {
  const settings = await getPartnershipSettings(guild.id);

  const missing = NEEDS.filter((need) => {
    const value = settings[need.field];
    if (!value) return true;
    // Un salon supprime depuis vaut un salon absent : la configuration pointe
    // dans le vide et les alertes tombent dans le neant sans rien dire.
    if (need.field === 'partnerRoleId') return !guild.roles.cache.has(value);
    return !guild.channels.cache.has(value);
  }).map((need) => ({ key: need.key, label: need.label, why: need.why, optional: need.optional }));

  const missingPermissions = await missingProvisionPermissions(guild, [
    PermissionFlagsBits.ManageChannels,
    PermissionFlagsBits.ManageRoles,
  ]);

  return {
    ready: settings.enabled && missing.every((item) => item.optional),
    enabled: settings.enabled,
    missing,
    missingPermissions,
  };
}

export interface SetupResult {
  entries: ProvisionedEntry[];
  /** Ce qui n'a pas pu etre pose, en clair, pour l'afficher tel quel. */
  warnings: string[];
}

/**
 * Pose ce qui manque et allume le module.
 *
 * Les salons de travail sont fermes a `@everyone` et ouverts au staff : un
 * salon partenaires lisible de tous exposerait les negociations en cours. La
 * vitrine et les publicites sont publiques, c'est leur raison d'etre.
 */
export async function runPartnershipSetup(
  guild: Guild,
  options: { staffRoleId?: string | null; auditUser: string },
): Promise<SetupResult> {
  const missingPermissions = await missingProvisionPermissions(guild, [
    PermissionFlagsBits.ManageChannels,
    PermissionFlagsBits.ManageRoles,
  ]);
  if (missingPermissions.length > 0) {
    throw new Error(`Kotbo n'a pas les permissions necessaires : ${missingPermissions.join(', ')}.`);
  }

  const settings = await getPartnershipSettings(guild.id);
  const entries: ProvisionedEntry[] = [];
  const warnings: string[] = [];
  const reason = `Mise en service du module Partenariats par ${options.auditUser}`;

  const me = guild.members.me ?? (await guild.members.fetchMe().catch(() => null));
  const readWrite = [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.ReadMessageHistory,
  ];

  // Le refus pose sur @everyone vaut aussi pour le bot tant qu'il n'est pas
  // administrateur : sans sa propre surcharge, il ne verrait pas le salon
  // qu'il vient de creer.
  const staffOnly: OverwriteResolvable[] = [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    ...(me ? [{ id: me.id, allow: readWrite }] : []),
    ...(options.staffRoleId && guild.roles.cache.has(options.staffRoleId)
      ? [{ id: options.staffRoleId, allow: readWrite }]
      : []),
  ];

  // Les salons publics ne recoivent aucune surcharge : ils suivent les
  // permissions du serveur, comme n'importe quel salon d'annonces. Poser des
  // surcharges ici deferait la configuration d'un serveur deja range.
  const patch: Record<string, string> = {};

  const category = await ensureCategory(guild, {
    key: 'partnerships.category',
    existingId: settings.dedicatedCategoryId,
    name: 'Partenariats',
    reason,
  }).catch((error) => {
    warnings.push("La categorie Partenariats n'a pas pu etre creee.");
    logger.warn('Partenariats : categorie non creee', { guildId: guild.id, error });
    return null;
  });
  if (category) {
    entries.push(category.entry);
    patch.dedicatedCategoryId = category.channel.id;
  }

  const staffChannel = await ensureTextChannel(guild, {
    key: 'partnerships.staff',
    existingId: settings.staffChannelId,
    name: 'partenariats-staff',
    parentId: category?.channel.id ?? null,
    permissionOverwrites: staffOnly,
    reason,
  }).catch((error) => {
    warnings.push("Le salon de travail du staff n'a pas pu etre cree.");
    logger.warn('Partenariats : salon staff non cree', { guildId: guild.id, error });
    return null;
  });
  if (staffChannel) {
    entries.push(staffChannel.entry);
    patch.staffChannelId = staffChannel.channel.id;
  }

  const showcase = await ensureTextChannel(guild, {
    key: 'partnerships.showcase',
    existingId: settings.showcaseChannelId,
    name: 'nos-partenaires',
    parentId: category?.channel.id ?? null,
    reason,
  }).catch((error) => {
    warnings.push("Le salon vitrine n'a pas pu etre cree.");
    logger.warn('Partenariats : salon vitrine non cree', { guildId: guild.id, error });
    return null;
  });
  if (showcase) {
    entries.push(showcase.entry);
    patch.showcaseChannelId = showcase.channel.id;
  }

  const ads = await ensureTextChannel(guild, {
    key: 'partnerships.ads',
    existingId: settings.adsChannelId,
    name: 'pub-partenaires',
    parentId: category?.channel.id ?? null,
    reason,
  }).catch((error) => {
    warnings.push("Le salon des publicites n'a pas pu etre cree.");
    logger.warn('Partenariats : salon des publicites non cree', { guildId: guild.id, error });
    return null;
  });
  if (ads) {
    entries.push(ads.entry);
    patch.adsChannelId = ads.channel.id;
  }

  const partnerRole = await ensureRole(guild, {
    key: 'partnerships.role',
    existingId: settings.partnerRoleId,
    name: 'Partenaire',
    color: 0x5865f2,
    hoist: true,
    // Aucune permission : ce role sert a identifier et a ouvrir des salons,
    // pas a donner des droits. Un role partenaire qui porterait des
    // permissions les donnerait a des gens exterieurs au serveur.
    permissions: [],
    reason,
  }).catch((error) => {
    warnings.push("Le role Partenaire n'a pas pu etre cree.");
    logger.warn('Partenariats : role non cree', { guildId: guild.id, error });
    return null;
  });
  if (partnerRole) {
    entries.push(partnerRole.entry);
    patch.partnerRoleId = partnerRole.role.id;
  }

  await updatePartnershipSettings(guild.id, {
    ...patch,
    enabled: true,
    // Le seul automatisme allume : sans lui, valider un partenariat ne
    // donnerait ni role ni acces, et le module n'aurait servi a rien.
    autoApplyBenefits: true,
  });

  logger.info('Partenariats : mise en service', {
    guildId: guild.id,
    created: entries.filter((entry) => entry.created).length,
    reused: entries.filter((entry) => !entry.created).length,
  });

  return { entries, warnings };
}


// ─── Ajout guide d'un partenaire ─────────────────────────────────────────────

export interface QuickPartnershipInput {
  /** Prereglage choisi, cf. `PARTNERSHIP_PRESETS`. */
  preset: string;
  /** Fiche du partenaire, telle que l'assistant l'a remplie. */
  partner: {
    displayName: string;
    kind?: string;
    inviteUrl?: string | null;
    partnerGuildId?: string | null;
    description?: string | null;
    iconUrl?: string | null;
    bannerUrl?: string | null;
    memberCount?: number | null;
  };
  /** Interlocuteur principal, quand on le connait deja. */
  contactUserId?: string | null;
  endAt?: Date | null;
}

export interface QuickPartnershipResult {
  partnershipId: string;
  partnerId: string;
  /** Ce qui a ete pose, pour le dire a la personne plutot que de la laisser deviner. */
  created: { commitments: number; benefits: number; inviteCode: string | null };
  warnings: string[];
}

/**
 * Cree un partenariat complet a partir d'un prereglage.
 *
 * Le formulaire detaille demande une trentaine de decisions avant d'avoir parle
 * a qui que ce soit : type, niveau, engagements de chaque partie, avantages,
 * invitation. Un prereglage y repond d'un coup, et tout reste modifiable
 * ensuite depuis la fiche.
 *
 * Le dossier s'ouvre a l'etape « Piste », comme n'importe quel dossier :
 * l'activation applique des roles et des exemptions, elle reste un geste
 * explicite.
 */
export async function createPartnershipFromPreset(
  guild: Guild,
  input: QuickPartnershipInput,
  actor: { userId: string; label: string },
): Promise<QuickPartnershipResult> {
  const preset = getPartnershipPreset(input.preset);
  if (!preset) throw new Error(`Prereglage inconnu : ${input.preset}`);

  const { createPartner } = await import('./partnerService.js');
  const { createPartnership } = await import('./partnershipService.js');
  const { addCommitment } = await import('./partnershipCommitmentService.js');
  const { ensurePartnershipInvite } = await import('./partnershipAttributionService.js');

  const warnings: string[] = [];

  const partner = await createPartner(
    {
      guildId: guild.id,
      kind: input.partner.kind ?? 'SERVER',
      displayName: input.partner.displayName,
      description: input.partner.description ?? null,
      inviteUrl: input.partner.inviteUrl ?? null,
      partnerGuildId: input.partner.partnerGuildId ?? null,
      iconUrl: input.partner.iconUrl ?? null,
      bannerUrl: input.partner.bannerUrl ?? null,
      memberCount: input.partner.memberCount ?? null,
    },
    { userId: actor.userId, label: actor.label, source: 'dashboard' },
  );

  if (input.contactUserId) {
    await prisma.partnerContact.create({
      data: {
        partnerId: partner.id,
        userId: input.contactUserId,
        displayName: 'Contact principal',
        role: 'manager',
        primary: true,
      },
    }).catch(() => warnings.push("L'interlocuteur n'a pas pu etre enregistre."));
  }

  const partnership = await createPartnership(
    {
      guildId: guild.id,
      partnerId: partner.id,
      type: preset.type,
      tier: preset.tier,
      title: input.partner.displayName,
      endAt: input.endAt ?? null,
    },
    { userId: actor.userId, label: actor.label, source: 'dashboard' },
  );

  let commitments = 0;
  for (const item of preset.commitments) {
    await addCommitment(partnership.id, {
      kind: item.kind,
      party: item.party,
      targetCount: item.targetCount ?? null,
      targetPeriod: item.targetPeriod ?? null,
    })
      .then(() => {
        commitments += 1;
      })
      .catch(() => warnings.push(`L'engagement ${item.kind} n'a pas pu etre pose.`));
  }

  const settings = await getPartnershipSettings(guild.id);

  // Les avantages sont enregistres, pas appliques : ils le seront a
  // l'activation du dossier, par le chemin habituel.
  let benefits = 0;
  for (const kind of preset.benefits) {
    await prisma.partnershipBenefit
      .create({
        data: {
          partnershipId: partnership.id,
          kind,
          direction: 'GRANTED',
          targetRef: kind === 'PARTNER_ROLE' ? settings.partnerRoleId : null,
        },
      })
      .then(() => {
        benefits += 1;
      })
      .catch(() => warnings.push(`L'avantage ${kind} n'a pas pu etre pose.`));
  }

  const inviteCode = preset.trackInvite ? await ensurePartnershipInvite(guild, partnership.id) : null;
  if (preset.trackInvite && !inviteCode) {
    warnings.push(
      "L'invitation dediee n'a pas pu etre creee : les arrivees ne seront pas attribuees a ce partenaire.",
    );
  }

  return {
    partnershipId: partnership.id,
    partnerId: partner.id,
    created: { commitments, benefits, inviteCode },
    warnings,
  };
}
