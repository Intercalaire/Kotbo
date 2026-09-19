/**
 * Campagne : l'histoire du module, en chapitres et en étapes.
 *
 * Le RPG n'avait aucune direction — on farmait des monstres jusqu'au niveau maximum, sans
 * que rien ne dise pourquoi. La campagne donne un fil : chaque étape est un objectif que le
 * jeu sait déjà compter, habillé d'un morceau de récit, et récompensé.
 *
 * DEUX RÈGLES qui tiennent le tout :
 *  1. Une étape ne demande QUE des choses que le jeu compte déjà. Inventer un compteur pour
 *     une étape la rendrait invérifiable et silencieusement cassée.
 *  2. La progression est LINÉAIRE. Une étape à la fois, dans l'ordre. C'est ce qui permet de
 *     raconter quelque chose, et ce qui rend l'écran lisible d'un coup d'œil.
 *
 * Cohérence vérifiée par `rpgCampaign.test.ts` :
 *  - identifiants de chapitres uniques, chaque chapitre a au moins une étape ;
 *  - les niveaux requis des chapitres sont croissants ;
 *  - toute cible est strictement positive, toute étape récompense quelque chose.
 */

import type { RpgQuestObjective } from './rpgQuestPolicy.js';

/**
 * Ce qu'une étape peut demander.
 *
 * `REACH_LEVEL` est le seul objectif qui ne se compte pas en événements : il se lit
 * directement sur le profil. Tous les autres sont des compteurs alimentés par le même
 * entonnoir que les quêtes.
 */
export type CampaignObjective = RpgQuestObjective | 'REACH_LEVEL';

export type CampaignReward = {
  coins: number;
  xp: number;
  /** Objet remis, désigné par son nom dans `RPG_ITEMS`. */
  itemName?: string;
};

export type CampaignStep = {
  id: string;
  /** Titre de l'étape, affiché comme une consigne. */
  title: string;
  /** Une ou deux phrases de récit. C'est ce qui fait la différence avec une quête. */
  narration: string;
  objective: CampaignObjective;
  /** Nombre à atteindre. Pour `REACH_LEVEL`, c'est le niveau visé. */
  target: number;
  reward: CampaignReward;
};

export type CampaignChapter = {
  id: string;
  title: string;
  emoji: string;
  /** Mise en place du chapitre, lue une fois en l'ouvrant. */
  intro: string;
  /** Niveau de personnage conseillé. Le chapitre reste jouable en dessous. */
  levelHint: number;
  steps: CampaignStep[];
  /** Récompense de fin de chapitre, en plus de celles des étapes. */
  reward: CampaignReward;
};

