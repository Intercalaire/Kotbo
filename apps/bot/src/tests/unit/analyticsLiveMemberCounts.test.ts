import { describe, expect, test, mock } from 'bun:test';
import path from 'node:path';
import { completeModuleMock } from '../helpers/moduleMock.js';

/**
 * `api/shared.ts` est un barrel (`export * from './shared/*.js'`). Seul
 * `guildState.ts` y tire, via `commands.js` (registre complet des commandes
 * du bot), une chaine cassee par un desync `@kotbo/shared` entre worktrees
 * partageant le meme node_modules (sans rapport avec ce fichier). On ne mocke
 * donc QUE `guildState.ts` — jamais appele par `resolveLiveGuildCounts` — pour
 * ne pas trainer cette chaine dans l'import d'analytics.ts. Le reste du
 * barrel (core.ts et donc `json`/`readJsonBody`/`getGuildMembers`/`splitPath`/
 * etc.) charge reellement, pour ne pas casser les autres fichiers de test qui
 * en dependent.
 */
const guildStatePath = path.resolve(import.meta.dir, '../../api/shared/guildState.ts');
for (const suffix of ['../../api/shared/guildState.ts', '../../api/shared/guildState.js']) {
  mock.module(path.resolve(import.meta.dir, suffix), () => completeModuleMock(guildStatePath, {}));
}

const { resolveLiveGuildCounts } = await import('../../api/routes/dashboard/analytics.js');

type FakeMemberSpec = { bot?: boolean; status?: 'online' | 'idle' | 'dnd' | 'offline'; voiceChannelId?: string | null };

function fakeGuild(memberCount: number, members: FakeMemberSpec[]) {
  const cache = new Map(
    members.map((m, i) => [
      `member-${i}`,
      {
        user: { bot: !!m.bot },
        presence: m.status ? { status: m.status } : null,
        voice: m.voiceChannelId ? { channelId: m.voiceChannelId } : null,
      },
    ]),
  );
  return { memberCount, members: { cache } };
}

describe("resolveLiveGuildCounts (compteurs 'en direct' de la carte d'accueil)", () => {
  test('cache de presence vide mais serveur non vide : ne doit pas annoncer 0 en ligne // CASSE SI: le calcul de onlineNow ignore resolveOnlineMembersCount / fetchApproximatePresenceCount et se contente du filtre brut du cache', async () => {
    // Cache totalement vide (redemarrage, gros serveur, presence intent pas encore hydratee)
    // mais le serveur a bien 50 membres : un cache vide veut dire "on ne sait pas",
    // pas "personne en ligne".
    const guild = fakeGuild(50, []);

    const counts = await resolveLiveGuildCounts(guild, async () => 23);

    expect(counts.onlineNow).toBe(23);
  });

  test('cache partiel : le compte en ligne reste celui du cache, sans inventer un autre chiffre // CASSE SI: le calcul ecrase le compte du cache par le resultat de fetchApproximatePresenceCount des que le cache a au moins un membre en ligne', async () => {
    const guild = fakeGuild(50, [
      { status: 'online' },
      { status: 'online' },
      { status: 'offline' },
    ]);

    // Le fetch renverrait une valeur absurde s'il etait appele : la fonction ne
    // doit pas le consulter puisque le cache n'est pas a 0.
    const counts = await resolveLiveGuildCounts(guild, async () => 999);

    expect(counts.onlineNow).toBe(2);
  });

  test('les bots ne comptent pas comme membres en ligne // CASSE SI: le filtre de presence ne retire pas m.user.bot avant de compter onlineNow', async () => {
    const guild = fakeGuild(3, [
      { bot: true, status: 'online' },
      { status: 'online' },
      { status: 'offline' },
    ]);

    const counts = await resolveLiveGuildCounts(guild);

    expect(counts.onlineNow).toBe(1);
    expect(counts.botsCount).toBe(1);
  });

  test('le comptage en vocal suit la meme regle que le comptage en ligne : les bots ne comptent pas // CASSE SI: le filtre vocal ne retire pas m.user.bot avant de compter voiceNow', async () => {
    const guild = fakeGuild(3, [
      { bot: true, voiceChannelId: 'salon-1' },
      { voiceChannelId: 'salon-1' },
      {},
    ]);

    const counts = await resolveLiveGuildCounts(guild);

    expect(counts.voiceNow).toBe(1);
  });
});
