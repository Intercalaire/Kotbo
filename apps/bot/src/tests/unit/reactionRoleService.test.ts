import { beforeEach, describe, expect, mock, test } from 'bun:test';
import path from 'node:path';
import { GuildMember, type ButtonInteraction, type Client } from 'discord.js';

const prismaMock = {
  reactionRoleMenu: {
    findFirst: mock(async () => null as Record<string, unknown> | null),
    findUnique: mock(async () => null as Record<string, unknown> | null),
    create: mock(async () => ({ id: 'menu-1' })),
    delete: mock(async () => ({})),
  },
};

// Le service résout la langue du serveur avant de répondre : sans ce cache
// neutralisé, la résolution retomberait sur l'anglais et les messages attendus
// ici ne seraient plus les bons.
const cacheMock = {
  cache: {
    get: mock(async () => null),
    set: mock(async () => undefined),
  },
  getCachedGuild: mock(async () => ({ language: 'fr' })),
  getCachedDashboardSettings: mock(async () => null),
};

for (const extension of ['ts', 'js']) {
  mock.module(path.resolve(import.meta.dir, `../../utils/db.${extension}`), () => ({
    default: prismaMock,
    prisma: prismaMock,
    prismaRead: prismaMock,
  }));
  mock.module(path.resolve(import.meta.dir, `../../utils/cache.${extension}`), () => cacheMock);
}

const {
  createReactionRoleMenu,
  deleteReactionRoleMenu,
  handleRoleToggleInteraction,
  normalizeButtonMode,
} = await import('../../services/features/reactionRoleService.js');

/**
 * `roles` est un accesseur sur le prototype de GuildMember : seul
 * `defineProperty` peut le remplacer, et le test a besoin d'un vrai
 * GuildMember car le service refuse les membres hors cache.
 */
function fakeMember(ownedRoleIds: string[]) {
  const member = Object.create(GuildMember.prototype) as GuildMember;
  const add = mock(async () => undefined);
  const remove = mock(async () => undefined);

  Object.defineProperty(member, 'roles', {
    value: {
      cache: new Map(ownedRoleIds.map((id) => [id, {}])),
      add,
      remove,
    },
    configurable: true,
  });

  return { member, add, remove };
}

function fakeInteraction(customId: string, member: GuildMember, reply: (...args: never[]) => unknown) {
  return {
    customId,
    guildId: 'guild-1',
    guildLocale: 'fr',
    message: { id: 'message-1' },
    member,
    reply,
  } as unknown as ButtonInteraction;
}

