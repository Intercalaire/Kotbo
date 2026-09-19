/**
 * Registre du module Partenariats - source de vérité unique.
 *
 * Le module couvre deux réalités que rien n'obligeait à séparer :
 *
 *   - les partenariats d'un serveur client (échange de pubs, alliance,
 *     sponsor, créateur…), gérés depuis son dashboard ;
 *   - les partenariats de Kotbo lui-même, gérés depuis l'administration
 *     globale, qui sont les mêmes objets vus d'un autre étage.
 *
 * D'où un seul moteur, paramétré par trois axes indépendants :
 *
 *   `type`   - ce qu'est le partenariat (`PARTNERSHIP_TYPES`) ;
 *   `tier`   - jusqu'où on le formalise (`PARTNERSHIP_TIERS`) ;
 *   `stage`  - où il en est (`PARTNERSHIP_STAGES`).
 *
 * Croiser les trois plutôt que multiplier les entités évite la dérive
 * habituelle : une table « sponsors », une table « alliés » et une table
 * « créateurs » qui finissent par porter les mêmes colonnes sans les mêmes
 * corrections.
 *
 * Ce paquet ne dépend de rien (ni Prisma, ni discord.js) : le bot, le
 * dashboard et les scripts l'importent tel quel. Les valeurs de ce fichier
 * sont donc des chaînes closes, recopiées telles quelles en base - jamais un
 * `enum` Prisma, pour qu'ajouter un type de partenariat ne demande pas une
 * migration.
 */

// ─────────────────────────────── Nature du partenaire ───────────────────────

/**
 * Ce qu'il y a en face. Détermine les champs d'identité attendus sur la fiche :
 * un serveur Discord a un identifiant de guilde et un lien d'invitation, un
 * créateur a des chaînes et une audience, une organisation a un site et un
 * interlocuteur commercial.
 */
export const PARTNER_KINDS = ['SERVER', 'PERSON', 'ORGANIZATION'] as const;
export type PartnerKind = (typeof PARTNER_KINDS)[number];

export interface PartnerKindMeta {
  key: PartnerKind;
  label: string;
  description: string;
  icon: string;
}

export const PARTNER_KIND_META: PartnerKindMeta[] = [
  {
    key: 'SERVER',
    label: 'Serveur Discord',
    description: "Une autre communauté Discord, avec ou sans Kotbo.",
    icon: 'Server',
  },
  {
    key: 'PERSON',
    label: 'Personne',
    description: 'Un créateur, un ambassadeur, un intervenant.',
    icon: 'User',
  },
  {
    key: 'ORGANIZATION',
    label: 'Organisation',
    description: 'Une marque, un média, une association, une équipe.',
    icon: 'Building',
  },
];

// ─────────────────────────────── Niveau de formalisme ───────────────────────

/**
 * Jusqu'où on formalise. Choisi partenariat par partenariat, parce qu'un
 * échange de pubs avec un serveur ami et un contrat de sponsor à quatre
 * chiffres ne méritent pas la même cérémonie - et qu'imposer la seconde à tout
 * le monde ferait abandonner le module au bout de trois fiches.
 *
 * Le niveau ne verrouille rien en base : il décide de ce que les écrans
 * affichent et de ce que les automatismes exigent. Monter de niveau ne perd
 * aucune donnée, en redescendre non plus.
 */
export const PARTNERSHIP_TIERS = ['SIMPLE', 'PIPELINE', 'CONTRACT'] as const;
export type PartnershipTier = (typeof PARTNERSHIP_TIERS)[number];

export interface PartnershipTierMeta {
  key: PartnershipTier;
  label: string;
  description: string;
  icon: string;
  /** Étapes proposées à ce niveau. Un niveau simple n'a pas de négociation. */
  stages: PartnershipStage[];
  /** Accord versionné et accepté par les deux parties. */
  agreement: boolean;
  /** Engagements structurés et mesurés automatiquement. */
  commitments: boolean;
  /** Volet financier (montants, échéancier, encaissements déclarés). */
  finance: boolean;
  /** Validation par une seconde personne avant activation. */
  dualApproval: boolean;
}

// ─────────────────────────────── Étapes du cycle de vie ─────────────────────

/**
 * Le pipeline. `order` sert au tri des colonnes du tableau kanban ; `terminal`
 * marque les étapes dont on ne repart pas sans rouvrir explicitement le
 * dossier, ce qui évite qu'un partenariat rompu retombe en « actif » sur un
 * clic malheureux.
 */
export const PARTNERSHIP_STAGES = [
  'LEAD',
  'CONTACTED',
  'NEGOTIATING',
  'PENDING_APPROVAL',
  'AWAITING_PARTNER',
  'ACTIVE',
  'PAUSED',
  'RENEWAL',
  'ENDED',
  'BREACHED',
  'REJECTED',
  'ARCHIVED',
] as const;
export type PartnershipStage = (typeof PARTNERSHIP_STAGES)[number];

export interface PartnershipStageMeta {
  key: PartnershipStage;
  label: string;
  description: string;
  icon: string;
  /** Teinte du dashboard. Reprend les accents déjà utilisés par les modules. */
  tone: 'neutral' | 'info' | 'warning' | 'success' | 'danger';
  order: number;
  /** L'étape compte comme un partenariat en cours : avantages actifs. */
  live: boolean;
  /** Fin de parcours : plus d'automatisme, avantages retirés. */
  terminal: boolean;
}

