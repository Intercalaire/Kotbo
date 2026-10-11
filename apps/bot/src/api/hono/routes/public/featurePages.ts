import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { logger } from '../../../../utils/logger.js';
import { listPublishedFeaturePages } from '../../../../services/system/featurePageService.js';

/**
 * Pages fonctionnalités publiées, lues par le site vitrine à son build
 * (`scripts/fetch-features.mjs` du dépôt Landing-Page). Rédigées dans la
 * console admin (`/admin/feature-pages`) ; voir `featurePageService.ts`.
 */

const TextSchema = z.object({
  name: z.string(),
  title: z.string(),
  description: z.string(),
  h1: z.string(),
  lead: z.string(),
  sections: z.array(z.object({ h2: z.string(), body: z.string(), points: z.array(z.string()).optional() })),
  faq: z.array(z.object({ q: z.string(), a: z.string() })),
});

const FeaturePageSchema = z.object({
  key: z.string(),
  slug: z.object({ fr: z.string(), en: z.string() }),
  modules: z.array(z.string()),
  text: z.object({ fr: TextSchema, en: TextSchema }),
});

const getFeaturePagesRoute = createRoute({
  method: 'get',
  path: '/api/public/feature-pages',
  summary: 'Pages fonctionnalités publiées du site kotbo.fr',
  tags: ['PublicFeaturePages'],
  responses: {
    200: {
      description: 'Pages publiées, dans leur ordre d’affichage',
      content: { 'application/json': { schema: z.object({ pages: z.array(FeaturePageSchema) }) } },
    },
    503: {
      description: 'Base indisponible : le site garde ses pages du build précédent',
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
    },
  },
});

export function createPublicFeaturePagesRouter() {
  const router = new OpenAPIHono();

  router.openapi(getFeaturePagesRoute, async (c) => {
    try {
      const pages = await listPublishedFeaturePages();
      c.header('Cache-Control', 'public, max-age=300');
      return c.json({ pages }, 200);
    } catch (err) {
      logger.error('PublicFeaturePages', 'Lecture des pages impossible', err);
      return c.json({ error: 'Pages indisponibles' }, 503);
    }
  });

  return router;
}
