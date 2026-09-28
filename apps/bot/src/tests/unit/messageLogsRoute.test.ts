import { describe, expect, test, mock, beforeEach } from 'bun:test';
import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import path from 'node:path';
import type { Client } from 'discord.js';
import { DASHBOARD_ACCESS_ADMIN, type AuthClaims } from '../../api/shared.js';

let storedRows: Array<{ id: string }> = [];
const mockFindMany = mock(async (args: { skip: number; take: number }) =>
  storedRows.slice(args.skip, args.skip + args.take),
);
const mockCount = mock(async (args: { take?: number }) =>
  args.take === undefined ? storedRows.length : Math.min(storedRows.length, args.take),
);
const mockDb = {
  messageLog: {
    findMany: mockFindMany,
    count: mockCount,
  },
};

for (const dbPath of ['../../utils/db.ts', '../../utils/db.js']) {
  mock.module(path.resolve(__dirname, dbPath), () => ({
    default: mockDb,
    prisma: mockDb,
    prismaRead: mockDb,
  }));
}

// Import après les mocks
const { handleMessageLogRoutes } = await import('../../api/routes/dashboard/messageLogs.js');

interface MockResponse extends ServerResponse {
  body: string;
}

function createMockResponse(): MockResponse {
  const socket = new Socket();
  const res = new ServerResponse(new IncomingMessage(socket)) as MockResponse;
  let _statusCode = 200;
  let _body = '';
  Object.defineProperty(res, 'statusCode', {
    get: () => _statusCode,
    set: (code: number) => {
      _statusCode = code;
    },
  });
  res.setHeader = () => res;
  res.getHeader = () => undefined;
  res.writeHead = (statusCode: number) => {
    _statusCode = statusCode;
    return res;
  };
  res.end = (chunk?: unknown) => {
    if (chunk) _body += String(chunk);
    res.body = _body;
    return res;
  };
  return res;
}

const mockClient = {} as Client;
const mockUser: AuthClaims = { userId: 'user-1', username: 'Admin' };

async function search(query: string) {
  const req = new IncomingMessage(new Socket());
  req.method = 'GET';
  const res = createMockResponse();
  const url = new URL(`http://localhost/api/dashboard/guilds/guild-1/message-logs/search?${query}`);
  const parts = ['api', 'dashboard', 'guilds', 'guild-1', 'message-logs', 'search'];
  await handleMessageLogRoutes(req, res, parts, url, mockClient, mockUser, 'guild-1', DASHBOARD_ACCESS_ADMIN);
  return { status: res.statusCode, body: JSON.parse(res.body) };
}

function seed(count: number) {
  storedRows = Array.from({ length: count }, (_, i) => ({ id: `m${i}` }));
}

describe('handleMessageLogRoutes - recherche', () => {
  beforeEach(() => {
    mockFindMany.mockClear();
    mockCount.mockClear();
  });

  test('annonce une page suivante sans la renvoyer', async () => {
    seed(30);
    const { status, body } = await search('limit=10');

    expect(status).toBe(200);
    expect(body.messages).toHaveLength(10);
    expect(body.hasMore).toBeTrue();
    expect(body.total).toBe(30);
    expect(body.totalCapped).toBeFalse();
  });

  test('ne signale plus de page suivante sur la derniere', async () => {
    seed(30);
    const { body } = await search('limit=10&offset=20');

    expect(body.messages).toHaveLength(10);
    expect(body.hasMore).toBeFalse();
  });

  test('plafonne le comptage au lieu de parcourir tous les resultats', async () => {
    seed(1500);
    const { body } = await search('limit=50');

    expect(mockCount).toHaveBeenCalledTimes(1);
    expect(mockCount.mock.calls[0][0].take).toBe(1001);
    expect(body.total).toBe(1000);
    expect(body.totalCapped).toBeTrue();
    expect(body.hasMore).toBeTrue();
  });
});