export const PARTNERSHIP_STAGE_META: PartnershipStageMeta[] = [
  {
    key: 'LEAD',
    label: 'Piste',
    description: "Serveur ou personne repérée, jamais contactée.",
    icon: 'Search',
    tone: 'neutral',
    order: 0,
    live: false,
    terminal: false,
  },
  {
    key: 'CONTACTED',
    label: 'Contacté',
    description: 'Prise de contact faite, en attente de réponse.',
    icon: 'Send',
    tone: 'info',
    order: 1,
    live: false,
    terminal: false,
  },
  {
    key: 'NEGOTIATING',
    label: 'En négociation',
    description: 'Les conditions se discutent, rien n\'est arrêté.',
    icon: 'MessageSquare',
    tone: 'info',
    order: 2,
    live: false,
    terminal: false,
  },
  {
    key: 'PENDING_APPROVAL',
    label: 'À valider',
    description: "Conditions arrêtées, en attente de la décision interne.",
    icon: 'ClipboardCheck',
    tone: 'warning',
    order: 3,
    live: false,
    terminal: false,
  },
  {
    key: 'AWAITING_PARTNER',
    label: 'Attente du partenaire',
    description: "Validé chez nous, en attente de l'acceptation d'en face.",
    icon: 'Hourglass',
    tone: 'warning',
    order: 4,
    live: false,
    terminal: false,
  },
  {
    key: 'ACTIVE',
    label: 'Actif',
    description: 'Partenariat en cours : avantages appliqués, engagements suivis.',
    icon: 'CheckCircle',
    tone: 'success',
    order: 5,
    live: true,
    terminal: false,
  },
  {
    key: 'PAUSED',
    label: 'En pause',
    description: "Suspendu temporairement, sans rompre. Les automatismes s'arrêtent.",
    icon: 'Pause',
    tone: 'warning',
    order: 6,
    live: false,
    terminal: false,
  },
  {
    key: 'RENEWAL',
    label: 'À renouveler',
    description: "Arrive à échéance : reconduire, renégocier ou laisser finir.",
    icon: 'RefreshCw',
    tone: 'warning',
    order: 7,
    live: true,
    terminal: false,
  },
  {
    key: 'ENDED',
    label: 'Terminé',
    description: 'Arrivé à son terme sans incident.',
    icon: 'Flag',
    tone: 'neutral',
    order: 8,
    live: false,
    terminal: true,
  },
  {
    key: 'BREACHED',
    label: 'Rompu',
    description: "Interrompu pour non-respect des engagements. Motif obligatoire.",
    icon: 'AlertTriangle',
    tone: 'danger',
    order: 9,
    live: false,
    terminal: true,
  },
  {
    key: 'REJECTED',
    label: 'Refusé',
    description: "Demande déclinée. Conservée : un refus est un historique utile.",
    icon: 'XCircle',
    tone: 'danger',
    order: 10,
    live: false,
    terminal: true,
  },
  {
    key: 'ARCHIVED',
    label: 'Archivé',
    description: 'Sorti des vues courantes, conservé pour les statistiques.',
    icon: 'Archive',
    tone: 'neutral',
    order: 11,
    live: false,
    terminal: true,
  },
];

/** Étapes proposées au niveau simple : pas de négociation, pas de validation. */
const SIMPLE_STAGES: PartnershipStage[] = [
  'LEAD',
  'ACTIVE',
  'PAUSED',
  'ENDED',
  'BREACHED',
  'ARCHIVED',
];

/** Le pipeline complet, moins l'attente du partenaire qui suppose un accord. */
const PIPELINE_STAGES: PartnershipStage[] = [
  'LEAD',
  'CONTACTED',
  'NEGOTIATING',
  'PENDING_APPROVAL',
  'ACTIVE',
  'PAUSED',
  'RENEWAL',
  'ENDED',
  'BREACHED',
  'REJECTED',
  'ARCHIVED',
];

export const PARTNERSHIP_TIER_META: PartnershipTierMeta[] = [
  {
    key: 'SIMPLE',
    label: 'Simple',
    description:
      "Une fiche, des dates, un statut. Pour les partenariats de confiance qu'on ne veut pas administrer.",
    icon: 'Circle',
    stages: SIMPLE_STAGES,
    agreement: false,
    commitments: false,
    finance: false,
    dualApproval: false,
  },
  {
    key: 'PIPELINE',
    label: 'Suivi',
    description:
      "Pipeline complet, responsable assigné, journal des échanges, relances. Le mode de travail courant d'une équipe partenariats.",
    icon: 'Kanban',
    stages: PIPELINE_STAGES,
    agreement: false,
    commitments: true,
    finance: false,
    dualApproval: false,
  },
  {
    key: 'CONTRACT',
    label: 'Contractuel',
    description:
      "Accord versionné accepté des deux côtés, engagements mesurés, volet financier, double validation. Pour les sponsors et les partenariats à enjeu.",
    icon: 'FileSignature',
    stages: [...PIPELINE_STAGES.slice(0, 4), 'AWAITING_PARTNER', ...PIPELINE_STAGES.slice(4)],
    agreement: true,
    commitments: true,
    finance: true,
    dualApproval: true,
  },
];

// ─────────────────────────────── Types de partenariat ───────────────────────

export const PARTNERSHIP_TYPES = [
  // Serveurs Discord
  'CROSS_PROMO',
  'ALLIANCE',
  'NETWORK',
  'SISTER_SERVER',
  'HUB',
  'EVENT',
  'TOURNAMENT',
  'GIVEAWAY_SWAP',
  'CONTENT_SWAP',
  'STAFF_EXCHANGE',
  'RECRUITMENT',
  'SUPPORT',
  // Personnes
  'CREATOR',
  'AMBASSADOR',
  'TALENT',
  // Organisations
  'SPONSOR_IN',
  'SPONSOR_OUT',
  'BRAND',
  'AFFILIATE',
  'MEDIA',
  'CHARITY',
  'TOOL',
  'ESPORT_TEAM',
  'EDUCATION',
  // Fourre-tout assumé
  'CUSTOM',
] as const;
export type PartnershipType = (typeof PARTNERSHIP_TYPES)[number];

export interface PartnershipTypeMeta {
  key: PartnershipType;
  label: string;
  description: string;
  icon: string;
  /** Natures de partenaire acceptées pour ce type. */
  kinds: PartnerKind[];
  /** Niveau de formalisme proposé par défaut à la création. */
  defaultTier: PartnershipTier;
  /**
   * Le partenariat repose sur un échange symétrique dont on peut vérifier la
   * tenue chez l'autre (pub affichée, salon maintenu). Active le contrôle de
   * réciprocité et le comparatif donné / reçu.
   */
  reciprocal: boolean;
  /** Comporte des flux d'argent ou de lots : ouvre le volet financier. */
  financial: boolean;
  /** Attend un flux de membres : ouvre l'attribution par invitation. */
  tracksMembers: boolean;
  /** Vit hors de Discord : ouvre les liens traçables et les réseaux sociaux. */
  external: boolean;
  /** Engagements proposés d'office à la création. */
  suggestedCommitments: PartnershipCommitmentKind[];
}