export const RPG_CAMPAIGN: CampaignChapter[] = [
  {
    id: 'ch1_reveil',
    title: 'Le réveil des plaines',
    emoji: '🌄',
    levelHint: 1,
    intro:
      "Les troupeaux ne reviennent plus des pâtures hautes. Le bailli du village vous tend une "
      + "épée émoussée et un conseil : « Commencez petit. »",
    steps: [
      {
        id: 'ch1_s1',
        title: 'Faire ses armes',
        narration: "Trois créatures, pas plus. Le temps de comprendre de quel côté se tient une lame.",
        objective: 'MONSTER_KILLS',
        target: 3,
        reward: { coins: 80, xp: 40 },
      },
      {
        id: 'ch1_s2',
        title: 'De quoi tenir',
        narration: "Le bailli hausse les épaules : « On ne part pas au nord le ventre vide et les mains nues. »",
        objective: 'SHOP_PURCHASES',
        target: 2,
        reward: { coins: 60, xp: 30 },
      },
      {
        id: 'ch1_s3',
        title: 'Nettoyer les pâtures',
        narration: "Dix bêtes abattues, et les troupeaux redescendent enfin. Le village respire.",
        objective: 'MONSTER_KILLS',
        target: 10,
        reward: { coins: 150, xp: 90, itemName: 'Potion de Vie' },
      },
    ],
    reward: { coins: 300, xp: 150, itemName: 'Veste de cuir' },
  },
  {
    id: 'ch2_foret',
    title: 'Ce qui dort sous la forêt',
    emoji: '🌲',
    levelHint: 5,
    intro:
      "Les bêtes venaient d'ailleurs. Les traces remontent vers la vieille forêt, celle que les "
      + "cartes du bailli laissent vierge.",
    steps: [
      {
        id: 'ch2_s1',
        title: 'Choisir sa voie',
        narration: "Avant d'y entrer, il faut savoir qui l'on est. Guerrier, rôdeur, mage : la forêt ne pardonne pas l'hésitation.",
        objective: 'REACH_LEVEL',
        target: 5,
        reward: { coins: 200, xp: 100 },
      },
      {
        id: 'ch2_s2',
        title: 'Récolter ce qui traîne',
        narration: "Les dépouilles de la forêt valent mieux que leur odeur. Un artisan saura quoi en tirer.",
        objective: 'ITEMS_LOOTED',
        target: 8,
        reward: { coins: 180, xp: 120 },
      },
      {
        id: 'ch2_s3',
        title: "Le premier ouvrage",
        narration: "Vous posez sur l'établi de quoi faire une arme. Le forgeron vous laisse frapper vous-même.",
        objective: 'ITEMS_CRAFTED',
        target: 1,
        reward: { coins: 220, xp: 140 },
      },
      {
        id: 'ch2_s4',
        title: 'Aller au bout du sentier',
        narration: "Vingt-cinq créatures plus loin, le sentier s'ouvre sur une clairière brûlée. Quelque chose est passé par là.",
        objective: 'MONSTER_KILLS',
        target: 25,
        reward: { coins: 300, xp: 200, itemName: 'Potion de Vie Majeure' },
      },
    ],
    reward: { coins: 700, xp: 400, itemName: 'Anneau de fer' },
  },
  {
    id: 'ch3_clairiere',
    title: 'La chose de la clairière',
    emoji: '🔥',
    levelHint: 10,
    intro:
      "La clairière n'a pas brûlé par accident. Ce qui l'a fait est encore dans les parages, et "
      + "il faudra plus qu'une lame bien aiguisée.",
    steps: [
      {
        id: 'ch3_s1',
        title: 'Une arme digne de ce nom',
        narration: "Le forgeron regarde votre équipement, soupire, et vous montre l'enclume.",
        objective: 'UPGRADES_SUCCEEDED',
        target: 2,
        reward: { coins: 350, xp: 200 },
      },
      {
        id: 'ch3_s2',
        title: 'Affronter ce qui la garde',
        narration: "On n'arrive pas à la chose sans passer par ce qu'elle a laissé derrière elle.",
        objective: 'BOSS_KILLS',
        target: 1,
        reward: { coins: 600, xp: 400 },
      },
      {
        id: 'ch3_s3',
        title: 'Tenir la clairière',
        narration: "Cinquante bêtes repoussées, et la clairière tient. Pour l'instant.",
        objective: 'MONSTER_KILLS',
        target: 50,
        reward: { coins: 500, xp: 350 },
      },
    ],
    reward: { coins: 1_500, xp: 800, itemName: "Harnois d'acier" },
  },
  {
    id: 'ch4_compagnie',
    title: 'On ne tient pas seul',
    emoji: '🛡️',
    levelHint: 15,
    intro:
      "Ce qui vient du nord ne se combat pas à un. Le bailli vous envoie lever une compagnie, "
      + "et vous laisse entendre que d'autres l'ont déjà fait.",
    steps: [
      {
        id: 'ch4_s1',
        title: 'Faire ses preuves',
        narration: "Personne ne suit un inconnu. Trois seigneurs de guerre abattus, et on vous écoutera.",
        objective: 'BOSS_KILLS',
        target: 3,
        reward: { coins: 800, xp: 500 },
      },
      {
        id: 'ch4_s2',
        title: 'Financer la campagne',
        narration: "Une compagnie coûte. Armes, vivres, solde : rien de tout cela ne se trouve gratuitement.",
        objective: 'COINS_SPENT',
        target: 5_000,
        reward: { coins: 900, xp: 500 },
      },
      {
        id: 'ch4_s3',
        title: 'Un équipement de campagne',
        narration: "Cinq pièces forgées et reforgées. On ne monte pas au nord avec du matériel de village.",
        objective: 'UPGRADES_SUCCEEDED',
        target: 5,
        reward: { coins: 1_000, xp: 600, itemName: "Grande Potion d'Énergie" },
      },
    ],
    reward: { coins: 2_500, xp: 1_200, itemName: "Cape d'ombre" },
  },
  {
    id: 'ch5_nord',
    title: 'Ce qui vient du nord',
    emoji: '❄️',
    levelHint: 22,
    intro:
      "La route du nord est ouverte. Au bout, ce qui a vidé les pâtures, brûlé la clairière et "
      + "poussé toute une contrée vers le sud. Il est temps de savoir ce que c'est.",
    steps: [
      {
        id: 'ch5_s1',
        title: 'Atteindre le seuil',
        narration: "Le froid mord. Seul un personnage aguerri passera le col.",
        objective: 'REACH_LEVEL',
        target: 25,
        reward: { coins: 1_500, xp: 900 },
      },
      {
        id: 'ch5_s2',
        title: 'Briser les avant-gardes',
        narration: "Cinq de ses lieutenants tiennent le col. Aucun ne cédera de lui-même.",
        objective: 'BOSS_KILLS',
        target: 5,
        reward: { coins: 2_000, xp: 1_200 },
      },
      {
        id: 'ch5_s3',
        title: 'La longue marche',
        narration: "Cent créatures depuis les pâtures. Le bailli, lui, ne comptait plus depuis longtemps.",
        objective: 'MONSTER_KILLS',
        target: 100,
        reward: { coins: 2_500, xp: 1_500, itemName: 'Élixir Divin' },
      },
    ],
    reward: { coins: 6_000, xp: 3_000, itemName: 'Sceau du Dragon' },
  },
];

