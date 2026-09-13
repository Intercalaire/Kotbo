import { describe, expect, test } from 'bun:test';
import {
  PARTNERSHIP_BENEFIT_META,
  PARTNERSHIP_COMMITMENT_META,
  PARTNERSHIP_STAGES,
  PARTNERSHIP_STAGE_META,
  PARTNERSHIP_TIERS,
  PARTNERSHIP_TIER_META,
  PARTNERSHIP_TYPES,
  PARTNERSHIP_TYPE_META,
  getPartnershipTier,
  isLivePartnershipStage,
  isPartnershipType,
  isTerminalPartnershipStage,
  nextPartnershipStages,
  partnershipTypesForKind,
} from '@kotbo/contracts';

/**
 * Le registre du module est la source de vérité de cinq couches : le schéma,
 * l'API, les commandes, le dashboard et les workflows. Une incohérence ici ne
 * se voit nulle part ailleurs avant la production - d'où ces tests, qui
 * vérifient surtout que le registre se tient lui-même.
 */
describe('registre des partenariats', () => {
  test('chaque type déclaré a ses métadonnées, et réciproquement', () => {
    expect(PARTNERSHIP_TYPE_META.map((type) => type.key).sort()).toEqual([...PARTNERSHIP_TYPES].sort());
  });

  test('chaque étape déclarée a ses métadonnées', () => {
    expect(PARTNERSHIP_STAGE_META.map((stage) => stage.key).sort()).toEqual([...PARTNERSHIP_STAGES].sort());
  });

  test('chaque niveau déclaré a ses métadonnées', () => {
    expect(PARTNERSHIP_TIER_META.map((tier) => tier.key).sort()).toEqual([...PARTNERSHIP_TIERS].sort());
  });

  test("l'ordre des étapes est unique : deux colonnes ne peuvent pas se superposer", () => {
    const orders = PARTNERSHIP_STAGE_META.map((stage) => stage.order);
    expect(new Set(orders).size).toBe(orders.length);
  });

  test('les engagements suggérés par un type existent tous', () => {
    const known = new Set(PARTNERSHIP_COMMITMENT_META.map((commitment) => commitment.key));
    for (const type of PARTNERSHIP_TYPE_META) {
      for (const suggested of type.suggestedCommitments) {
        expect(known.has(suggested)).toBe(true);
      }
    }
  });

  test('chaque type accepte au moins une nature de partenaire', () => {
    for (const type of PARTNERSHIP_TYPE_META) {
      expect(type.kinds.length).toBeGreaterThan(0);
    }
  });

  test('un avantage qui demande une cible le déclare', () => {
    const roleBenefit = PARTNERSHIP_BENEFIT_META.find((benefit) => benefit.key === 'PARTNER_ROLE');
    expect(roleBenefit?.needsTarget).toBe(true);
  });

  test('seuls ACTIVE et RENEWAL sont des étapes vivantes', () => {
    const live = PARTNERSHIP_STAGE_META.filter((stage) => stage.live).map((stage) => stage.key);
    expect(live.sort()).toEqual(['ACTIVE', 'RENEWAL']);
  });

  test('une étape ne peut pas être vivante et terminale à la fois', () => {
    for (const stage of PARTNERSHIP_STAGE_META) {
      expect(stage.live && stage.terminal).toBe(false);
    }
  });

  test('partnershipTypesForKind ne renvoie que des types compatibles', () => {
    for (const type of partnershipTypesForKind('PERSON')) {
      expect(type.kinds).toContain('PERSON');
    }
  });

  test('isPartnershipType refuse ce qui ne vient pas du registre', () => {
    expect(isPartnershipType('CROSS_PROMO')).toBe(true);
    expect(isPartnershipType('cross_promo')).toBe(false);
    expect(isPartnershipType('N_IMPORTE_QUOI')).toBe(false);
    expect(isPartnershipType(null)).toBe(false);
  });
});

/**
 * Le graphe de transitions est la seule garde qui empêche d'activer un dossier
 * refusé sans repasser par la décision. Les tests ci-dessous fixent ce que le
 * module promet : on ne remonte pas d'une fin de parcours vers l'actif.
 */
describe('transitions autorisées', () => {
  test("un dossier refusé ne repart pas directement en actif", () => {
    expect(nextPartnershipStages('REJECTED', 'PIPELINE')).not.toContain('ACTIVE');
  });

  test('un dossier rompu ne repart que par le début du parcours', () => {
    expect(nextPartnershipStages('BREACHED', 'PIPELINE')).toEqual(['LEAD', 'ARCHIVED']);
  });

  test('un dossier actif peut être mis en pause, renouvelé, terminé ou rompu', () => {
    expect(nextPartnershipStages('ACTIVE', 'PIPELINE').sort()).toEqual(
      ['BREACHED', 'ENDED', 'PAUSED', 'RENEWAL'].sort(),
    );
  });

  test('le niveau simple saute la négociation et la validation', () => {
    const fromLead = nextPartnershipStages('LEAD', 'SIMPLE');
    expect(fromLead).toContain('ACTIVE');
    expect(fromLead).not.toContain('CONTACTED');
    expect(fromLead).not.toContain('NEGOTIATING');
  });

  test("le niveau contractuel passe par l'attente du partenaire", () => {
    expect(getPartnershipTier('CONTRACT')?.stages).toContain('AWAITING_PARTNER');
    expect(getPartnershipTier('PIPELINE')?.stages).not.toContain('AWAITING_PARTNER');
  });

  test('une étape inconnue ne mène nulle part plutôt que partout', () => {
    expect(nextPartnershipStages('PAS_UNE_ETAPE', 'PIPELINE')).toEqual([]);
  });

  test('toutes les destinations proposées sont des étapes connues', () => {
    const known = new Set<string>(PARTNERSHIP_STAGES);
    for (const stage of PARTNERSHIP_STAGES) {
      for (const tier of PARTNERSHIP_TIERS) {
        for (const target of nextPartnershipStages(stage, tier)) {
          expect(known.has(target)).toBe(true);
        }
      }
    }
  });

  test("une destination n'est jamais l'étape de départ", () => {
    for (const stage of PARTNERSHIP_STAGES) {
      expect(nextPartnershipStages(stage, 'PIPELINE')).not.toContain(stage);
    }
  });

  test('les helpers de lecture d\'étape concordent avec le registre', () => {
    expect(isLivePartnershipStage('ACTIVE')).toBe(true);
    expect(isLivePartnershipStage('PAUSED')).toBe(false);
    expect(isTerminalPartnershipStage('ARCHIVED')).toBe(true);
    expect(isTerminalPartnershipStage('LEAD')).toBe(false);
    // Une étape inconnue n'est ni vivante ni terminale : dans le doute, le
    // module ne déclenche rien.
    expect(isLivePartnershipStage('INCONNUE')).toBe(false);
    expect(isTerminalPartnershipStage('INCONNUE')).toBe(false);
  });

  test('un niveau donné ne propose que des étapes qu\'il déclare', () => {
    for (const tier of PARTNERSHIP_TIERS) {
      const allowed = new Set(getPartnershipTier(tier)?.stages ?? []);
      for (const stage of PARTNERSHIP_STAGES) {
        for (const target of nextPartnershipStages(stage, tier)) {
          expect(allowed.has(target)).toBe(true);
        }
      }
    }
  });
});