export const PARTNERSHIP_TYPE_META: PartnershipTypeMeta[] = [
  {
    key: 'CROSS_PROMO',
    label: 'Échange de publicités',
    description: "Chacun publie la publicité de l'autre, une fois ou périodiquement.",
    icon: 'Megaphone',
    kinds: ['SERVER'],
    defaultTier: 'PIPELINE',
    reciprocal: true,
    financial: false,
    tracksMembers: true,
    external: false,
    suggestedCommitments: ['PROMO_POST', 'KEEP_AD_VISIBLE'],
  },
  {
    key: 'ALLIANCE',
    label: 'Alliance permanente',
    description: "Partenariat durable sans contrepartie ponctuelle : entraide et visibilité mutuelle.",
    icon: 'Handshake',
    kinds: ['SERVER'],
    defaultTier: 'SIMPLE',
    reciprocal: true,
    financial: false,
    tracksMembers: true,
    external: false,
    suggestedCommitments: ['KEEP_AD_VISIBLE', 'REPRESENTATIVE_PRESENT'],
  },
  {
    key: 'NETWORK',
    label: 'Réseau de serveurs',
    description: "Appartenance à une fédération : plusieurs serveurs liés par les mêmes règles.",
    icon: 'Network',
    kinds: ['SERVER'],
    defaultTier: 'CONTRACT',
    reciprocal: true,
    financial: false,
    tracksMembers: true,
    external: false,
    suggestedCommitments: ['KEEP_AD_VISIBLE', 'REPRESENTATIVE_PRESENT', 'MODERATION_HELP'],
  },
  {
    key: 'SISTER_SERVER',
    label: 'Serveur frère',
    description: "Serveur annexe tenu par la même équipe : annonces relayées, staff commun.",
    icon: 'Copy',
    kinds: ['SERVER'],
    defaultTier: 'SIMPLE',
    reciprocal: true,
    financial: false,
    tracksMembers: true,
    external: false,
    suggestedCommitments: ['CONTENT_RELAY', 'MODERATION_HELP'],
  },
  {
    key: 'HUB',
    label: 'Annuaire / hub',
    description: "Serveur qui référence le vôtre dans un annuaire, un classement ou un portail.",
    icon: 'Compass',
    kinds: ['SERVER', 'ORGANIZATION'],
    defaultTier: 'SIMPLE',
    reciprocal: false,
    financial: false,
    tracksMembers: true,
    external: true,
    suggestedCommitments: ['KEEP_AD_VISIBLE'],
  },
  {
    key: 'EVENT',
    label: 'Événement commun',
    description: "Opération ponctuelle organisée à plusieurs, avec une date de fin connue d'avance.",
    icon: 'CalendarDays',
    kinds: ['SERVER', 'PERSON', 'ORGANIZATION'],
    defaultTier: 'PIPELINE',
    reciprocal: true,
    financial: false,
    tracksMembers: true,
    external: false,
    suggestedCommitments: ['EVENT_PARTICIPATION', 'PROMO_POST'],
  },
  {
    key: 'TOURNAMENT',
    label: 'Compétition / esport',
    description: "Tournoi partagé : équipes, lots, diffusion et inscriptions croisées.",
    icon: 'Trophy',
    kinds: ['SERVER', 'ORGANIZATION'],
    defaultTier: 'CONTRACT',
    reciprocal: true,
    financial: true,
    tracksMembers: true,
    external: false,
    suggestedCommitments: ['EVENT_PARTICIPATION', 'PRIZE_SUPPLY', 'PROMO_POST'],
  },
  {
    key: 'GIVEAWAY_SWAP',
    label: 'Giveaway croisé',
    description: "Concours co-organisé, ou lots fournis d'un côté et audience de l'autre.",
    icon: 'Gift',
    kinds: ['SERVER', 'PERSON', 'ORGANIZATION'],
    defaultTier: 'PIPELINE',
    reciprocal: true,
    financial: true,
    tracksMembers: true,
    external: false,
    suggestedCommitments: ['PRIZE_SUPPLY', 'PROMO_POST'],
  },
  {
    key: 'CONTENT_SWAP',
    label: 'Relais de contenu',
    description: "Annonces, actualités ou flux republiés de part et d'autre.",
    icon: 'Rss',
    kinds: ['SERVER', 'PERSON', 'ORGANIZATION'],
    defaultTier: 'PIPELINE',
    reciprocal: true,
    financial: false,
    tracksMembers: false,
    external: true,
    suggestedCommitments: ['CONTENT_RELAY', 'CONTENT_MENTION'],
  },
  {
    key: 'STAFF_EXCHANGE',
    label: 'Entraide staff',
    description: "Modération mutuelle, partage de signalements, renfort en cas de raid.",
    icon: 'ShieldCheck',
    kinds: ['SERVER'],
    defaultTier: 'CONTRACT',
    reciprocal: true,
    financial: false,
    tracksMembers: false,
    external: false,
    suggestedCommitments: ['MODERATION_HELP', 'REPRESENTATIVE_PRESENT'],
  },
  {
    key: 'RECRUITMENT',
    label: 'Vivier de recrutement',
    description: "Clan, guilde ou équipe qui recrute chez vous, et vous envoie ses membres.",
    icon: 'UserPlus',
    kinds: ['SERVER', 'ORGANIZATION'],
    defaultTier: 'PIPELINE',
    reciprocal: true,
    financial: false,
    tracksMembers: true,
    external: false,
    suggestedCommitments: ['MEMBERS_BROUGHT', 'REPRESENTATIVE_PRESENT'],
  },
  {
    key: 'SUPPORT',
    label: 'Soutien',
    description: "Mention de courtoisie sans contrepartie attendue.",
    icon: 'Heart',
    kinds: ['SERVER', 'PERSON', 'ORGANIZATION'],
    defaultTier: 'SIMPLE',
    reciprocal: false,
    financial: false,
    tracksMembers: false,
    external: true,
    suggestedCommitments: [],
  },
  {
    key: 'CREATOR',
    label: 'Créateur de contenu',
    description: "Streamer, vidéaste ou podcasteur qui parle de vous à son audience.",
    icon: 'Video',
    kinds: ['PERSON'],
    defaultTier: 'PIPELINE',
    reciprocal: true,
    financial: true,
    tracksMembers: true,
    external: true,
    suggestedCommitments: ['CONTENT_MENTION', 'MEMBERS_BROUGHT'],
  },
  {
    key: 'AMBASSADOR',
    label: 'Ambassadeur',
    description: "Membre ou personnalité qui vous représente ailleurs, avec un rôle dédié.",
    icon: 'Star',
    kinds: ['PERSON'],
    defaultTier: 'SIMPLE',
    reciprocal: false,
    financial: false,
    tracksMembers: true,
    external: true,
    suggestedCommitments: ['CONTENT_MENTION'],
  },
  {
    key: 'TALENT',
    label: 'Intervenant',
    description: "Artiste, animateur ou prestataire engagé pour une opération précise.",
    icon: 'Mic',
    kinds: ['PERSON'],
    defaultTier: 'CONTRACT',
    reciprocal: false,
    financial: true,
    tracksMembers: false,
    external: true,
    suggestedCommitments: ['EVENT_PARTICIPATION', 'PAYMENT'],
  },
  {
    key: 'SPONSOR_IN',
    label: 'Sponsor',
    description: "Finance ou dote votre communauté en échange de visibilité.",
    icon: 'BadgeDollarSign',
    kinds: ['ORGANIZATION', 'PERSON'],
    defaultTier: 'CONTRACT',
    reciprocal: true,
    financial: true,
    tracksMembers: false,
    external: true,
    suggestedCommitments: ['PAYMENT', 'PRIZE_SUPPLY', 'KEEP_AD_VISIBLE'],
  },
  {
    key: 'SPONSOR_OUT',
    label: 'Sponsoring sortant',
    description: "C'est vous qui financez ou dotez : événement, équipe, créateur.",
    icon: 'HandCoins',
    kinds: ['ORGANIZATION', 'PERSON', 'SERVER'],
    defaultTier: 'CONTRACT',
    reciprocal: true,
    financial: true,
    tracksMembers: true,
    external: true,
    suggestedCommitments: ['PAYMENT', 'CONTENT_MENTION'],
  },
  {
    key: 'BRAND',
    label: 'Marque / boutique',
    description: "Entreprise qui propose des offres, des codes ou des produits à vos membres.",
    icon: 'ShoppingBag',
    kinds: ['ORGANIZATION'],
    defaultTier: 'CONTRACT',
    reciprocal: true,
    financial: true,
    tracksMembers: false,
    external: true,
    suggestedCommitments: ['PROMO_POST', 'PRIZE_SUPPLY'],
  },
  {
    key: 'AFFILIATE',
    label: 'Affiliation',
    description: "Code promo ou lien traçable, rémunéré à la conversion.",
    icon: 'Link',
    kinds: ['ORGANIZATION', 'PERSON'],
    defaultTier: 'CONTRACT',
    reciprocal: false,
    financial: true,
    tracksMembers: false,
    external: true,
    suggestedCommitments: ['PAYMENT', 'CONTENT_MENTION'],
  },
  {
    key: 'MEDIA',
    label: 'Média',
    description: "Presse, site ou chaîne qui relaie vos annonces.",
    icon: 'Newspaper',
    kinds: ['ORGANIZATION'],
    defaultTier: 'PIPELINE',
    reciprocal: false,
    financial: false,
    tracksMembers: false,
    external: true,
    suggestedCommitments: ['CONTENT_MENTION'],
  },
  {
    key: 'CHARITY',
    label: 'Association',
    description: "Opération caritative ou associative, souvent avec collecte.",
    icon: 'HeartHandshake',
    kinds: ['ORGANIZATION'],
    defaultTier: 'PIPELINE',
    reciprocal: false,
    financial: true,
    tracksMembers: false,
    external: true,
    suggestedCommitments: ['EVENT_PARTICIPATION', 'CONTENT_MENTION'],
  },
  {
    key: 'TOOL',
    label: 'Outil / bot',
    description: "Bot, service ou studio technique partenaire, avec intégration croisée.",
    icon: 'Wrench',
    kinds: ['ORGANIZATION', 'PERSON'],
    defaultTier: 'PIPELINE',
    reciprocal: true,
    financial: false,
    tracksMembers: false,
    external: true,
    suggestedCommitments: ['CONTENT_MENTION', 'CUSTOM'],
  },
  {
    key: 'ESPORT_TEAM',
    label: 'Équipe esport',
    description: "Structure compétitive hébergée ou représentée sur votre serveur.",
    icon: 'Swords',
    kinds: ['ORGANIZATION'],
    defaultTier: 'CONTRACT',
    reciprocal: true,
    financial: true,
    tracksMembers: true,
    external: true,
    suggestedCommitments: ['EVENT_PARTICIPATION', 'REPRESENTATIVE_PRESENT'],
  },
  {
    key: 'EDUCATION',
    label: 'École / association étudiante',
    description: "Établissement ou association qui oriente ses membres vers vous.",
    icon: 'GraduationCap',
    kinds: ['ORGANIZATION'],
    defaultTier: 'PIPELINE',
    reciprocal: false,
    financial: false,
    tracksMembers: true,
    external: true,
    suggestedCommitments: ['MEMBERS_BROUGHT'],
  },
  {
    key: 'CUSTOM',
    label: 'Sur mesure',
    description: "Rien de tout cela : tout est à définir à la main.",
    icon: 'Settings',
    kinds: ['SERVER', 'PERSON', 'ORGANIZATION'],
    defaultTier: 'PIPELINE',
    reciprocal: false,
    financial: false,
    tracksMembers: false,
    external: false,
    suggestedCommitments: ['CUSTOM'],
  },
];

