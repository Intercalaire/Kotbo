import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '../../.env') });

import { REST, Routes } from 'discord.js';
import { logger } from './utils/logger.js';
import prisma from './utils/db.js';
import { applicationCommands, guildApplicationCommands } from './commands.js';

const globalPayload = applicationCommands.map((cmd) => cmd.data.toJSON());
const guildPayload = guildApplicationCommands.map((cmd) => cmd.data.toJSON());

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;

if (!token || !clientId) {
  logger.error('Déploiement', 'DISCORD_TOKEN et DISCORD_CLIENT_ID sont requis dans .env');
  process.exit(1);
}

const rest = new REST().setToken(token);

/**
 * Les commandes de guilde ont un quota distinct du quota global (5 menus
 * contextuels User + 5 Message de chaque côté). On les déploie donc sur les
 * serveurs activés, et on purge celles des serveurs non activés - ces derniers
 * ne doivent voir que les commandes globales.
 */
async function loadActivatedGuildIds(): Promise<Set<string>> {
  const rows = await prisma.guild.findMany({ where: { activated: true }, select: { id: true } });
  return new Set(rows.map((row) => row.id));
}

try {
  const guilds = (await rest.get(Routes.userGuilds())) as { id: string; name: string }[];
  const activated = await loadActivatedGuildIds();

  logger.info('Déploiement', `${guilds.length} serveur(s) rejoint(s), ${activated.size} activé(s) en base.`);

  // ── Commandes globales ────────────────────────────────────────────────
  logger.info('Déploiement', `Déploiement de ${globalPayload.length} commandes globales...`);
  await rest.put(Routes.applicationCommands(clientId), { body: globalPayload });
  logger.success('Déploiement', `✓ ${globalPayload.length} commandes globales déployées.`);

  // ── Commandes de guilde ───────────────────────────────────────────────
  const results = await Promise.allSettled(
    guilds.map(async (guild) => {
      const isActivated = activated.has(guild.id);
      const body = isActivated ? guildPayload : [];
      await rest.put(Routes.applicationGuildCommands(clientId, guild.id), { body });
      return isActivated;
    }),
  );

  let deployed = 0;
  let cleared = 0;
  let failed = 0;

  for (const [index, result] of results.entries()) {
    if (result.status === 'fulfilled') {
      if (result.value) deployed++;
      else cleared++;
    } else {
      failed++;
      const guild = guilds[index];
      logger.error('Déploiement', `✗ Échec sur "${guild?.name}" (${guild?.id}) :`, result.reason);
    }
  }

  logger.success(
    'Déploiement',
    `✓ Commandes de guilde : ${deployed} serveur(s) activé(s) à ${guildPayload.length} commande(s), ${cleared} purgé(s), ${failed} en échec.`,
  );

  await prisma.$disconnect();
  process.exit(failed > 0 ? 1 : 0);
} catch (err) {
  logger.error('Déploiement', 'Échec du déploiement :', err);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
}
