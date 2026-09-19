import { describe, expect, test } from 'bun:test';
import {
  FIRST_CHAPTER_ID,
  RPG_CAMPAIGN,
  chapterIndex,
  completedStepCount,
  getChapter,
  getStep,
  isCounterObjective,
  nextChapter,
  totalSteps,
} from '../../services/features/rpg/rpgCampaign.js';
import { RPG_ITEMS } from '../../services/features/rpg/rpgContent.js';
import { RPG_QUEST_OBJECTIVES } from '../../services/features/rpg/rpgQuestPolicy.js';

const itemNames = new Set(RPG_ITEMS.map((item) => item.name));
const allSteps = RPG_CAMPAIGN.flatMap((chapter) => chapter.steps);

describe('catalogue de campagne', () => {
  test('les identifiants de chapitres sont uniques', () => {
    // `chapterId` est la clé stockée en base : un doublon ferait reprendre la progression
    // sur le mauvais chapitre.
    const duplicates = RPG_CAMPAIGN
      .map((chapter) => chapter.id)
      .filter((id, index, all) => all.indexOf(id) !== index);

    expect(duplicates).toEqual([]);
  });

  test('les identifiants d étapes sont uniques dans toute la campagne', () => {
    const duplicates = allSteps
      .map((step) => step.id)
      .filter((id, index, all) => all.indexOf(id) !== index);

    expect(duplicates).toEqual([]);
  });

  test('chaque chapitre a au moins une étape', () => {
    // Un chapitre vide serait franchi instantanément, sans que rien ne s'affiche.
    for (const chapter of RPG_CAMPAIGN) {
      expect(chapter.steps.length).toBeGreaterThan(0);
    }
  });

  test('les niveaux conseillés croissent de chapitre en chapitre', () => {
    for (let i = 1; i < RPG_CAMPAIGN.length; i++) {
      expect(RPG_CAMPAIGN[i].levelHint).toBeGreaterThanOrEqual(RPG_CAMPAIGN[i - 1].levelHint);
    }
  });

  test('toute cible est strictement positive', () => {
    // Une cible à zéro serait déjà atteinte : l'étape se validerait sans rien demander.
    for (const step of allSteps) {
      expect(step.target).toBeGreaterThan(0);
    }
  });

  test('chaque objectif est un compteur que le jeu sait déjà tenir', () => {
    // Inventer un compteur pour une étape la rendrait invérifiable et silencieusement
    // cassée : rien ne la ferait jamais avancer.
    const known = new Set<string>([...RPG_QUEST_OBJECTIVES, 'REACH_LEVEL']);
    const unknown = allSteps.filter((step) => !known.has(step.objective));

    expect(unknown.map((step) => `${step.id}: ${step.objective}`)).toEqual([]);
  });

  test('toute étape et tout chapitre récompensent quelque chose', () => {
    for (const step of allSteps) {
      expect(step.reward.coins + step.reward.xp).toBeGreaterThan(0);
    }
    for (const chapter of RPG_CAMPAIGN) {
      expect(chapter.reward.coins + chapter.reward.xp).toBeGreaterThan(0);
    }
  });

  test('tout objet offert existe dans le catalogue', () => {
    // La récompense est résolue par NOM : un nom qui n'existe pas se perdrait en silence.
    const rewards = [
      ...allSteps.map((step) => step.reward.itemName),
      ...RPG_CAMPAIGN.map((chapter) => chapter.reward.itemName),
    ].filter((name): name is string => Boolean(name));

    expect(rewards.filter((name) => !itemNames.has(name))).toEqual([]);
  });

  test('les étapes REACH_LEVEL ne redescendent jamais', () => {
    // Demander le niveau 25 puis le niveau 20 validerait la seconde étape d'office.
    const levels = allSteps
      .filter((step) => step.objective === 'REACH_LEVEL')
      .map((step) => step.target);

    expect(levels).toEqual([...levels].sort((a, b) => a - b));
  });
});

describe('navigation dans la campagne', () => {
  test('le premier chapitre est bien le premier du catalogue', () => {
    expect(FIRST_CHAPTER_ID).toBe(RPG_CAMPAIGN[0].id);
    expect(chapterIndex(FIRST_CHAPTER_ID)).toBe(0);
  });

  test('chaque chapitre mène au suivant, sauf le dernier', () => {
    for (let i = 0; i < RPG_CAMPAIGN.length - 1; i++) {
      expect(nextChapter(RPG_CAMPAIGN[i].id)?.id).toBe(RPG_CAMPAIGN[i + 1].id);
    }
    expect(nextChapter(RPG_CAMPAIGN[RPG_CAMPAIGN.length - 1].id)).toBeNull();
  });

  test('un chapitre absent du catalogue ne mène nulle part', () => {
    expect(getChapter('chapitre_supprime')).toBeNull();
    expect(nextChapter('chapitre_supprime')).toBeNull();
    expect(chapterIndex('chapitre_supprime')).toBe(-1);
  });

  test('une étape hors bornes est nulle, pas une erreur', () => {
    expect(getStep(FIRST_CHAPTER_ID, 999)).toBeNull();
    expect(getStep('chapitre_supprime', 0)).toBeNull();
  });

  test('le total d étapes est la somme des chapitres', () => {
    expect(totalSteps()).toBe(allSteps.length);
  });
});

describe('completedStepCount', () => {
  test('additionne les chapitres terminés et la position courante', () => {
    const first = RPG_CAMPAIGN[0];
    const second = RPG_CAMPAIGN[1];

    expect(completedStepCount([first.id], second.id, 2)).toBe(first.steps.length + 2);
  });

  test('ignore un chapitre terminé qui n existe plus', () => {
    // Le compter fausserait une progression qu'on ne peut plus expliquer.
    expect(completedStepCount(['chapitre_supprime'], FIRST_CHAPTER_ID, 1)).toBe(1);
  });

  test('un chapitre courant inconnu ne compte aucune étape', () => {
    expect(completedStepCount([], 'chapitre_supprime', 3)).toBe(0);
  });
});

describe('isCounterObjective', () => {
  test('REACH_LEVEL se lit sur le profil, pas dans un compteur', () => {
    expect(isCounterObjective('REACH_LEVEL')).toBe(false);
  });

  test('les autres objectifs se comptent sur des événements', () => {
    expect(isCounterObjective('MONSTER_KILLS')).toBe(true);
    expect(isCounterObjective('BOSS_KILLS')).toBe(true);
  });
});