// ─────────────────────────────── Engagements ────────────────────────────────

/**
 * Ce que chaque partie promet. Un engagement n'a d'intérêt que s'il se vérifie
 * sans qu'on y pense : chaque genre indique donc comment il se mesure
 * (`measure`), et le service de suivi sait produire ce chiffre.
 *
 * `DECLARATIVE` est assumé : certaines promesses ne se mesurent pas depuis un
 * bot (« une story par mois »). Elles restent utiles à écrire, elles sont
 * simplement pointées à la main.
 */
export const PARTNERSHIP_COMMITMENT_KINDS = [
  'PROMO_POST',
  'KEEP_AD_VISIBLE',
  'MEMBERS_BROUGHT',
  'CONTENT_RELAY',
  'CONTENT_MENTION',
  'EVENT_PARTICIPATION',
  'REPRESENTATIVE_PRESENT',
  'MODERATION_HELP',
  'PRIZE_SUPPLY',
  'PAYMENT',
  'ROLE_GRANTED',
  'CHANNEL_ACCESS',
  'CUSTOM',
] as const;
export type PartnershipCommitmentKind = (typeof PARTNERSHIP_COMMITMENT_KINDS)[number];

export interface PartnershipCommitmentMeta {
  key: PartnershipCommitmentKind;
  label: string;
  description: string;
  icon: string;
  /**
   * Comment le respect est constaté :
   *  - `AUTOMATIC`   : le bot le mesure seul (publications, arrivées, présence) ;
   *  - `RECIPROCITY` : suppose de voir chez le partenaire, donc Kotbo des deux
   *                    côtés ou un salon surveillé ;
   *  - `DECLARATIVE` : coché par le staff.
   */
  measure: 'AUTOMATIC' | 'RECIPROCITY' | 'DECLARATIVE';
  /** L'engagement porte une quantité par période (N publications par mois). */
  quantified: boolean;
  /** Relève du volet financier. */
  financial: boolean;
}

