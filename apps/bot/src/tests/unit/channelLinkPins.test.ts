import { describe, expect, test, mock, beforeEach } from 'bun:test';
import path from 'node:path';

/**
 * Synchronisation des épinglages d'un pont.
 *
 * Discord n'annonce jamais *quel* message vient d'être épinglé : le service
 * compare les deux listes. Ces tests portent donc sur les décisions prises à
 * partir de cette comparaison - notamment celles de ne rien faire, qui sont les
 * seules capables d'abîmer le salon d'en face.
 */

type LinkRow = Record<string, unknown>;
type MappingRow = {
  sourceMessageId: string;
  sourceChannelId: string;
  relayedMessageId: string;
  relayedChannelId: string;
};

let linkRows: LinkRow[] = [];
let mappingRows: MappingRow[] = [];

const mockDb = {
  channelLink: { findMany: mock(() => Promise.resolve(linkRows)) },
  channelLinkMessage: { findMany: mock(() => Promise.resolve(mappingRows)) },
};

const dbPath = path.resolve(import.meta.dir, '../../utils/db.ts');
const dbJsPath = path.resolve(import.meta.dir, '../../utils/db.js');
mock.module(dbPath, () => ({ default: mockDb, prisma: mockDb, prismaRead: mockDb }));
mock.module(dbJsPath, () => ({ default: mockDb, prisma: mockDb, prismaRead: mockDb }));

const { relayPinsUpdate } = await import('../../services/features/channelLinkService');

// Le cache des liens est mémorisé par salon : chaque test travaille sur ses
// propres identifiants pour ne pas hériter du précédent.
let salonSeq = 0;

type FakeChannel = {
  id: string;
  isTextBased: () => boolean;
  messages: {
    fetchPins: () => Promise<{ hasMore: boolean; items: { message: { id: string } }[] }>;
    pin: ReturnType<typeof mock>;
    unpin: ReturnType<typeof mock>;
  };
};

function makeChannel(id: string, pinned: string[] | 'illisible'): FakeChannel {
  return {
    id,
    isTextBased: () => true,
    messages: {
      fetchPins: () =>
        pinned === 'illisible'
          ? Promise.reject(new Error('Missing Permissions'))
          : Promise.resolve({ hasMore: false, items: pinned.map((messageId) => ({ message: { id: messageId } })) }),
      pin: mock(() => Promise.resolve()),
      unpin: mock(() => Promise.resolve()),
    },
  };
}

function makeClient(channels: Record<string, Record<string, FakeChannel>>) {
  const guilds = Object.fromEntries(
    Object.entries(channels).map(([guildId, guildChannels]) => [
      guildId,
      {
        id: guildId,
        name: `Serveur ${guildId}`,
        channels: { cache: { get: (id: string) => guildChannels[id] } },
      },
    ]),
  );
  return { guilds: { cache: { get: (id: string) => guilds[id] } } };
}

/** Un pont ordinaire, bidirectionnel, avec la synchronisation d'épinglage. */
function makeLink(overrides: LinkRow = {}) {
  salonSeq += 1;
  return {
    id: `lien-${salonSeq}`,
    enabled: true,
    sourceGuildId: 'G-A',
    sourceChannelId: `salon-a-${salonSeq}`,
    targetGuildId: 'G-B',
    targetChannelId: `salon-b-${salonSeq}`,
    direction: 'BIDIRECTIONAL',
    sourceRelayMode: 'WEBHOOK',
    targetRelayMode: 'WEBHOOK',
    sourceWebhookId: 'wh-a',
    targetWebhookId: 'wh-b',
    relayPins: true,
    ...overrides,
  };
}

beforeEach(() => {
  linkRows = [];
  mappingRows = [];
});

