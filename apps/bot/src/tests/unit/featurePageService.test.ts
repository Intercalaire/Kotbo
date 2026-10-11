import { describe, expect, test } from 'bun:test';
import { missingForPublication, normalizeContent } from '../../services/system/featurePageService.js';
import { featurePageSeedModules } from '../../services/system/featurePageSeeds.js';
import { RICH_FEATURE_PAGE_SEEDS } from '../../services/system/featurePageRichSeeds.js';

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

describe('featurePageService', () => {
  test('normalizeContent coupe, nettoie et retire les blocs vides', () => {
    const content = normalizeContent({
      fr: {
        name: '  Tickets  ',
        title: 'x'.repeat(500),
        sections: [{ h2: '', body: '', points: [] }, { h2: 'Titre', body: 'Texte', points: ['  a ', ''] }],
        faq: [{ q: '', a: '' }, { q: 'Q ?', a: 'R.' }],
      },
      en: 'pas un objet',
    });
    expect(content.fr.name).toBe('Tickets');
    expect(content.fr.title.length).toBeLessThanOrEqual(90);
    expect(content.fr.sections).toEqual([{ h2: 'Titre', body: 'Texte', points: ['a'] }]);
    expect(content.fr.faq).toEqual([{ q: 'Q ?', a: 'R.' }]);
    expect(content.en.sections).toEqual([]);
  });

  test('une page incomplète ne se publie pas, et dit ce qui manque', () => {
    const missing = missingForPublication(normalizeContent({ fr: { name: 'Tickets' } }));
    expect(missing).toContain('le titre de la page (français)');
    expect(missing).toContain('le nom (anglais)');
  });

  test('les pages déjà rédigées pour le site sont publiables telles quelles', () => {
    for (const seed of RICH_FEATURE_PAGE_SEEDS) {
      expect(missingForPublication(normalizeContent(seed.content))).toEqual([]);
    }
  });

  test('les adresses importées sont valides et uniques dans chaque langue', () => {
    const seeds = [...RICH_FEATURE_PAGE_SEEDS, ...featurePageSeedModules()];
    for (const locale of ['fr', 'en'] as const) {
      const slugs = featurePageSeedModules().map((seed) => seed.slug[locale]);
      expect(new Set(slugs).size).toBe(slugs.length);
      for (const seed of seeds) expect(seed.slug[locale]).toMatch(SLUG);
    }
  });

  test('une page rédigée et le module qu’elle décrit partagent clé et adresse', () => {
    const modules = new Map(featurePageSeedModules().map((module) => [module.key, module]));
    for (const seed of RICH_FEATURE_PAGE_SEEDS) {
      expect(modules.get(seed.key)?.slug).toEqual(seed.slug);
    }
  });
});