export const PARTNERSHIP_COMMITMENT_META: PartnershipCommitmentMeta[] = [
  {
    key: 'PROMO_POST',
    label: 'Publications de pub',
    description: "Publier la publicité de l'autre, N fois par période.",
    icon: 'Megaphone',
    measure: 'AUTOMATIC',
    quantified: true,
    financial: false,
  },
  {
    key: 'KEEP_AD_VISIBLE',
    label: 'Publicité maintenue',
    description: "Laisser la publicité en place et accessible pendant toute la durée.",
    icon: 'Eye',
    measure: 'RECIPROCITY',
    quantified: false,
    financial: false,
  },
  {
    key: 'MEMBERS_BROUGHT',
    label: 'Arrivées apportées',
    description: "Objectif d'arrivées attribuées au partenaire sur la période.",
    icon: 'UserPlus',
    measure: 'AUTOMATIC',
    quantified: true,
    financial: false,
  },
  {
    key: 'CONTENT_RELAY',
    label: 'Relais des annonces',
    description: "Republier les annonces de l'autre dans un salon convenu.",
    icon: 'Rss',
    measure: 'AUTOMATIC',
    quantified: true,
    financial: false,
  },
  {
    key: 'CONTENT_MENTION',
    label: 'Mention externe',
    description: "Citer la communauté dans du contenu hors Discord.",
    icon: 'AtSign',
    measure: 'DECLARATIVE',
    quantified: true,
    financial: false,
  },
  {
    key: 'EVENT_PARTICIPATION',
    label: 'Participation à un événement',
    description: "Tenir sa part d'une opération commune, à une date donnée.",
    icon: 'CalendarDays',
    measure: 'DECLARATIVE',
    quantified: false,
    financial: false,
  },
  {
    key: 'REPRESENTATIVE_PRESENT',
    label: 'Représentant présent',
    description: "Garder au moins un représentant joignable sur le serveur.",
    icon: 'Users',
    measure: 'AUTOMATIC',
    quantified: false,
    financial: false,
  },
  {
    key: 'MODERATION_HELP',
    label: 'Entraide modération',
    description: "Répondre aux demandes de renfort et partager les signalements.",
    icon: 'ShieldCheck',
    measure: 'DECLARATIVE',
    quantified: false,
    financial: false,
  },
  {
    key: 'PRIZE_SUPPLY',
    label: 'Fourniture de lots',
    description: "Fournir les lots convenus pour un concours ou un événement.",
    icon: 'Gift',
    measure: 'DECLARATIVE',
    quantified: true,
    financial: true,
  },
  {
    key: 'PAYMENT',
    label: 'Versement',
    description: "Payer le montant convenu, à l'échéance convenue.",
    icon: 'BadgeDollarSign',
    measure: 'DECLARATIVE',
    quantified: true,
    financial: true,
  },
  {
    key: 'ROLE_GRANTED',
    label: 'Rôle accordé',
    description: "Attribuer et maintenir un rôle aux représentants de l'autre.",
    icon: 'Tag',
    measure: 'AUTOMATIC',
    quantified: false,
    financial: false,
  },
  {
    key: 'CHANNEL_ACCESS',
    label: 'Accès à un salon',
    description: "Ouvrir un salon dédié ou partagé et le maintenir accessible.",
    icon: 'Hash',
    measure: 'AUTOMATIC',
    quantified: false,
    financial: false,
  },
  {
    key: 'CUSTOM',
    label: 'Engagement libre',
    description: "Formulé à la main, pointé à la main.",
    icon: 'PenLine',
    measure: 'DECLARATIVE',
    quantified: false,
    financial: false,
  },
];

// ─────────────────────────────── Avantages ──────────────────────────────────

/**
 * Ce qu'un partenariat ouvre concrètement sur le serveur. Chaque avantage est
 * appliqué à l'activation et retiré à la fin - c'est tout l'intérêt de les
 * décrire ici plutôt que de les laisser à la mémoire du staff : un partenariat
 * qui se termine laissait jusqu'ici son rôle, son salon et ses exemptions
 * derrière lui.
 */
export const PARTNERSHIP_BENEFIT_KINDS = [
  'PARTNER_ROLE',
  'CHANNEL_ACCESS',
  'DEDICATED_CHANNEL',
  'SHOWCASE',
  'PINNED_AD',
  'ANNOUNCEMENT',
  'AUTOMOD_EXEMPTION',
  'INVITE_ALLOWED',
  'VERIFICATION_BYPASS',
  'RAID_WHITELIST',
  'XP_BONUS',
  'COIN_BONUS',
  'SHOP_DISCOUNT',
  'GIVEAWAY_ACCESS',
  'DROP_ACCESS',
  'EVENT_ACCESS',
  'SUPPORT_PRIORITY',
  'CUSTOM',
] as const;
export type PartnershipBenefitKind = (typeof PARTNERSHIP_BENEFIT_KINDS)[number];

export interface PartnershipBenefitMeta {
  key: PartnershipBenefitKind;
  label: string;
  description: string;
  icon: string;
  /**
   * Module dont dépend l'avantage. Si le module est éteint, l'avantage est
   * proposé grisé plutôt que silencieusement inopérant.
   */
  requiresModule?: string;
  /** L'application demande une cible (rôle, salon, montant). */
  needsTarget: boolean;
  /** L'avantage s'applique aux membres venus du partenaire, pas aux représentants. */
  audience: 'REPRESENTATIVES' | 'REFERRED_MEMBERS' | 'EVERYONE';
  /** Retiré automatiquement à la fin du partenariat. */
  revocable: boolean;
}