describe('reactionRoleService', () => {
  beforeEach(() => {
    prismaMock.reactionRoleMenu.findFirst.mockReset();
    prismaMock.reactionRoleMenu.findUnique.mockReset();
    prismaMock.reactionRoleMenu.create.mockReset();
    prismaMock.reactionRoleMenu.delete.mockReset();
  });

  test('supprime le menu en base et son message Discord', async () => {
    const deleteMessage = mock(async () => undefined);
    const fetchMessage = mock(async () => ({ delete: deleteMessage }));
    const channel = {
      isTextBased: () => true,
      messages: { fetch: fetchMessage },
    };
    const guild = {
      channels: {
        cache: { get: mock(() => channel) },
        fetch: mock(async () => channel),
      },
    };
    const client = {
      guilds: {
        cache: { get: mock(() => guild) },
        fetch: mock(async () => guild),
      },
    } as unknown as Client;

    prismaMock.reactionRoleMenu.findFirst.mockResolvedValueOnce({
      id: 'menu-1',
      guildId: 'guild-1',
      channelId: 'channel-1',
      messageId: 'message-1',
    });

    expect(await deleteReactionRoleMenu(client, 'guild-1', 'menu-1')).toBeTrue();
    expect(prismaMock.reactionRoleMenu.findFirst).toHaveBeenCalledWith({
      where: { id: 'menu-1', guildId: 'guild-1' },
    });
    expect(prismaMock.reactionRoleMenu.delete).toHaveBeenCalledWith({
      where: { id: 'menu-1' },
    });
    expect(fetchMessage).toHaveBeenCalledWith('message-1');
    expect(deleteMessage).toHaveBeenCalledTimes(1);
  });

  test('refuse les boutons d’un panneau qui n’existe plus', async () => {
    const reply = mock(async () => undefined);
    prismaMock.reactionRoleMenu.findFirst.mockResolvedValueOnce(null);

    const { member } = fakeMember([]);
    await handleRoleToggleInteraction(fakeInteraction('role_toggle:role-1:0', member, reply));

    expect(prismaMock.reactionRoleMenu.findFirst).toHaveBeenCalledWith({
      where: { guildId: 'guild-1', messageId: 'message-1' },
    });
    expect(reply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('plus actif'),
    }));
  });

  test('refuse un bouton dont le rôle n’est plus dans le menu', async () => {
    const reply = mock(async () => undefined);
    prismaMock.reactionRoleMenu.findFirst.mockResolvedValueOnce({
      id: 'menu-1',
      buttonMode: 'toggle',
      options: [{ label: 'Autre', roleId: 'role-2' }],
    });

    const { member, add, remove } = fakeMember([]);
    await handleRoleToggleInteraction(fakeInteraction('role_toggle:role-1:0', member, reply));

    expect(add).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect(reply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('plus actif'),
    }));
  });

  test('mode bascule : un second clic retire le rôle', async () => {
    const reply = mock(async () => undefined);
    prismaMock.reactionRoleMenu.findFirst.mockResolvedValueOnce({
      id: 'menu-1',
      buttonMode: 'toggle',
      options: [{ label: 'Annonces', roleId: 'role-1' }],
    });

    const { member, remove } = fakeMember(['role-1']);
    await handleRoleToggleInteraction(fakeInteraction('role_toggle:role-1:0', member, reply));

    expect(remove).toHaveBeenCalledWith('role-1');
    expect(reply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('retiré'),
    }));
  });

  test('mode attribution définitive : un second clic garde le rôle', async () => {
    const reply = mock(async () => undefined);
    prismaMock.reactionRoleMenu.findFirst.mockResolvedValueOnce({
      id: 'menu-1',
      buttonMode: 'add_only',
      options: [{ label: 'Annonces', roleId: 'role-1' }],
    });

    const { member, add, remove } = fakeMember(['role-1']);
    await handleRoleToggleInteraction(fakeInteraction('role_toggle:role-1:0', member, reply));

    expect(remove).not.toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled();
    expect(reply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('déjà'),
    }));
  });

  test('mode attribution définitive : le premier clic attribue le rôle', async () => {
    const reply = mock(async () => undefined);
    prismaMock.reactionRoleMenu.findFirst.mockResolvedValueOnce({
      id: 'menu-1',
      buttonMode: 'add_only',
      options: [{ label: 'Annonces', roleId: 'role-1' }],
    });

    const { member, add } = fakeMember([]);
    await handleRoleToggleInteraction(fakeInteraction('role_toggle:role-1:0', member, reply));

    expect(add).toHaveBeenCalledWith('role-1');
    expect(reply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('attribué'),
    }));
  });

  test('le mode du bouton l’emporte sur celui du panneau', async () => {
    const reply = mock(async () => undefined);
    prismaMock.reactionRoleMenu.findFirst.mockResolvedValueOnce({
      id: 'menu-1',
      buttonMode: 'toggle',
      options: [{ label: 'Annonces', roleId: 'role-1', mode: 'add_only' }],
    });

    const { member, remove } = fakeMember(['role-1']);
    await handleRoleToggleInteraction(fakeInteraction('role_toggle:role-1:0', member, reply));

    expect(remove).not.toHaveBeenCalled();
  });

  test('l’index du bouton distingue deux boutons portant le même rôle', async () => {
    const reply = mock(async () => undefined);
    prismaMock.reactionRoleMenu.findFirst.mockResolvedValueOnce({
      id: 'menu-1',
      buttonMode: 'toggle',
      options: [
        { label: 'Prendre', roleId: 'role-1', mode: 'add_only' },
        { label: 'Basculer', roleId: 'role-1' },
      ],
    });

    const { member, remove } = fakeMember(['role-1']);
    await handleRoleToggleInteraction(fakeInteraction('role_toggle:role-1:1', member, reply));

    expect(remove).toHaveBeenCalledWith('role-1');
  });

  test('un ancien bouton sans index reste géré', async () => {
    const reply = mock(async () => undefined);
    prismaMock.reactionRoleMenu.findFirst.mockResolvedValueOnce({
      id: 'menu-1',
      buttonMode: 'toggle',
      options: [{ label: 'Annonces', roleId: 'role-1' }],
    });

    const { member, remove } = fakeMember(['role-1']);
    await handleRoleToggleInteraction(fakeInteraction('role_toggle:role-1', member, reply));

    expect(remove).toHaveBeenCalledWith('role-1');
  });

  test('un mode inconnu retombe sur la bascule', () => {
    expect(normalizeButtonMode('mode-invente')).toBe('toggle');
    expect(normalizeButtonMode(undefined, 'add_only')).toBe('add_only');
    expect(normalizeButtonMode('add_only')).toBe('add_only');
  });

  test('n’écrit en base que les modes de bouton connus', async () => {
    prismaMock.reactionRoleMenu.create.mockResolvedValueOnce({ id: 'menu-1' });
    prismaMock.reactionRoleMenu.findUnique.mockResolvedValueOnce(null);

    const client = {
      guilds: {
        cache: { get: mock(() => undefined) },
        fetch: mock(async () => null),
      },
    } as unknown as Client;

    await createReactionRoleMenu(
      client,
      'guild-1',
      'channel-1',
      'Mes rôles',
      [
        { emoji: '', label: 'Annonces', roleId: 'role-1', mode: 'nawak' as never },
        { emoji: '📢', label: 'Events', roleId: 'role-2', mode: 'add_only' },
      ],
      'add_only',
    );

    expect(prismaMock.reactionRoleMenu.create).toHaveBeenCalledWith({
      data: {
        guildId: 'guild-1',
        channelId: 'channel-1',
        title: 'Mes rôles',
        buttonMode: 'add_only',
        options: [
          { label: 'Annonces', roleId: 'role-1' },
          { emoji: '📢', label: 'Events', roleId: 'role-2', mode: 'add_only' },
        ],
      },
    });
  });
});
