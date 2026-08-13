/** Outils MCP - write community 2 (permission WRITE_COMMUNITY). */
import { KOTBO_MODULES, setModuleActivation } from '../../../services/analytics/moduleStatsService.js';
import prisma from '../../../utils/db.js';
import { invalidateLevelConfigCache } from '../../../services/progression/levelingService.js';
import { z } from 'zod';
import { type McpToolContext, err, ok } from '../toolkit.js';

export function registerWriteCommunity2Tools(ctx: McpToolContext) {
  const { server, guildId, shouldRegister, guard, toolMeta } = ctx;

  if (shouldRegister('WRITE_COMMUNITY')) {
    server.registerTool(
      'set_module_activation',
      {
        description: 'Active ou désactive un module Kotbo.',
        inputSchema: {
          module_name: z.string().describe('Nom du module Kotbo'),
          enabled: z.boolean().describe('État cible'),
          config: z.record(z.unknown()).optional().describe('Configuration associée au module'),
        },
        _meta: toolMeta,
      },
      guard('WRITE_COMMUNITY', async ({ module_name, enabled, config }) => {
        const normalizedModule = module_name.trim();
        if (!KOTBO_MODULES.includes(normalizedModule as never)) {
          return err(`Module Kotbo inconnu : ${module_name}`);
        }

        try {
          await setModuleActivation(guildId, normalizedModule as never, enabled, config);

          if (normalizedModule === 'leveling') {
            await prisma.levelConfig.upsert({
              where: { guildId },
              create: { guildId, enabled },
              update: { enabled },
            });
            await invalidateLevelConfigCache(guildId);
          }

          const updates: Record<string, unknown> = {};
          if (normalizedModule === 'codePolice') updates.codePoliceEnabled = enabled;
          if (normalizedModule === 'dailyAlgo') updates.dailyAlgoEnabled = enabled;
          if (normalizedModule === 'translation') updates.translationEnabled = enabled;
          if (normalizedModule === 'sanction') {
            updates.sanctionSyncEnabled = enabled;
            updates.sanctionReportEnabled = enabled;
          }
          if (normalizedModule === 'nicknameModeration') updates.autoNicknameModerationEnabled = enabled;
          if (normalizedModule === 'autoThread') updates.autoThreadEnabled = enabled;
          if (normalizedModule === 'fun') updates.funEnabled = enabled;

          if (Object.keys(updates).length > 0) {
            await prisma.guild.update({ where: { id: guildId }, data: updates });
          }

          await prisma.dashboardFeatureConfig.upsert({
            where: { guildId_featureKey: { guildId, featureKey: normalizedModule } },
            create: {
              guildId,
              featureKey: normalizedModule,
              featureName: normalizedModule,
              enabled,
              loggingEnabled: true,
              userActivityTracking: true,
              notifyViaDiscordChannel: true,
              metadata: config ?? {},
            },
            update: {
              enabled,
              metadata: config ?? {},
            },
          });

          return ok({ ok: true, moduleName: normalizedModule, enabled });
        } catch (e) {
          return err(`Erreur : ${e instanceof Error ? e.message : String(e)}`);
        }
      })
    );
  }
}