export const PARTNERSHIP_BENEFIT_META: PartnershipBenefitMeta[] = [
  {
    key: 'PARTNER_ROLE',
    label: 'Rôle partenaire',
    description: "Rôle attribué aux représentants déclarés, retiré à la fin.",
    icon: 'Tag',
    needsTarget: true,
    audience: 'REPRESENTATIVES',
    revocable: true,
  },
  {
    key: 'CHANNEL_ACCESS',
    label: 'Accès à un salon',
    description: "Ouverture d'un salon existant aux représentants.",
    icon: 'Hash',
    needsTarget: true,
    audience: 'REPRESENTATIVES',
    revocable: true,
  },
  {
    key: 'DEDICATED_CHANNEL',
    label: 'Salon dédié',
    description: "Salon créé pour ce partenariat, archivé à la fin plutôt que supprimé.",
    icon: 'FolderPlus',
    needsTarget: false,
    audience: 'REPRESENTATIVES',
    revocable: true,
  },
  {
    key: 'SHOWCASE',
    label: 'Vitrine',
    description: "Fiche publiée dans le salon annuaire, tenue à jour automatiquement.",
    icon: 'LayoutGrid',
    needsTarget: false,
    audience: 'EVERYONE',
    revocable: true,
  },
  {
    key: 'PINNED_AD',
    label: 'Publicité épinglée',
    description: "Message de publicité épinglé dans le salon convenu.",
    icon: 'Pin',
    needsTarget: true,
    audience: 'EVERYONE',
    revocable: true,
  },
  {
    key: 'ANNOUNCEMENT',
    label: 'Annonce de lancement',
    description: "Annonce publiée à l'activation du partenariat.",
    icon: 'Megaphone',
    needsTarget: true,
    audience: 'EVERYONE',
    revocable: false,
  },
  {
    key: 'AUTOMOD_EXEMPTION',
    label: "Exemption d'automod",
    description: "Les représentants échappent au filtrage anti-pub et anti-lien.",
    icon: 'ShieldOff',
    requiresModule: 'automod',
    needsTarget: false,
    audience: 'REPRESENTATIVES',
    revocable: true,
  },
  {
    key: 'INVITE_ALLOWED',
    label: "Droit d'inviter",
    description: "Autorisation de poster des liens d'invitation vers leur serveur.",
    icon: 'Link',
    requiresModule: 'automod',
    needsTarget: false,
    audience: 'REPRESENTATIVES',
    revocable: true,
  },
  {
    key: 'VERIFICATION_BYPASS',
    label: 'Vérification contournée',
    description: "Les représentants entrent sans passer par la vérification.",
    icon: 'ShieldCheck',
    requiresModule: 'verification',
    needsTarget: false,
    audience: 'REPRESENTATIVES',
    revocable: true,
  },
  {
    key: 'RAID_WHITELIST',
    label: 'Liste blanche anti-raid',
    description: "L'arrivée groupée de leurs membres ne déclenche pas la protection.",
    icon: 'ShieldAlert',
    requiresModule: 'raid_protection',
    needsTarget: false,
    audience: 'REFERRED_MEMBERS',
    revocable: true,
  },
  {
    key: 'XP_BONUS',
    label: "Bonus d'expérience",
    description: "Multiplicateur d'XP pour les membres venus du partenaire.",
    icon: 'TrendingUp',
    requiresModule: 'leveling',
    needsTarget: true,
    audience: 'REFERRED_MEMBERS',
    revocable: true,
  },
  {
    key: 'COIN_BONUS',
    label: 'Prime de bienvenue',
    description: "Monnaie créditée aux membres venus du partenaire.",
    icon: 'Coins',
    requiresModule: 'economy',
    needsTarget: true,
    audience: 'REFERRED_MEMBERS',
    revocable: false,
  },
  {
    key: 'SHOP_DISCOUNT',
    label: 'Remise boutique',
    description: "Réduction sur la boutique pour les représentants ou les membres venus.",
    icon: 'ShoppingBag',
    requiresModule: 'economy',
    needsTarget: true,
    audience: 'REFERRED_MEMBERS',
    revocable: true,
  },
  {
    key: 'GIVEAWAY_ACCESS',
    label: 'Accès aux concours',
    description: "Participation aux giveaways réservés aux partenaires.",
    icon: 'Gift',
    requiresModule: 'giveaways',
    needsTarget: false,
    audience: 'REPRESENTATIVES',
    revocable: true,
  },
  {
    key: 'DROP_ACCESS',
    label: 'Accès aux drops',
    description: "Éligibilité aux drops sponsorisés du partenariat.",
    icon: 'PackageOpen',
    requiresModule: 'drops',
    needsTarget: false,
    audience: 'REFERRED_MEMBERS',
    revocable: true,
  },
  {
    key: 'EVENT_ACCESS',
    label: 'Accès aux événements',
    description: "Invitation aux événements du serveur réservés aux partenaires.",
    icon: 'CalendarDays',
    requiresModule: 'events',
    needsTarget: false,
    audience: 'REPRESENTATIVES',
    revocable: true,
  },
  {
    key: 'SUPPORT_PRIORITY',
    label: 'Support prioritaire',
    description: "Leurs tickets passent devant, avec une file dédiée.",
    icon: 'LifeBuoy',
    requiresModule: 'tickets',
    needsTarget: false,
    audience: 'REPRESENTATIVES',
    revocable: true,
  },
  {
    key: 'CUSTOM',
    label: 'Avantage libre',
    description: "Décrit à la main, appliqué à la main.",
    icon: 'PenLine',
    needsTarget: false,
    audience: 'REPRESENTATIVES',
    revocable: false,
  },
];

// ─────────────────────────────── Permissions ────────────────────────────────

/**
 * Droits du module, volontairement fins. Par défaut, seuls les administrateurs
 * les détiennent ; le centre de gestion peut les rouvrir rôle par rôle, comme
 * il le fait déjà pour les autres modules.
 */
export const PARTNERSHIP_PERMISSIONS = [
  'partnerships.view',
  'partnerships.propose',
  'partnerships.negotiate',
  'partnerships.approve',
  'partnerships.terminate',
  'partnerships.benefits',
  'partnerships.finance',
  'partnerships.directory',
  'partnerships.reputation',
  'partnerships.configure',
] as const;
export type PartnershipPermission = (typeof PARTNERSHIP_PERMISSIONS)[number];

