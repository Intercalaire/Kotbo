/** Routes dashboard du module `news`. */
import { publishNewsArticle } from '../../../../services/core/newsService.js';
import prisma from '../../../../utils/db.js';
import { errorMessage } from '../../../../utils/errors.js';
import { logger } from '../../../../utils/logger.js';
import { getGuildName, json, pushAudit, readJsonBody } from '../../../shared.js';
import { type ModuleRouteContext } from './_shared.js';

export async function handleNewsRoutes(ctx: ModuleRouteContext): Promise<boolean> {
  const { req, res, parts, client, user, guildId, method, auditUser, moduleKey } = ctx;

  // News routes
  if (moduleKey === 'news') {
    // GET /api/dashboard/guilds/:guildId/news
    if (parts.length === 5 && method === 'GET') {
      try {
        const articles = await prisma.newsArticle.findMany({
          where: { guildId },
          orderBy: { publishedAt: 'desc' },
        });
        json(res, 200, articles);
      } catch (err: unknown) {
        logger.error('NewsAPI', `Error listing news for guild ${guildId}: ${errorMessage(err)}`);
        json(res, 500, { error: 'Erreur lors de la récupération des actualités' });
      }
      return true;
    }

    // POST /api/dashboard/guilds/:guildId/news
    if (parts.length === 5 && method === 'POST') {
      try {
        const body = await readJsonBody<{
          title: string;
          content: string;
          summary?: string;
          imageUrl?: string;
          category?: string;
          subcategory?: string;
          published?: boolean;
          publishMode?: 'summary' | 'full_embed';
        }>(req);

        if (!body || !body.title || !body.content) {
          json(res, 400, { error: 'Le titre et le contenu sont requis.' });
          return true;
        }

        const authorUser = await client.users.fetch(user.userId).catch(() => null);
        const authorName = authorUser?.globalName || authorUser?.username || user.username || 'Staff';
        const authorAvatar = authorUser?.displayAvatarURL() || null;

        const isPublished = body.published ?? false;

        const article = await prisma.newsArticle.create({
          data: {
            guildId,
            title: body.title,
            content: body.content,
            summary: body.summary || null,
            imageUrl: body.imageUrl || null,
            category: body.category || 'Mise à jour',
            subcategory: body.subcategory || '',
            published: isPublished,
            authorId: user.userId,
            authorName,
            authorAvatar,
            publishedAt: new Date(),
          },
        });

        await pushAudit(guildId, {
          user: auditUser,
          action: isPublished ? 'Publication actualité' : 'Création brouillon actualité',
          context: getGuildName(client, guildId),
          module: 'Actualités',
          eventType: 'Manuel',
          details: `Article "${body.title}" de catégorie "${body.category || 'Mise à jour'}" créé.`,
          channelId: null,
        });

        if (isPublished) {
          const publishMode = body.publishMode === 'full_embed' ? 'full_embed' : 'summary';
          await publishNewsArticle(client, guildId, article.id, publishMode).catch(err => {
            logger.error('NewsAPI', `Failed to send news notification to Discord for article ${article.id}:`, err);
          });
        }

        json(res, 201, article);
      } catch (err: unknown) {
        logger.error('NewsAPI', `Error creating news for guild ${guildId}: ${errorMessage(err)}`);
        json(res, 500, { error: "Erreur lors de la création de l'actualité" });
      }
      return true;
    }

    // PATCH /api/dashboard/guilds/:guildId/news/:articleId
    if (parts.length === 6 && method === 'PATCH') {
      const articleId = parts[5];
      try {
        const existing = await prisma.newsArticle.findUnique({
          where: { id: articleId },
        });

        if (!existing || existing.guildId !== guildId) {
          json(res, 404, { error: 'Actualité introuvable' });
          return true;
        }

        const body = await readJsonBody<{
          title?: string;
          content?: string;
          summary?: string;
          imageUrl?: string;
          category?: string;
          subcategory?: string;
          published?: boolean;
          publishMode?: 'summary' | 'full_embed';
        }>(req);

        if (!body) {
          json(res, 400, { error: 'Données manquantes' });
          return true;
        }

        const isPublishing = body.published === true && !existing.published;

        const updated = await prisma.newsArticle.update({
          where: { id: articleId },
          data: {
            title: body.title !== undefined ? body.title : undefined,
            content: body.content !== undefined ? body.content : undefined,
            summary: body.summary !== undefined ? body.summary : undefined,
            imageUrl: body.imageUrl !== undefined ? body.imageUrl : undefined,
            category: body.category !== undefined ? body.category : undefined,
            subcategory: body.subcategory !== undefined ? body.subcategory : undefined,
            published: body.published !== undefined ? body.published : undefined,
            publishedAt: isPublishing ? new Date() : undefined,
          },
        });

        await pushAudit(guildId, {
          user: auditUser,
          action: isPublishing ? 'Publication actualité' : 'Modification actualité',
          context: getGuildName(client, guildId),
          module: 'Actualités',
          eventType: 'Manuel',
          details: `Article "${updated.title}" mis à jour (Publié: ${updated.published}).`,
          channelId: null,
        });

        if (isPublishing) {
          const publishMode = body.publishMode === 'full_embed' ? 'full_embed' : 'summary';
          await publishNewsArticle(client, guildId, updated.id, publishMode).catch(err => {
            logger.error('NewsAPI', `Failed to send news notification to Discord for article ${updated.id}:`, err);
          });
        }

        json(res, 200, updated);
      } catch (err: unknown) {
        logger.error('NewsAPI', `Error updating news article ${articleId}: ${errorMessage(err)}`);
        json(res, 500, { error: "Erreur lors de la modification de l'actualité" });
      }
      return true;
    }

    // DELETE /api/dashboard/guilds/:guildId/news/:articleId
    if (parts.length === 6 && method === 'DELETE') {
      const articleId = parts[5];
      try {
        const existing = await prisma.newsArticle.findUnique({
          where: { id: articleId },
        });

        if (!existing || existing.guildId !== guildId) {
          json(res, 404, { error: 'Actualité introuvable' });
          return true;
        }

        await prisma.newsArticle.delete({
          where: { id: articleId },
        });

        await pushAudit(guildId, {
          user: auditUser,
          action: 'Suppression actualité',
          context: getGuildName(client, guildId),
          module: 'Actualités',
          eventType: 'Manuel',
          details: `Article "${existing.title}" supprimé.`,
          channelId: null,
        });

        json(res, 200, { success: true });
      } catch (err: unknown) {
        logger.error('NewsAPI', `Error deleting news article ${articleId}: ${errorMessage(err)}`);
        json(res, 500, { error: "Erreur lors de la suppression de l'actualité" });
      }
      return true;
    }

    // GET /api/dashboard/guilds/:guildId/news/category-configs
    if (parts.length === 6 && parts[5] === 'category-configs' && method === 'GET') {
      try {
        const configs = await prisma.newsCategoryConfig.findMany({
          where: { guildId },
          orderBy: { category: 'asc' },
        });
        json(res, 200, configs);
      } catch (err: unknown) {
        logger.error('NewsAPI', `Error listing news category configs for guild ${guildId}: ${errorMessage(err)}`);
        json(res, 500, { error: 'Erreur lors de la récupération de la configuration des catégories' });
      }
      return true;
    }

    // POST /api/dashboard/guilds/:guildId/news/category-configs
    if (parts.length === 6 && parts[5] === 'category-configs' && method === 'POST') {
      try {
        const body = await readJsonBody<{
          category: string;
          subcategory?: string;
          channelId: string;
        }>(req);

        if (!body || !body.category || !body.channelId) {
          json(res, 400, { error: 'La catégorie et le salon Discord sont requis.' });
          return true;
        }

        const category = body.category.trim();
        const subcategory = (body.subcategory || '').trim();
        const channelId = body.channelId.trim();

        const discordGuild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
        if (!discordGuild) {
          json(res, 404, { error: 'Serveur introuvable' });
          return true;
        }
        const channel = await discordGuild.channels.fetch(channelId).catch(() => null);
        if (!channel) {
          json(res, 400, { error: 'Le salon Discord spécifié est introuvable ou inaccessible.' });
          return true;
        }

        const config = await prisma.newsCategoryConfig.upsert({
          where: {
            guildId_category_subcategory: {
              guildId,
              category,
              subcategory,
            }
          },
          create: {
            guildId,
            category,
            subcategory,
            channelId,
          },
          update: {
            channelId,
          }
        });

        await pushAudit(guildId, {
          user: auditUser,
          action: 'Config catégorie actualité',
          context: getGuildName(client, guildId),
          module: 'Actualités',
          eventType: 'Manuel',
          details: `Configuration du salon #${channel.name} pour la catégorie "${category}"${subcategory ? ` (${subcategory})` : ''}.`,
          channelId: null,
        });

        json(res, 200, config);
      } catch (err: unknown) {
        logger.error('NewsAPI', `Error saving news category config for guild ${guildId}: ${errorMessage(err)}`);
        json(res, 500, { error: "Erreur lors de l'enregistrement de la configuration de catégorie" });
      }
      return true;
    }

    // DELETE /api/dashboard/guilds/:guildId/news/category-configs/:id
    if (parts.length === 7 && parts[5] === 'category-configs' && method === 'DELETE') {
      const configId = parts[6];
      try {
        const existing = await prisma.newsCategoryConfig.findUnique({
          where: { id: configId },
        });

        if (!existing || existing.guildId !== guildId) {
          json(res, 404, { error: 'Configuration de catégorie introuvable' });
          return true;
        }

        await prisma.newsCategoryConfig.delete({
          where: { id: configId },
        });

        await pushAudit(guildId, {
          user: auditUser,
          action: 'Suppression config catégorie actualité',
          context: getGuildName(client, guildId),
          module: 'Actualités',
          eventType: 'Manuel',
          details: `Configuration de catégorie "${existing.category}"${existing.subcategory ? ` (${existing.subcategory})` : ''} supprimée.`,
          channelId: null,
        });

        json(res, 200, { success: true });
      } catch (err: unknown) {
        logger.error('NewsAPI', `Error deleting news category config ${configId}: ${errorMessage(err)}`);
        json(res, 500, { error: 'Erreur lors de la suppression de la configuration de catégorie' });
      }
      return true;
    }
  }

  return false;
}
