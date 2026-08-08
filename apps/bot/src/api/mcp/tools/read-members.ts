/** Outils MCP - read members (permission READ_MEMBERS). */
import prisma from '../../../utils/db.js';
import { ThreadChannel } from 'discord.js';
import { z } from 'zod';
import { type McpToolContext, err, ok, resolveChannel, resolveForum, resolveForumPost, resolveMember, serializeDiscordMessage } from '../toolkit.js';

export function registerReadMembersTools(ctx: McpToolContext) {
  const { server, guildId, client, shouldRegister, guard, toolMeta } = ctx;

  if (shouldRegister('READ_MEMBERS')) {
    server.registerTool(
      'get_recent_messages',
      {
        description: "Récupère les messages récents d'un salon Discord (lecture en direct via l'API Discord).",
        inputSchema: {
          channel: z.string().describe('Nom du salon (ex: « general », avec ou sans #), mention <#id> ou ID'),
          limit: z.number().int().min(1).max(100).default(20).describe('Nombre de messages (1-100)'),
        },
        _meta: toolMeta,
      },
      guard('READ_MEMBERS', async ({ channel, limit }) => {
        const resolved = resolveChannel(guildId, client, channel);
        if (!resolved.ok) return resolved.response;

        const messages = await resolved.channel.messages.fetch({ limit }).catch(() => null);
        if (!messages) return err('Impossible de lire les messages (permissions insuffisantes)');

        return ok(
          messages.map((m) => ({
            id: m.id,
            authorId: m.author.id,
            authorName: m.author.username,
            content: m.content,
            createdAt: m.createdAt.toISOString(),
          }))
        );
      })
    );

    server.registerTool(
      'list_forum_posts',
      {
        description:
          'Liste les articles actifs et, sur demande, archivés d’un forum Discord avec leurs tags. Requiert READ_MEMBERS.',
        inputSchema: {
          forum: z.string().describe('Nom, mention ou ID du forum'),
          include_archived: z.boolean().default(true),
          limit: z.number().int().min(1).max(100).default(50),
        },
        _meta: toolMeta,
      },
      guard('READ_MEMBERS', async ({ forum, include_archived, limit }) => {
        const resolved = resolveForum(guildId, client, forum);
        if (!resolved.ok) return resolved.response;

        const active = await resolved.forum.threads.fetchActive().catch(() => null);
        if (!active) return err('Impossible de lire les articles actifs du forum (permissions insuffisantes ?)');
        const archived = include_archived
          ? await resolved.forum.threads.fetchArchived({ limit }).catch(() => null)
          : null;

        const posts = new Map<string, ThreadChannel>();
        for (const post of active.threads.values()) posts.set(post.id, post);
        for (const post of archived?.threads.values() ?? []) posts.set(post.id, post);
        const tagNames = new Map(resolved.forum.availableTags.map((tag) => [tag.id, tag.name]));

        return ok({
          forum: {
            id: resolved.forum.id,
            name: resolved.forum.name,
            topic: resolved.forum.topic,
            tags: resolved.forum.availableTags,
          },
          posts: [...posts.values()]
            .sort((a, b) => (b.createdTimestamp ?? 0) - (a.createdTimestamp ?? 0))
            .slice(0, limit)
            .map((post) => ({
              id: post.id,
              name: post.name,
              ownerId: post.ownerId,
              createdAt: post.createdAt?.toISOString() ?? null,
              archived: post.archived,
              locked: post.locked,
              messageCount: post.messageCount,
              appliedTags: post.appliedTags.map((id) => ({ id, name: tagNames.get(id) ?? null })),
            })),
        });
      })
    );

    server.registerTool(
      'read_forum_post',
      {
        description:
          'Lit le contenu et les réponses d’un article de forum Discord, embeds et composants v2 inclus. Requiert READ_MEMBERS.',
        inputSchema: {
          forum: z.string().describe('Nom, mention ou ID du forum'),
          post: z.string().describe('Titre, mention ou ID de l’article'),
          limit: z.number().int().min(1).max(100).default(50),
          before_message_id: z.string().optional().describe('Pagination : messages antérieurs à cet ID'),
        },
        _meta: toolMeta,
      },
      guard('READ_MEMBERS', async ({ forum, post, limit, before_message_id }) => {
        const resolvedForum = resolveForum(guildId, client, forum);
        if (!resolvedForum.ok) return resolvedForum.response;
        const resolvedPost = await resolveForumPost(resolvedForum.forum, post);
        if (!resolvedPost.ok) return resolvedPost.response;

        const [starterMessage, messages] = await Promise.all([
          // Dans un forum, l’ID du fil est aussi celui du premier message.
          // On le récupère séparément pour ne jamais perdre le contenu de
          // l’article quand il possède plus de `limit` réponses.
          resolvedPost.post.messages.fetch(resolvedPost.post.id).catch(() => null),
          resolvedPost.post.messages
            .fetch({ limit, ...(before_message_id ? { before: before_message_id } : {}) })
            .catch(() => null),
        ]);
        if (!messages) return err('Impossible de lire cet article (permissions insuffisantes ?)');
        const tagNames = new Map(resolvedForum.forum.availableTags.map((tag) => [tag.id, tag.name]));

        return ok({
          post: {
            id: resolvedPost.post.id,
            name: resolvedPost.post.name,
            forumId: resolvedForum.forum.id,
            ownerId: resolvedPost.post.ownerId,
            archived: resolvedPost.post.archived,
            locked: resolvedPost.post.locked,
            appliedTags: resolvedPost.post.appliedTags.map((id) => ({ id, name: tagNames.get(id) ?? null })),
          },
          starterMessage: starterMessage
            ? serializeDiscordMessage(starterMessage, resolvedForum.forum.guild)
            : null,
          messages: messages
            .filter((message) => message.id !== resolvedPost.post.id)
            .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
            .map((message) => serializeDiscordMessage(message, resolvedForum.forum.guild)),
        });
      })
    );

    server.registerTool(
      'get_member_profile',
      {
        description: "Récupère le profil d'un membre du serveur (activité, historique, informations Discord).",
        inputSchema: { member: z.string().describe('Nom, surnom, @mention ou ID Discord du membre') },
        _meta: toolMeta,
      },
      guard('READ_MEMBERS', async ({ member }) => {
        const resolved = await resolveMember(guildId, member);
        if (!resolved.ok) return resolved.response;
        const member_id = resolved.userId;

        const [profile, discordMember] = await Promise.all([
          prisma.memberProfile.findUnique({
            where: { guildId_userId: { guildId, userId: member_id } },
          }),
          client.guilds.cache.get(guildId)?.members.fetch(member_id).catch(() => null),
        ]);

        if (!profile && !discordMember) return err('Membre introuvable');

        return ok({
          userId: member_id,
          profile: profile
            ? {
                messageCount: profile.messageCount,
                voiceTimeSeconds: profile.voiceTimeSeconds,
                joinedAt: profile.guildJoinedAt?.toISOString(),
                lastSeenAt: profile.lastSeenAt.toISOString(),
                lastMessageAt: profile.lastMessageAt?.toISOString(),
                isSuspectedDC: profile.isSuspectedDC,
                moderatorNote: profile.moderatorNote,
              }
            : null,
          discord: discordMember
            ? {
                username: discordMember.user.username,
                displayName: discordMember.displayName,
                avatarUrl: discordMember.displayAvatarURL(),
                roles: discordMember.roles.cache.map((r) => ({ id: r.id, name: r.name })),
                joinedAt: discordMember.joinedAt?.toISOString(),
              }
            : null,
        });
      })
    );

    server.registerTool(
      'search_members',
      {
        description: "Recherche des membres par nom d'utilisateur ou nom d'affichage.",
        inputSchema: {
          query: z.string().describe('Terme de recherche (username, displayName ou userId)'),
          limit: z.number().int().min(1).max(50).default(20),
        },
        _meta: toolMeta,
      },
      guard('READ_MEMBERS', async ({ query, limit }) => {
        const members = await prisma.memberProfile.findMany({
          where: {
            guildId,
            OR: [
              { userId: query },
              { username: { contains: query, mode: 'insensitive' } },
              { displayName: { contains: query, mode: 'insensitive' } },
            ],
          },
          take: limit,
          orderBy: { lastSeenAt: 'desc' },
          select: {
            userId: true,
            username: true,
            displayName: true,
            messageCount: true,
            lastSeenAt: true,
            guildJoinedAt: true,
          },
        });

        const enriched = members.map((m) => ({
          userId: m.userId,
          username: m.username,
          displayName: m.displayName,
          messageCount: m.messageCount,
          lastSeenAt: m.lastSeenAt.toISOString(),
          joinedAt: m.guildJoinedAt?.toISOString() ?? null,
        }));

        return ok(enriched);
      })
    );
  }
}