export interface PartnershipPermissionMeta {
  key: PartnershipPermission;
  label: string;
  description: string;
}

export const PARTNERSHIP_PERMISSION_META: PartnershipPermissionMeta[] = [
  { key: 'partnerships.view', label: 'Consulter', description: 'Voir les fiches et le pipeline.' },
  { key: 'partnerships.propose', label: 'Proposer', description: 'Créer une piste et contacter un partenaire.' },
  { key: 'partnerships.negotiate', label: 'Négocier', description: "Modifier les conditions et l'accord avant validation." },
  { key: 'partnerships.approve', label: 'Valider', description: 'Activer un partenariat et appliquer ses avantages.' },
  { key: 'partnerships.terminate', label: 'Rompre', description: 'Suspendre, rompre ou archiver un partenariat.' },
  { key: 'partnerships.benefits', label: 'Gérer les avantages', description: 'Accorder ou retirer rôles, salons et exemptions.' },
  { key: 'partnerships.finance', label: 'Voir les montants', description: 'Accéder au volet financier et aux échéances.' },
  { key: 'partnerships.directory', label: "Gérer l'annuaire", description: "Publier la vitrine et répondre aux propositions reçues." },
  { key: 'partnerships.reputation', label: 'Signaler', description: 'Signaler un partenaire au réseau et consulter les signaux.' },
  { key: 'partnerships.configure', label: 'Configurer', description: 'Régler le module, les automatismes et les notifications.' },
];

// ─────────────────────────────── Préréglages ────────────────────────────────

/**
 * Les quelques partenariats que tout le monde monte, prêts à poser.
 *
 * Vingt-cinq types, trois niveaux, dix-huit avantages et treize engagements :
 * pour qui ouvre son premier dossier, c'est un formulaire à trente décisions
 * avant d'avoir parlé à qui que ce soit. Un préréglage répond à toutes ces
 * questions d'un coup, et reste modifiable ensuite - exactement ce que font les
 * rythmes de l'économie et les niveaux de protection.
 *
 * Ce ne sont pas des types de plus : chacun désigne un `type` existant et pose
 * ce qui va avec. Le formulaire détaillé reste accessible pour tout le reste.
 */
export interface PartnershipPreset {
  key: string;
  label: string;
  /** Ce que ça couvre, en une phrase, du point de vue de celui qui monte le dossier. */
  description: string;
  icon: string;
  type: PartnershipType;
  tier: PartnershipTier;
  /** Engagements posés d'office, avec leur partie et leur cadence. */
  commitments: {
    kind: PartnershipCommitmentKind;
    party: 'US' | 'PARTNER' | 'BOTH';
    targetCount?: number;
    targetPeriod?: 'day' | 'week' | 'month' | 'total';
  }[];
  /** Avantages accordés au partenaire dès l'activation. */
  benefits: PartnershipBenefitKind[];
  /** Crée l'invitation dédiée qui permet d'attribuer les arrivées. */
  trackInvite: boolean;
  /** Le cas le plus courant, mis en avant. */
  recommended?: boolean;
}

export const PARTNERSHIP_PRESETS: PartnershipPreset[] = [
  {
    key: 'cross-promo',
    label: 'Échange de publicités',
    description:
      "Chacun publie la publicité de l'autre et la laisse en place. Le module compte les arrivées et vérifie que la vôtre est toujours affichée chez eux.",
    icon: 'Megaphone',
    type: 'CROSS_PROMO',
    tier: 'PIPELINE',
    commitments: [
      { kind: 'PROMO_POST', party: 'US', targetCount: 1, targetPeriod: 'month' },
      { kind: 'KEEP_AD_VISIBLE', party: 'PARTNER' },
    ],
    benefits: ['PARTNER_ROLE', 'SHOWCASE'],
    trackInvite: true,
    recommended: true,
  },
  {
    key: 'ally',
    label: 'Allié permanent',
    description:
      "Un serveur ami, sans contrepartie à mesurer : un rôle, une place dans la vitrine, et on n'y revient plus.",
    icon: 'Handshake',
    type: 'ALLIANCE',
    tier: 'SIMPLE',
    commitments: [{ kind: 'KEEP_AD_VISIBLE', party: 'BOTH' }],
    benefits: ['PARTNER_ROLE', 'SHOWCASE', 'AUTOMOD_EXEMPTION'],
    trackInvite: true,
  },
  {
    key: 'sponsor',
    label: 'Sponsor',
    description:
      "Ils financent ou dotent, vous donnez de la visibilité. Accord signé des deux côtés, échéances suivies et rappels avant la date.",
    icon: 'BadgeDollarSign',
    type: 'SPONSOR_IN',
    tier: 'CONTRACT',
    commitments: [
      { kind: 'PAYMENT', party: 'PARTNER', targetCount: 1, targetPeriod: 'month' },
      { kind: 'KEEP_AD_VISIBLE', party: 'US' },
    ],
    benefits: ['SHOWCASE', 'PINNED_AD', 'ANNOUNCEMENT'],
    trackInvite: false,
  },
  {
    key: 'creator',
    label: 'Créateur de contenu',
    description:
      "Un streamer ou un vidéaste parle de vous à son audience. On mesure ce que ça amène réellement, pas seulement les promesses.",
    icon: 'Video',
    type: 'CREATOR',
    tier: 'PIPELINE',
    commitments: [
      { kind: 'CONTENT_MENTION', party: 'PARTNER', targetCount: 1, targetPeriod: 'month' },
      { kind: 'MEMBERS_BROUGHT', party: 'PARTNER', targetCount: 10, targetPeriod: 'month' },
    ],
    benefits: ['PARTNER_ROLE', 'SHOWCASE', 'AUTOMOD_EXEMPTION'],
    trackInvite: true,
  },
  {
    key: 'event',
    label: 'Événement commun',
    description:
      "Une opération à deux, avec une date de fin connue d'avance : chacun annonce, chacun tient sa part, le dossier se termine tout seul.",
    icon: 'CalendarDays',
    type: 'EVENT',
    tier: 'PIPELINE',
    commitments: [
      { kind: 'EVENT_PARTICIPATION', party: 'BOTH' },
      { kind: 'PROMO_POST', party: 'BOTH', targetCount: 1, targetPeriod: 'total' },
    ],
    benefits: ['PARTNER_ROLE', 'DEDICATED_CHANNEL'],
    trackInvite: true,
  },
  {
    key: 'network',
    label: 'Réseau de serveurs',
    description:
      "Plusieurs communautés liées par les mêmes règles : salon commun, entraide de modération, représentants joignables.",
    icon: 'Network',
    type: 'NETWORK',
    tier: 'CONTRACT',
    commitments: [
      { kind: 'KEEP_AD_VISIBLE', party: 'BOTH' },
      { kind: 'REPRESENTATIVE_PRESENT', party: 'BOTH' },
      { kind: 'MODERATION_HELP', party: 'BOTH' },
    ],
    benefits: ['PARTNER_ROLE', 'DEDICATED_CHANNEL', 'SHOWCASE', 'AUTOMOD_EXEMPTION', 'INVITE_ALLOWED'],
    trackInvite: true,
  },
];

