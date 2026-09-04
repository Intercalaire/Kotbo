/**
 * La formation du premier utilisateur, par categorie.
 *
 * Le parcours de mise en place dit ce qui est regle. Il ne dit pas comment on
 * s'en sert, et ce n'est pas la meme question : quelqu'un peut avoir designe un
 * salon de logs sans avoir jamais ouvert le journal, avoir un role moderateur
 * sans savoir ou l'on pose une sanction. Un serveur entierement configure par
 * une personne qui n'a rien manipule reste un serveur que personne ne sait
 * conduire.
 *
 * D'ou ces pistes. Une par categorie du parcours - les memes quatre, pas un
 * decoupage de plus - et chacune tient en deux temps : les reglages, qui se
 * lisent de la configuration reelle, et les gestes, qu'on fait une fois pour
 * comprendre ou ca se passe.
 *
 * Les gestes ne se detectent pas, ils se declarent. Deviner « il a bien
 * regarde ses logs » demanderait d'instrumenter chaque page pour un signal qui
 * resterait faux la moitie du temps ; et quelqu'un qui coche sans faire ne
 * trompe que lui-meme. Une case honnete vaut mieux qu'une mesure fausse.
 */
import type { SetupGroup } from './stores/setupJourney.svelte';

export type FormationGesture = {
  /** Stable : c'est la clef qui memorise le geste fait. */
  id: string;
  label: string;
  /** Ce que le geste apprend. Sans cela, ce n'est qu'une corvee de plus. */
  learns: string;
  /** Page ou le geste se fait, quand il se fait dans le dashboard. */
  href?: string;
};

export type FormationTrack = {
  group: SetupGroup;
  title: string;
  icon: string;
  /** Ce que la categorie change pour le serveur, en une phrase. */
  promise: string;
  /** Le contexte qu'il faut avoir en tete avant de manipuler. */
  intro: string;
  gestures: FormationGesture[];
};

export const formationTracks: FormationTrack[] = [
  {
    group: 'fondations',
    title: 'Fondations',
    icon: 'star',
    promise: 'Savoir ce que fait le bot, et qui a le droit de lui faire faire.',
    intro:
      "Kotbo écrit tout ce qu'il fait, et tout ce qui se passe sur le serveur, à deux "
      + "endroits : le salon de logs sur Discord, pour le staff qui est déjà là, et le "
      + "journal du dashboard, qui se cherche et se filtre. Les rôles, eux, décident de "
      + "ce que chacun peut faire — le rôle modérateur ouvre les sanctions et les tickets, "
      + "le rôle du staff ouvre les réunions, absences et évaluations.",
    gestures: [
      {
        id: 'fondations-provoke-log',
        label: "Renommer un salon sur Discord, puis retrouver la ligne dans le salon de logs",
        learns: "Vérifier que le bot voit bien le serveur, et à quoi ressemble ce qu'il écrit.",
      },
      {
        id: 'fondations-journal',
        label: 'Retrouver la même ligne dans le journal du dashboard',
        learns: "Le journal se filtre et se cherche, là où le salon Discord se remonte à la main.",
        href: '/logs',
      },
      {
        id: 'fondations-modules',
        label: 'Ouvrir le catalogue des modules et voir ce qui est allumé',
        learns: "Chaque module s'éteint séparément : une page vide vient presque toujours de là.",
        href: '/modules',
      },
    ],
  },
  {
    group: 'moderation',
    title: 'Modération',
    icon: 'shield',
    promise: 'Sanctionner sans se justifier après coup.',
    intro:
      "Une sanction Kotbo n'est pas un bannissement lancé à la main : elle laisse un "
      + "casier, une raison, un auteur et une date. C'est ce qui la rend défendable quand "
      + "le membre revient contester — et c'est aussi ce qui permet de la lever proprement. "
      + "Le règlement publié sert de référence commune ; les filtres, eux, travaillent "
      + "avant vous.",
    gestures: [
      {
        id: 'moderation-test-sanction',
        label: "Poser un avertissement d'essai sur son propre compte, puis le révoquer",
        learns: "Voir le casier se remplir, l'alerte partir, et comment on revient en arrière.",
        href: '/security/sanctions',
      },
      {
        id: 'moderation-protection-level',
        label: 'Ouvrir le niveau de protection et lire ce qu\'il règle',
        learns: "Un niveau déplace d'un coup les filtres AutoMod et les seuils anti-raid.",
        href: '/security/quick-setup',
      },
      {
        id: 'moderation-regulation',
        label: 'Relire le règlement publié depuis le dashboard',
        learns: "Il se modifie ici et se republie sur Discord : le salon n'est qu'un affichage.",
        href: '/regulation',
      },
    ],
  },
  {
    group: 'accueil',
    title: 'Accueil des arrivants',
    icon: 'user-check',
    promise: "Qu'un arrivant trouve quoi faire dans sa première heure.",
    intro:
      "Un arrivant qui tombe sur un serveur muet repart. L'accueil de Kotbo tient en trois "
      + "gestes automatiques : un message qui le nomme, un rôle qui lui ouvre les salons "
      + "sans attendre qu'un humain passe, et — si vous l'activez — un fil privé où il pose "
      + "ses questions sans encombrer le général. Les invitations, elles, disent d'où il vient.",
    gestures: [
      {
        id: 'accueil-read-message',
        label: "Lire le message de bienvenue tel qu'il sera envoyé",
        learns: "Les variables comme {user} se remplacent à l'envoi : on voit le résultat, pas le gabarit.",
        href: '/welcome',
      },
      {
        id: 'accueil-join-role',
        label: "Vérifier ce que le rôle donné à l'arrivée ouvre réellement",
        learns: "Un auto-rôle sans permission n'ouvre rien : c'est le rôle qui porte l'accès.",
        href: '/welcome/autoroles',
      },
      {
        id: 'accueil-invites',
        label: 'Créer une invitation et regarder ce que la page en dit',
        learns: "Kotbo attribue chaque arrivée à son invitation : on sait qui recrute.",
        href: '/invitations',
      },
    ],
  },
  {
    group: 'engagement',
    title: 'Vie du serveur',
    icon: 'users',
    promise: 'Donner aux membres une raison de revenir, et un endroit où demander.',
    intro:
      "Les tickets remplacent les messages privés au staff : une demande y a un fil, un "
      + "responsable et un transcript qu'on relit six mois plus tard. Les niveaux donnent "
      + "une échelle lisible pour distribuer les rôles sans arbitrer à la tête du client. "
      + "Les suggestions ramènent au même endroit ce qui se perdait dans le général.",
    gestures: [
      {
        id: 'engagement-open-ticket',
        label: "Ouvrir un ticket d'essai depuis le panneau, puis le fermer",
        learns: "Voir le parcours complet côté membre, et retrouver le transcript après coup.",
        href: '/tickets',
      },
      {
        id: 'engagement-leaderboard',
        label: 'Écrire quelques messages, puis ouvrir le classement',
        learns: "L'XP monte sur un délai de garde : écrire dix fois d'affilée ne compte pas dix fois.",
        href: '/leveling',
      },
      {
        id: 'engagement-suggestion',
        label: 'Poster une suggestion et la traiter depuis le dashboard',
        learns: "La réponse du staff revient au membre : la boîte n'est pas un trou noir.",
        href: '/suggestions',
      },
    ],
  },
];

export const totalGestures = formationTracks.reduce(
  (sum, track) => sum + track.gestures.length,
  0,
);
