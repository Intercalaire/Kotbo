/**
 * Les rappels d'expiration d'accès : un palier marqué traité avant l'envoi.
 *
 * `processReminder` enregistrait les paliers franchis **avant** de tenter le
 * rappel, puis jetait le booléen que `publishNotice` prend pourtant soin de
 * calculer. Un rappel refusé — salon de notification supprimé, droits retirés —
 * laissait donc le palier marqué, et ne repartait jamais : contrairement aux
 * tickets, rien ici ne réarme. C'est un rappel d'expiration d'abonnement
 * **payant** qui disparaissait pour de bon, pendant que le journal annonçait
 * son envoi.
 *
 * Préfixe `zz-` : ce fichier pose un `mock.module` sur `utils/db`, et
 * `bun test --isolate` ne les isole pas — il doit charger en dernier.
 */
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import path from 'node:path';
import { ChannelType, PermissionFlagsBits, type Client, type Guild } from 'discord.js';
import { completeModuleMock } from '../helpers/moduleMock.js';

const GUILD_ID = 'guilde-1';

let ligneGuild: Record<string, unknown>;
const misesAJour: Array<Record<string, unknown>> = [];

const fauxPrisma = {
  guild: {
    findUnique: mock(async () => ligneGuild),
    update: mock(async ({ data }: { data: Record<string, unknown> }) => {
      misesAJour.push(data);
      return ligneGuild;
    }),
  },
};

function mockerModule(relatif: string, overrides: Record<string, unknown>): void {
  const source = path.resolve(import.meta.dir, `${relatif}.ts`);
  for (const suffixe of ['.ts', '.js']) {
    mock.module(path.resolve(import.meta.dir, `${relatif}${suffixe}`), () =>
      completeModuleMock(source, overrides));
  }
}
mockerModule('../../utils/db', { default: fauxPrisma, prisma: fauxPrisma, prismaRead: fauxPrisma });
// `reminderContent` resout la langue du serveur, donc `getCachedGuild`, dont la
// vraie implementation ouvre Redis. Son `catch` journalise sous le tag `Cache` —
// c'est-a-dire dans le MEME tableau que celui ou ces cas comptent les erreurs.
// Sans cette doublure, une machine ou Redis est configure mais injoignable
// ajouterait une entree parasite et ferait echouer les deux cas, pour une raison
// qui n'a rien a voir avec ce qu'ils mesurent.
mockerModule('../../utils/cache', { getCachedGuild: mock(async () => ({ language: 'fr' })) });

const { processReminder, resetReminderRetries } = await import('../../services/system/accessService.js');
const { logger } = await import('../../utils/logger.js');

/** Un serveur dont aucun salon n'accepte d'envoi : `publishNotice` rendra `false`. */
function guildSansSalon(): Guild {
  return {
    id: GUILD_ID,
    systemChannelId: null,
    members: { me: {} },
    // `resolveNoticeChannel` appelle `.get()` ET `.find()` : `channels.cache`
    // est une Collection discord.js, pas une Map — une Map nue planterait.
    channels: { cache: { get: () => undefined, find: () => undefined } },
  } as unknown as Guild;
}

/** Un serveur avec un salon textuel où le bot peut écrire. */
function guildAvecSalon(): { guild: Guild; send: ReturnType<typeof mock> } {
  const send = mock(async () => ({ id: 'message-1' }));
  const me = {};
  const salon = {
    id: 'salon-1',
    type: ChannelType.GuildText,
    isTextBased: () => true,
    permissionsFor: () => ({ has: (bit: bigint) => bit === PermissionFlagsBits.SendMessages }),
    send,
  };
  const cache = {
    get: (id: string) => (id === 'salon-1' ? salon : undefined),
    find: (predicat: (c: unknown) => boolean) => (predicat(salon) ? salon : undefined),
  };
  return {
    guild: {
      id: GUILD_ID,
      systemChannelId: 'salon-1',
      members: { me },
      channels: { cache },
    } as unknown as Guild,
    send,
  };
}

function clientAvec(guild: Guild): Client {
  return { guilds: { fetch: mock(async () => guild) } } as unknown as Client;
}

/** Un accès dont il reste peu de temps, sans aucun palier encore traité. */
function statut() {
  return {
    accessType: 'TRIAL',
    accessExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
    // Quatorze jours d'acces, dont il reste moins d'un jour : le palier
    // « 1 jour » est atteint et jamais traite, donc un rappel est du.
    accessDurationMinutes: 14 * 24 * 60,
    minutesLeft: 1000,
    accessRemindersSent: [] as number[],
  } as never;
}

const erreurOrigine = logger.error;
const infoOrigine = logger.info;
let erreurs: string[] = [];
let infos: string[] = [];

beforeEach(() => {
  resetReminderRetries();
  erreurs = [];
  infos = [];
  misesAJour.length = 0;
  ligneGuild = { id: GUILD_ID, broadcastChannelId: null, logChannelId: null };
  logger.error = (tag: string, ...args: unknown[]) => {
    erreurs.push(`${tag} ${args.map((a) => String(a)).join(' ')}`);
  };
  logger.info = (tag: string, ...args: unknown[]) => {
    infos.push(`${tag} ${args.map((a) => String(a)).join(' ')}`);
  };
});

afterEach(() => {
  logger.error = erreurOrigine;
  logger.info = infoOrigine;
});

describe('processReminder', () => {
  test("un rappel qui ne part pas ne marque pas le palier comme traité", async () => {
    await processReminder(clientAvec(guildSansSalon()), GUILD_ID, statut());

    // Le cœur : aucun palier enregistré, donc le rappel repartira au prochain
    // passage. Sans cela il disparaissait pour toujours.
    expect(misesAJour).toEqual([]);
    expect(erreurs).toHaveLength(1);
    // Et le journal ne doit surtout pas annoncer un envoi qui n'a pas eu lieu.
    expect(infos.some((ligne) => ligne.includes('envoyé'))).toBe(false);
  });

  test("témoin : un rappel délivré marque bien le palier", async () => {
    // Ce cas passe des deux côtés — il prouve que le montage sait aussi rendre
    // vert, donc que le rouge du cas précédent vient du correctif et non d'un
    // faux serveur que la fonction aurait refusé avant même d'essayer.
    const { guild, send } = guildAvecSalon();

    await processReminder(clientAvec(guild), GUILD_ID, statut());

    expect(send).toHaveBeenCalledTimes(1);
    expect(misesAJour).toHaveLength(1);
    expect(erreurs).toEqual([]);
  });

  test("un rappel refusé n'est pas retenté à chaque minute", async () => {
    const debut = Date.now();
    const client = clientAvec(guildSansSalon());

    await processReminder(client, GUILD_ID, statut(), debut);
    await processReminder(client, GUILD_ID, statut(), debut + 60_000);

    expect(erreurs).toHaveLength(1);
    expect(client.guilds.fetch).toHaveBeenCalledTimes(1);

    await processReminder(client, GUILD_ID, statut(), debut + 61 * 60_000);

    expect(erreurs).toHaveLength(2);
    expect(client.guilds.fetch).toHaveBeenCalledTimes(2);
  });
});