const PRESET_BY_KEY = new Map(PARTNERSHIP_PRESETS.map((preset) => [preset.key, preset]));

export function getPartnershipPreset(key: string): PartnershipPreset | undefined {
  return PRESET_BY_KEY.get(key);
}

// ─────────────────────────────── Accès rapide ───────────────────────────────

const TYPE_BY_KEY = new Map<string, PartnershipTypeMeta>(PARTNERSHIP_TYPE_META.map((t) => [t.key, t]));
const TIER_BY_KEY = new Map<string, PartnershipTierMeta>(PARTNERSHIP_TIER_META.map((t) => [t.key, t]));
const STAGE_BY_KEY = new Map<string, PartnershipStageMeta>(PARTNERSHIP_STAGE_META.map((s) => [s.key, s]));
const BENEFIT_BY_KEY = new Map<string, PartnershipBenefitMeta>(PARTNERSHIP_BENEFIT_META.map((b) => [b.key, b]));
const COMMITMENT_BY_KEY = new Map<string, PartnershipCommitmentMeta>(
  PARTNERSHIP_COMMITMENT_META.map((c) => [c.key, c]),
);

export function getPartnershipType(key: string): PartnershipTypeMeta | undefined {
  return TYPE_BY_KEY.get(key);
}

export function getPartnershipTier(key: string): PartnershipTierMeta | undefined {
  return TIER_BY_KEY.get(key);
}

export function getPartnershipStage(key: string): PartnershipStageMeta | undefined {
  return STAGE_BY_KEY.get(key);
}

export function getPartnershipBenefit(key: string): PartnershipBenefitMeta | undefined {
  return BENEFIT_BY_KEY.get(key);
}

export function getPartnershipCommitment(key: string): PartnershipCommitmentMeta | undefined {
  return COMMITMENT_BY_KEY.get(key);
}

export function isPartnershipType(value: unknown): value is PartnershipType {
  return typeof value === 'string' && TYPE_BY_KEY.has(value);
}

export function isPartnershipStage(value: unknown): value is PartnershipStage {
  return typeof value === 'string' && STAGE_BY_KEY.has(value);
}

export function isPartnershipTier(value: unknown): value is PartnershipTier {
  return typeof value === 'string' && TIER_BY_KEY.has(value);
}

export function isPartnershipBenefitKind(value: unknown): value is PartnershipBenefitKind {
  return typeof value === 'string' && BENEFIT_BY_KEY.has(value);
}

export function isPartnershipCommitmentKind(value: unknown): value is PartnershipCommitmentKind {
  return typeof value === 'string' && COMMITMENT_BY_KEY.has(value);
}

/** Un partenariat vivant : avantages appliqués, engagements suivis, relances actives. */
export function isLivePartnershipStage(stage: string): boolean {
  return STAGE_BY_KEY.get(stage)?.live ?? false;
}

/** Fin de parcours : plus aucun automatisme ne doit se déclencher. */
export function isTerminalPartnershipStage(stage: string): boolean {
  return STAGE_BY_KEY.get(stage)?.terminal ?? false;
}

/**
 * Étapes atteignables depuis une étape donnée, pour le niveau demandé.
 *
 * Le mouvement libre est interdit : sans cette table, un clic pouvait faire
 * passer un dossier refusé en actif sans repasser par la validation, et les
 * avantages étaient appliqués sans que personne n'ait rien décidé. Rouvrir un
 * dossier terminé est possible, mais seulement vers le début du parcours.
 */
export function nextPartnershipStages(stage: string, tier: PartnershipTier): PartnershipStage[] {
  const allowed = new Set(getPartnershipTier(tier)?.stages ?? PARTNERSHIP_STAGES);
  const graph: Record<PartnershipStage, PartnershipStage[]> = {
    LEAD: ['CONTACTED', 'NEGOTIATING', 'ACTIVE', 'REJECTED', 'ARCHIVED'],
    CONTACTED: ['NEGOTIATING', 'PENDING_APPROVAL', 'REJECTED', 'ARCHIVED'],
    NEGOTIATING: ['PENDING_APPROVAL', 'AWAITING_PARTNER', 'ACTIVE', 'REJECTED', 'ARCHIVED'],
    PENDING_APPROVAL: ['AWAITING_PARTNER', 'ACTIVE', 'NEGOTIATING', 'REJECTED'],
    AWAITING_PARTNER: ['ACTIVE', 'NEGOTIATING', 'REJECTED', 'ARCHIVED'],
    ACTIVE: ['PAUSED', 'RENEWAL', 'ENDED', 'BREACHED'],
    PAUSED: ['ACTIVE', 'ENDED', 'BREACHED'],
    RENEWAL: ['ACTIVE', 'NEGOTIATING', 'ENDED', 'BREACHED'],
    ENDED: ['LEAD', 'ARCHIVED'],
    BREACHED: ['LEAD', 'ARCHIVED'],
    REJECTED: ['LEAD', 'ARCHIVED'],
    ARCHIVED: ['LEAD'],
  };
  return (graph[stage as PartnershipStage] ?? []).filter((s) => allowed.has(s));
}

/** Types proposés pour une nature de partenaire donnée. */
export function partnershipTypesForKind(kind: PartnerKind): PartnershipTypeMeta[] {
  return PARTNERSHIP_TYPE_META.filter((t) => t.kinds.includes(kind));
}