const CHAPTER_BY_ID = new Map(RPG_CAMPAIGN.map((chapter) => [chapter.id, chapter]));

export const FIRST_CHAPTER_ID = RPG_CAMPAIGN[0].id;

export function getChapter(chapterId: string): CampaignChapter | null {
  return CHAPTER_BY_ID.get(chapterId) ?? null;
}

export function chapterIndex(chapterId: string): number {
  return RPG_CAMPAIGN.findIndex((chapter) => chapter.id === chapterId);
}

/** Chapitre suivant, `null` quand la campagne se termine ici. */
export function nextChapter(chapterId: string): CampaignChapter | null {
  const index = chapterIndex(chapterId);
  return index >= 0 ? RPG_CAMPAIGN[index + 1] ?? null : null;
}

/** Étape en cours, `null` quand le chapitre est terminé ou inconnu. */
export function getStep(chapterId: string, stepIndex: number): CampaignStep | null {
  return getChapter(chapterId)?.steps[stepIndex] ?? null;
}

/** Nombre total d'étapes de la campagne, pour afficher une progression globale. */
export function totalSteps(): number {
  return RPG_CAMPAIGN.reduce((total, chapter) => total + chapter.steps.length, 0);
}

/**
 * Étapes déjà bouclées, d'après les chapitres terminés et la position courante.
 *
 * Un chapitre terminé absent du catalogue est ignoré : il a été retiré d'une version à
 * l'autre, et le compter fausserait une progression qu'on ne peut plus expliquer.
 */
export function completedStepCount(completedChapters: string[], chapterId: string, stepIndex: number): number {
  const fromChapters = completedChapters.reduce(
    (total, id) => total + (CHAPTER_BY_ID.get(id)?.steps.length ?? 0),
    0,
  );

  return fromChapters + (CHAPTER_BY_ID.has(chapterId) ? stepIndex : 0);
}

/**
 * L'objectif se compte-t-il sur des événements, ou se lit-il sur le profil ?
 *
 * `REACH_LEVEL` est le seul du second genre : l'incrémenter à chaque niveau gagné
 * désynchroniserait le compteur du niveau réel dès le premier gain manqué.
 */
export function isCounterObjective(objective: CampaignObjective): objective is RpgQuestObjective {
  return objective !== 'REACH_LEVEL';
}