describe('relayPinsUpdate', () => {
  test('épingle en face le message dont le pont connaît la copie', async () => {
    const link = makeLink();
    linkRows = [link];
    mappingRows = [
      {
        sourceMessageId: 'msg-origine',
        sourceChannelId: link.sourceChannelId,
        relayedMessageId: 'msg-copie',
        relayedChannelId: link.targetChannelId,
      },
    ];

    const local = makeChannel(link.sourceChannelId, ['msg-origine']);
    const distant = makeChannel(link.targetChannelId, []);
    const client = makeClient({ 'G-A': { [local.id]: local }, 'G-B': { [distant.id]: distant } });

    await relayPinsUpdate('G-A', link.sourceChannelId, client as never);

    expect(distant.messages.pin).toHaveBeenCalledTimes(1);
    expect(distant.messages.pin.mock.calls[0][0]).toBe('msg-copie');
    expect(distant.messages.unpin).not.toHaveBeenCalled();
  });

  test('remonte l\'épinglage d\'une copie relayée vers le message d\'origine', async () => {
    const link = makeLink();
    linkRows = [link];
    // Le salon où l'on épingle héberge cette fois la copie : l'original vit en face.
    mappingRows = [
      {
        sourceMessageId: 'msg-origine',
        sourceChannelId: link.targetChannelId,
        relayedMessageId: 'msg-copie',
        relayedChannelId: link.sourceChannelId,
      },
    ];

    const local = makeChannel(link.sourceChannelId, ['msg-copie']);
    const distant = makeChannel(link.targetChannelId, []);
    const client = makeClient({ 'G-A': { [local.id]: local }, 'G-B': { [distant.id]: distant } });

    await relayPinsUpdate('G-A', link.sourceChannelId, client as never);

    expect(distant.messages.pin.mock.calls[0][0]).toBe('msg-origine');
  });

  test('décroche en face le message qui vient d\'être désépinglé', async () => {
    const link = makeLink();
    linkRows = [link];
    mappingRows = [
      {
        sourceMessageId: 'msg-origine',
        sourceChannelId: link.sourceChannelId,
        relayedMessageId: 'msg-copie',
        relayedChannelId: link.targetChannelId,
      },
    ];

    const local = makeChannel(link.sourceChannelId, []);
    const distant = makeChannel(link.targetChannelId, ['msg-copie']);
    const client = makeClient({ 'G-A': { [local.id]: local }, 'G-B': { [distant.id]: distant } });

    await relayPinsUpdate('G-A', link.sourceChannelId, client as never);

    expect(distant.messages.unpin).toHaveBeenCalledTimes(1);
    expect(distant.messages.unpin.mock.calls[0][0]).toBe('msg-copie');
  });

  test('ne touche pas aux messages épinglés que le pont n\'a jamais relayés', async () => {
    const link = makeLink();
    linkRows = [link];
    mappingRows = [];

    const local = makeChannel(link.sourceChannelId, []);
    // Épinglage propre au serveur d'en face : il ne regarde pas le pont.
    const distant = makeChannel(link.targetChannelId, ['annonce-locale']);
    const client = makeClient({ 'G-A': { [local.id]: local }, 'G-B': { [distant.id]: distant } });

    await relayPinsUpdate('G-A', link.sourceChannelId, client as never);

    expect(distant.messages.unpin).not.toHaveBeenCalled();
    expect(distant.messages.pin).not.toHaveBeenCalled();
  });

  test('ne désépingle rien quand la liste d\'en face est illisible', async () => {
    const link = makeLink();
    linkRows = [link];
    mappingRows = [
      {
        sourceMessageId: 'msg-origine',
        sourceChannelId: link.sourceChannelId,
        relayedMessageId: 'msg-copie',
        relayedChannelId: link.targetChannelId,
      },
    ];

    const local = makeChannel(link.sourceChannelId, ['msg-origine']);
    // Permission manquante : croire le salon vide reviendrait à tout décrocher.
    const distant = makeChannel(link.targetChannelId, 'illisible');
    const client = makeClient({ 'G-A': { [local.id]: local }, 'G-B': { [distant.id]: distant } });

    await relayPinsUpdate('G-A', link.sourceChannelId, client as never);

    expect(distant.messages.pin).not.toHaveBeenCalled();
    expect(distant.messages.unpin).not.toHaveBeenCalled();
  });

  test('laisse les épinglages tranquilles quand le lien ne les relaie pas', async () => {
    const link = makeLink({ relayPins: false });
    linkRows = [link];
    mappingRows = [
      {
        sourceMessageId: 'msg-origine',
        sourceChannelId: link.sourceChannelId as string,
        relayedMessageId: 'msg-copie',
        relayedChannelId: link.targetChannelId as string,
      },
    ];

    const local = makeChannel(link.sourceChannelId as string, ['msg-origine']);
    const distant = makeChannel(link.targetChannelId as string, []);
    const client = makeClient({ 'G-A': { [local.id]: local }, 'G-B': { [distant.id]: distant } });

    await relayPinsUpdate('G-A', link.sourceChannelId as string, client as never);

    expect(distant.messages.pin).not.toHaveBeenCalled();
  });

  test('un lien unidirectionnel ne remonte pas les épinglages de la destination', async () => {
    const link = makeLink({ direction: 'UNIDIRECTIONAL' });
    linkRows = [link];
    mappingRows = [
      {
        sourceMessageId: 'msg-origine',
        sourceChannelId: link.sourceChannelId as string,
        relayedMessageId: 'msg-copie',
        relayedChannelId: link.targetChannelId as string,
      },
    ];

    const local = makeChannel(link.targetChannelId as string, ['msg-copie']);
    const distant = makeChannel(link.sourceChannelId as string, []);
    const client = makeClient({ 'G-B': { [local.id]: local }, 'G-A': { [distant.id]: distant } });

    await relayPinsUpdate('G-B', link.targetChannelId as string, client as never);

    expect(distant.messages.pin).not.toHaveBeenCalled();
  });
});
