# Plan d'Action Technique - Kotbo Architecture Refonte

> Document de référence pour l'équipe de développement.
> Ancré sur le code actuel du repo au 2026-06-24.

---

## TABLE DES MATIERES

1. [Remédiation Sécurité - Quick Wins](#1-remédiation-sécurité--quick-wins)
2. [Remédiation Scalabilité](#2-remédiation-scalabilité)
3. [Spécification du Package `packages/database` (Repositories)](#3-spécification-du-package-packagesdatabase-repositories)
4. [Spécification du Package `packages/core`](#4-spécification-du-package-packagescore)
5. [Guide de Migration Progressif](#5-guide-de-migration-progressif)

---

## 1. Remédiation Sécurité - Quick Wins

### 1.1 CRITIQUE - Suppression des logs bruts dans `dashboardApi.ts`

**Fichier :** `apps/bot/src/api/dashboardApi.ts` (lignes 193-202)

Le code actuel écrit chaque requête legacy dans `scratch/debug_api.log` via `appendFileSync`. L'URL complète (qui peut contenir des tokens MCP dans le path) et le contexte de la requête sont loggés en clair.

**Correctif immédiat :**

```typescript
// apps/bot/src/api/dashboardApi.ts - remplacer le bloc logMsg
// AVANT (lignes 193-202) :
// const logFile = debugLogFile;
// const logMsg = (msg: string) => { appendFileSync(logFile, ...) };
// logMsg(`[Legacy] Request: ${request.method} ${request.url}`);

// APRÈS :
const logMsg = (msg: string) => {
  if (process.env.NODE_ENV !== 'production') {
    logger.debug('LegacyAPI', msg);
  }
};

// Sanitiser l'URL avant de logger : retirer les tokens, clés, et query params sensibles
const sanitizeUrl = (url: string): string => {
  return url
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]')
    .replace(/mcp_[a-f0-9]+/gi, 'mcp_[REDACTED]')
    .replace(/kotbo_ac_[A-Za-z0-9_-]+/gi, 'kotbo_ac_[REDACTED]')
    .replace(/kotbo_rt_[A-Za-z0-9_-]+/gi, 'kotbo_rt_[REDACTED]')
    .replace(/(token|key|secret|code)=([^&\s]+)/gi, '$1=[REDACTED]');
};

logMsg(`[Legacy] Request: ${request.method} ${sanitizeUrl(url.pathname + url.search)}`);
```

**Actions complémentaires :**
- Supprimer `scratch/debug_api.log` du repo (ajouter à `.gitignore`)
- Retirer l'import `appendFileSync` et la constante `debugLogFile`
- En production, tout logging passe par `pino` (structured JSON), jamais `appendFileSync`

---

### 1.2 HAUTE - Faille d'autorisation sur `/api/verify/:guildId/deploy`

**Fichier :** `apps/bot/src/api/routes/verify.ts` (lignes 228-267)

Le code actuel vérifie le JWT mais **ne vérifie jamais** que `claims.userId` a les droits admin/staff sur la `guildId` cible. N'importe quel utilisateur connecté peut déployer un embed de vérification sur n'importe quel serveur.

**Correctif immédiat :**

```typescript
// apps/bot/src/api/routes/verify.ts - POST /api/verify/:guildId/deploy
// Après la vérification JWT (ligne 238), AJOUTER :

const access = await resolveDashboardAccess(client, guildId, claims.userId);
if (!access || (access.level !== 'admin' && access.level !== 'moderator')) {
  json(res, 403, { error: 'Accès refusé - droits insuffisants sur ce serveur.' });
  return true;
}
```

Il faut importer `resolveDashboardAccess` depuis `../shared.js` (déjà utilisé dans les routes dashboard).

**Middleware Hono réutilisable (pour la migration) :**

```typescript
// apps/bot/src/api/hono/middleware/guildAccess.ts
import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';
import type { Client } from 'discord.js';

type AccessLevel = 'admin' | 'moderator' | 'viewer';

export const requireGuildAccess = (
  client: Client,
  minimumLevel: AccessLevel = 'moderator'
) =>
  createMiddleware(async (c, next) => {
    const auth = c.var.auth;
    const guildId = c.req.param('guildId');

    if (!guildId) {
      throw new HTTPException(400, { message: 'guildId manquant' });
    }

    const guild = client.guilds.cache.get(guildId);
    if (!guild) {
      throw new HTTPException(404, { message: 'Serveur introuvable ou bot non présent' });
    }

    // Vérifier que l'utilisateur est membre du serveur avec les bons droits
    const member = await guild.members.fetch(auth.userId).catch(() => null);
    if (!member) {
      throw new HTTPException(403, { message: 'Vous n\'êtes pas membre de ce serveur' });
    }

    const levelHierarchy: Record<AccessLevel, number> = {
      viewer: 0,
      moderator: 1,
      admin: 2,
    };

    const userLevel = resolveAccessLevel(member, guild);
    if (levelHierarchy[userLevel] < levelHierarchy[minimumLevel]) {
      throw new HTTPException(403, {
        message: `Accès refusé - niveau ${minimumLevel} requis`,
      });
    }

    c.set('guildAccess', { level: userLevel, guildId, member });
    await next();
  });

function resolveAccessLevel(
  member: import('discord.js').GuildMember,
  guild: import('discord.js').Guild
): AccessLevel {
  if (member.id === guild.ownerId) return 'admin';
  if (member.permissions.has('Administrator')) return 'admin';
  if (member.permissions.has('ManageGuild')) return 'admin';
  if (
    member.permissions.has('ModerateMembers') ||
    member.permissions.has('BanMembers') ||
    member.permissions.has('KickMembers')
  ) {
    return 'moderator';
  }
  return 'viewer';
}
```

---

### 1.3 HAUTE - Transcriptions publiques sans authentification

**Fichier :** `apps/bot/src/api/routes/public.ts` (ligne 579)

`GET /api/public/transcripts/:transcriptId` sert le HTML complet d'un ticket sans aucune vérification.

**Correctif : URL signée avec expiration**

```typescript
// packages/core/src/utils/signedUrl.ts
import crypto from 'node:crypto';

const SIGNING_SECRET = process.env.TRANSCRIPT_SIGNING_SECRET || process.env.JWT_SECRET!;

export function generateSignedTranscriptUrl(
  transcriptId: string,
  expiresInSeconds = 3600
): string {
  const expires = Math.floor(Date.now() / 1000) + expiresInSeconds;
  const payload = `${transcriptId}:${expires}`;
  const signature = crypto
    .createHmac('sha256', SIGNING_SECRET)
    .update(payload)
    .digest('hex');
  return `?expires=${expires}&sig=${signature}`;
}

export function verifyTranscriptSignature(
  transcriptId: string,
  expires: string,
  signature: string
): boolean {
  const expiresNum = parseInt(expires, 10);
  if (isNaN(expiresNum) || expiresNum < Math.floor(Date.now() / 1000)) {
    return false; // Expiré
  }
  const payload = `${transcriptId}:${expiresNum}`;
  const expected = crypto
    .createHmac('sha256', SIGNING_SECRET)
    .update(payload)
    .digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}
```

**Modifier la route :**

```typescript
// apps/bot/src/api/routes/public.ts - GET /api/public/transcripts/:transcriptId
const sig = url.searchParams.get('sig');
const expires = url.searchParams.get('expires');

if (!sig || !expires || !verifyTranscriptSignature(transcriptId, expires, sig)) {
  json(res, 403, { error: 'Lien invalide ou expiré. Demandez un nouveau lien.' });
  return true;
}
```

---

### 1.4 MOYENNE - Codes d'activation : atomicité et sécurité

**Fichier :** `apps/bot/src/utils/activation.ts` (lignes 39-66)

Deux problèmes :
1. **Race condition** : L'`update` du code et l'`upsert` du guild ne sont pas dans une transaction - deux guilds pourraient activer le même code simultanément.
2. **Stockage en clair** : Le code est stocké tel quel dans `guild.activationCode`.

**Correctif - Transaction atomique :**

```typescript
// apps/bot/src/utils/activation.ts
import crypto from 'node:crypto';

function hashActivationCode(code: string): string {
  return crypto.createHash('sha256').update(code).digest('hex');
}

export async function activateGuild(guildId: string, code: string): Promise<void> {
  const normalizedCode = code.trim().toUpperCase();

  await prisma.$transaction(async (tx) => {
    // 1. Verrouiller et vérifier le code atomiquement
    const activationCode = await tx.activationCode.findUnique({
      where: { code: normalizedCode },
    });

    if (!activationCode || !activationCode.isActive || activationCode.usedAt) {
      throw new Error('Code invalide, déjà utilisé ou expiré.');
    }

    // 2. Marquer le code comme utilisé
    await tx.activationCode.update({
      where: { code: normalizedCode },
      data: {
        usedAt: new Date(),
        usedByGuildId: guildId,
        isActive: false,
      },
    });

    // 3. Activer le guild (stocker le HASH, pas le code en clair)
    await tx.guild.upsert({
      where: { id: guildId },
      update: {
        activated: true,
        activatedAt: new Date(),
        activationCode: hashActivationCode(normalizedCode),
      },
      create: {
        id: guildId,
        activated: true,
        activatedAt: new Date(),
        activationCode: hashActivationCode(normalizedCode),
      },
    });
  });

  activatedGuilds.add(guildId);
  logger.success('Activation', `Serveur ${guildId} activé.`);
  // ... broadcast shards
}
```

> **Note migration :** Ajouter une migration Prisma pour les codes existants stockés en clair. Hasher les valeurs existantes en batch.

---

### 1.5 MOYENNE - Profils publics : opt-in explicite

**Fichier :** `apps/bot/src/api/hono/routes/public/profile.ts`

Le champ `isProfilePrivate` existe déjà dans `MemberProfile`. Vérifier que le comportement par défaut est **privé** (opt-in pour la visibilité publique) :

```typescript
// La requête actuelle doit renvoyer 404 si isProfilePrivate est true
// ET que le requester n'est ni l'utilisateur lui-même ni staff
if (profile.isProfilePrivate && (!auth || auth.userId !== userId)) {
  // Vérifier si le requester est staff avant de refuser
  const isStaff = auth ? await isUserStaffOnAnyGuild(auth.userId) : false;
  if (!isStaff) {
    return c.json({ error: 'Profil privé' }, 404);
  }
}
```

**Migration :** Passer le default Prisma de `@default(false)` à `@default(true)` pour que les nouveaux profils soient privés par défaut. Puis migration batch pour les profils existants.

---

### 1.6 MOYENNE - Tokens MCP : réduire la durée de vie et sortir du path

Les tokens MCP directs passés dans l'URL (`/api/mcp/:guildId/rpc?token=mcp_xxx`) fuient dans les logs des reverse proxies.

**Correctif :**
- **Forcer le header `Authorization: Bearer <token>`** au lieu du query param. Supprimer le support du token dans l'URL.
- **Réduire la durée de vie** : Access tokens à 1h, refresh tokens à 30 jours (au lieu de 90/180 jours).

```typescript
// apps/bot/src/api/mcp/mcpServer.ts - dans la section token endpoint
// Remplacer les durées actuelles :
const ACCESS_TOKEN_TTL_SECONDS = 3600;       // 1 heure (était implicitement plus long)
const REFRESH_TOKEN_TTL_SECONDS = 30 * 86400; // 30 jours (était 90/180)
```

---

### 1.7 BASSE - Rate Limiting sur les formulaires publics

Ajouter un rate limiter sur les routes `/api/public/*` qui acceptent du POST :

```typescript
// apps/bot/src/api/hono/middleware/rateLimit.ts - Ajouter :
import { createMiddleware } from 'hono/factory';

const publicFormLimiter = new Map<string, number[]>();
const PUBLIC_FORM_WINDOW_MS = 60_000;
const PUBLIC_FORM_MAX_REQUESTS = 5;

export const rateLimitPublicForms = createMiddleware(async (c, next) => {
  const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim()
    || c.req.header('x-real-ip')
    || 'unknown';

  const now = Date.now();
  const timestamps = publicFormLimiter.get(ip) ?? [];
  const valid = timestamps.filter((t) => now - t < PUBLIC_FORM_WINDOW_MS);

  if (valid.length >= PUBLIC_FORM_MAX_REQUESTS) {
    return c.json({ error: 'Trop de requêtes. Réessayez dans une minute.' }, 429);
  }

  valid.push(now);
  publicFormLimiter.set(ip, valid);
  await next();
});
```

---

## 2. Remédiation Scalabilité

### 2.1 Supprimer `fetchAllMembers()` - Pagination côté DB

**Fichier actuel :** `apps/bot/src/utils/discord.ts`

`fetchAllMembers()` charge **tous les membres d'un serveur en mémoire** via l'API Discord. Sur un serveur de 50k+ membres, cela explose la RAM et rate-limit l'API Discord.

**Stratégie :** La source de vérité pour la recherche doit être la **base de données** (`MemberProfile`), pas l'API Discord en temps réel. Les profils sont déjà synchronisés via les events `guildMemberAdd/Update/Remove`.

**Correctif pour `members/search` :**

```typescript
// packages/database/src/repositories/member.repository.ts
import type { Prisma, PrismaClient } from '@prisma/client';

export class MemberRepository {
  constructor(private readonly db: PrismaClient | Prisma.TransactionClient) {}

  async search(params: {
    guildId: string;
    query?: string;
    page: number;
    limit: number;
    sortBy: 'lastSeenAt' | 'messageCount' | 'guildJoinedAt';
    sortOrder: 'asc' | 'desc';
    serverStatus?: 'on_server' | 'left';
    botFilter?: 'include' | 'exclude' | 'only';
  }) {
    const where: Prisma.MemberProfileWhereInput = {
      guildId: params.guildId,
    };

    // Filtre recherche texte - utilise le trigram index si dispo
    if (params.query) {
      where.OR = [
        { username: { contains: params.query, mode: 'insensitive' } },
        { displayName: { contains: params.query, mode: 'insensitive' } },
        { userId: { startsWith: params.query } },
      ];
    }

    // Filtre statut serveur
    if (params.serverStatus === 'on_server') {
      where.leftAt = null;
    } else if (params.serverStatus === 'left') {
      where.leftAt = { not: null };
    }

    // Filtre bots
    if (params.botFilter === 'exclude') {
      where.isBot = false;
    } else if (params.botFilter === 'only') {
      where.isBot = true;
    }

    const [members, total] = await Promise.all([
      this.db.memberProfile.findMany({
        where,
        orderBy: { [params.sortBy]: params.sortOrder },
        skip: (params.page - 1) * params.limit,
        take: params.limit,
        select: {
          userId: true,
          username: true,
          displayName: true,
          avatarUrl: true,
          isBot: true,
          lastSeenAt: true,
          messageCount: true,
          guildJoinedAt: true,
          leftAt: true,
          xp: true,
          level: true,
        },
      }),
      this.db.memberProfile.count({ where }),
    ]);

    return {
      members,
      totalFound: total,
      totalPages: Math.ceil(total / params.limit),
      page: params.page,
    };
  }
}
```

**Index Prisma à ajouter :**

```prisma
// packages/database/prisma/guild.prisma - dans model MemberProfile
@@index([guildId, username])
@@index([guildId, lastSeenAt])
@@index([guildId, messageCount])
```

---

### 2.2 File d'attente pour le scraping historique

Le scraping de messages historiques doit passer par BullMQ avec concurrence contrôlée :

```typescript
// apps/bot/src/infra/queues/backgroundQueue.ts - Ajouter le job type :
export type BackgroundJobName =
  | /* ... existants ... */
  | 'history-scrape';

// Lors du lancement du scraping :
await backgroundQueue.add('history-scrape', {
  guildId,
  channelId,
  beforeMessageId,
}, {
  priority: 10, // Basse priorité
  attempts: 3,
  backoff: { type: 'exponential', delay: 5000 },
  removeOnComplete: 50,
});
```

**Concurrence globale :** Limiter à 1 job de scraping actif par guild via un `RateLimiter` BullMQ ou un sémaphore Redis.

---

### 2.3 Fallback Redis - Supprimer le fallback local

En environnement multi-shard, le fallback local BullMQ provoque des duplications de cron-jobs.

**Correctif :** Si Redis est down, les jobs doivent échouer proprement (pas de fallback silencieux). Ajouter un health check Redis au démarrage :

```typescript
// apps/bot/src/infra/redis.ts - Ajouter :
export async function assertRedisConnection(): Promise<void> {
  const client = getRedisClient();
  try {
    await client.ping();
  } catch (err) {
    throw new Error(
      `Redis indisponible - BullMQ ne peut pas démarrer sans Redis. ${String(err)}`
    );
  }
}
```

Appeler `assertRedisConnection()` dans le boot du bot, **avant** d'initialiser BullMQ.

---

### 2.4 Politique de rétention

Ajouter un cron-job BullMQ `data-retention` :

```typescript
// Exécuté quotidiennement
async function runDataRetention(guildId: string) {
  const retentionDays = 90; // Configurable par guild
  const cutoff = new Date(Date.now() - retentionDays * 86400_000);

  await prisma.$transaction([
    // Logs d'audit > 90 jours
    prisma.dashboardAuditLog.deleteMany({
      where: { guildId, dateIso: { lt: cutoff } },
    }),
    // Snapshots analytics > 90 jours
    prisma.analyticsSnapshot.deleteMany({
      where: { guildId, createdAt: { lt: cutoff } },
    }),
    // Messages historiques > 90 jours (garder les stats agrégées)
    prisma.message.deleteMany({
      where: { guildId, createdAt: { lt: cutoff } },
    }),
  ]);
}
```

---

## 3. Spécification du Package `packages/database` (Repositories)

### 3.1 Structure

```
packages/database/
├── prisma/
│   ├── schema.prisma          # Config generator/datasource
│   ├── guild.prisma           # (existe déjà)
│   ├── bot-admin.prisma       # (existe déjà)
│   └── migrations/
├── src/
│   ├── client.ts              # Export du PrismaClient singleton
│   ├── index.ts               # Barrel export
│   └── repositories/
│       ├── guild.repository.ts
│       ├── member.repository.ts
│       ├── verification.repository.ts
│       ├── ticket.repository.ts
│       ├── sanction.repository.ts
│       └── activation.repository.ts
├── package.json
└── tsconfig.json
```

### 3.2 Exemple complet : `guild.repository.ts`

```typescript
// packages/database/src/repositories/guild.repository.ts
import type { Prisma, PrismaClient, Guild } from '@prisma/client';

// Type pour supporter les transactions Prisma
type DbClient = PrismaClient | Prisma.TransactionClient;

// Select réutilisables - évite de dupliquer les champs dans chaque query
const GUILD_CONFIG_SELECT = {
  id: true,
  configChannelId: true,
  verificationEnabled: true,
  verificationMode: true,
  verificationAction: true,
  verificationChannelId: true,
  verificationRoleId: true,
  verificationLogChannelId: true,
  verificationEmbedTitle: true,
  verificationEmbedDesc: true,
  verificationEmbedColor: true,
  verificationOnJoin: true,
  activated: true,
  instanceId: true,
} as const satisfies Prisma.GuildSelect;

const GUILD_VERIFICATION_SELECT = {
  id: true,
  verificationEnabled: true,
  verificationMode: true,
  verificationAction: true,
  verificationChannelId: true,
  verificationRoleId: true,
  verificationLogChannelId: true,
  verificationEmbedTitle: true,
  verificationEmbedDesc: true,
  verificationEmbedColor: true,
  verificationOnJoin: true,
} as const satisfies Prisma.GuildSelect;

// Types inférés automatiquement des selects
export type GuildConfig = Prisma.GuildGetPayload<{
  select: typeof GUILD_CONFIG_SELECT;
}>;

export type GuildVerificationConfig = Prisma.GuildGetPayload<{
  select: typeof GUILD_VERIFICATION_SELECT;
}>;

export class GuildRepository {
  constructor(private readonly db: DbClient) {}

  async findById(guildId: string): Promise<Guild | null> {
    return this.db.guild.findUnique({ where: { id: guildId } });
  }

  async getConfig(guildId: string): Promise<GuildConfig | null> {
    return this.db.guild.findUnique({
      where: { id: guildId },
      select: GUILD_CONFIG_SELECT,
    });
  }

  async getVerificationConfig(
    guildId: string
  ): Promise<GuildVerificationConfig | null> {
    return this.db.guild.findUnique({
      where: { id: guildId },
      select: GUILD_VERIFICATION_SELECT,
    });
  }

  async upsert(
    guildId: string,
    data: Partial<Prisma.GuildCreateInput>
  ): Promise<Guild> {
    return this.db.guild.upsert({
      where: { id: guildId },
      update: data,
      create: { id: guildId, ...data },
    });
  }

  async isActivated(guildId: string): Promise<boolean> {
    const guild = await this.db.guild.findUnique({
      where: { id: guildId },
      select: { activated: true },
    });
    return guild?.activated ?? false;
  }

  async listActivatedIds(): Promise<string[]> {
    const guilds = await this.db.guild.findMany({
      where: { activated: true },
      select: { id: true },
    });
    return guilds.map((g) => g.id);
  }
}
```

### 3.3 Exemple : `verification.repository.ts` (avec transaction)

```typescript
// packages/database/src/repositories/verification.repository.ts
import type { Prisma, PrismaClient, SecurityVerification } from '@prisma/client';

type DbClient = PrismaClient | Prisma.TransactionClient;

export class VerificationRepository {
  constructor(private readonly db: DbClient) {}

  async findByToken(token: string): Promise<SecurityVerification | null> {
    return this.db.securityVerification.findFirst({
      where: {
        token,
        expiresAt: { gt: new Date() },
        completedAt: null,
      },
    });
  }

  async create(data: {
    guildId: string;
    userId: string;
    token: string;
    expiresAt: Date;
    ipAddress?: string;
  }): Promise<SecurityVerification> {
    return this.db.securityVerification.create({ data });
  }

  async markCompleted(
    id: string,
    verifiedDiscordId: string,
    ipAddress: string
  ): Promise<SecurityVerification> {
    return this.db.securityVerification.update({
      where: { id },
      data: {
        completedAt: new Date(),
        verifiedDiscordId,
        verificationIp: ipAddress,
      },
    });
  }

  async deleteExpired(): Promise<number> {
    const result = await this.db.securityVerification.deleteMany({
      where: { expiresAt: { lt: new Date() }, completedAt: null },
    });
    return result.count;
  }
}
```

### 3.4 Barrel export

```typescript
// packages/database/src/index.ts
export { prisma } from './client.js';
export { GuildRepository } from './repositories/guild.repository.js';
export { MemberRepository } from './repositories/member.repository.js';
export { VerificationRepository } from './repositories/verification.repository.js';
export { TicketRepository } from './repositories/ticket.repository.js';
export { SanctionRepository } from './repositories/sanction.repository.js';
export { ActivationRepository } from './repositories/activation.repository.js';

// Re-export Prisma types utiles
export type { Prisma, PrismaClient } from '@prisma/client';
```

---

## 4. Spécification du Package `packages/core`

### 4.1 Structure

```
packages/core/
├── src/
│   ├── index.ts
│   ├── ports/                     # Interfaces (contrats) pour les effets de bord
│   │   ├── discord.port.ts        # Abstraction des actions Discord
│   │   └── notification.port.ts   # Abstraction des notifications
│   ├── services/
│   │   ├── verification.service.ts
│   │   ├── ticket.service.ts
│   │   ├── sanction.service.ts
│   │   └── activation.service.ts
│   └── utils/
│       └── signedUrl.ts
├── package.json
└── tsconfig.json
```

### 4.2 Port Discord - Abstraction des effets de bord

Le `core` ne doit **jamais** importer `discord.js` directement. Il communique via un port (interface) :

```typescript
// packages/core/src/ports/discord.port.ts

export interface DiscordPort {
  sendEmbed(params: {
    channelId: string;
    title: string;
    description: string;
    color: string;
    components?: Array<{
      type: 'button';
      label: string;
      style: 'primary' | 'secondary' | 'link';
      customId?: string;
      url?: string;
    }>;
  }): Promise<{ messageId: string } | null>;

  fetchMember(
    guildId: string,
    userId: string
  ): Promise<{
    id: string;
    username: string;
    displayName: string;
    permissions: string[];
    roles: string[];
  } | null>;

  addRole(guildId: string, userId: string, roleId: string): Promise<boolean>;
  removeRole(guildId: string, userId: string, roleId: string): Promise<boolean>;

  getGuildInfo(guildId: string): Promise<{
    id: string;
    name: string;
    iconUrl: string | null;
    memberCount: number;
  } | null>;
}
```

### 4.3 Exemple complet : `VerificationService`

```typescript
// packages/core/src/services/verification.service.ts
import type { PrismaClient } from '@prisma/client';
import { GuildRepository } from '@kotbo/database';
import { VerificationRepository } from '@kotbo/database';
import type { DiscordPort } from '../ports/discord.port.js';
import crypto from 'node:crypto';

export interface DeployVerificationEmbedInput {
  guildId: string;
  channelId: string;
  dashboardUrl: string;
}

export interface DeployVerificationEmbedResult {
  success: boolean;
  error?: string;
}

export class VerificationService {
  private readonly guilds: GuildRepository;
  private readonly verifications: VerificationRepository;

  constructor(
    private readonly db: PrismaClient,
    private readonly discord: DiscordPort
  ) {
    this.guilds = new GuildRepository(db);
    this.verifications = new VerificationRepository(db);
  }

  async deployVerificationEmbed(
    input: DeployVerificationEmbedInput
  ): Promise<DeployVerificationEmbedResult> {
    // 1. Charger la config de vérification du serveur
    const config = await this.guilds.getVerificationConfig(input.guildId);
    if (!config) {
      return { success: false, error: 'Serveur introuvable.' };
    }
    if (!config.verificationEnabled) {
      return { success: false, error: 'La vérification n\'est pas activée.' };
    }

    // 2. Envoyer l'embed via le port Discord (pas de dépendance discord.js)
    const result = await this.discord.sendEmbed({
      channelId: input.channelId,
      title: config.verificationEmbedTitle,
      description: config.verificationEmbedDesc,
      color: config.verificationEmbedColor,
      components: [
        {
          type: 'button',
          label: '🔒 Vérifier mon identité',
          style: 'link',
          url: `${input.dashboardUrl}/verify/${input.guildId}`,
        },
      ],
    });

    if (!result) {
      return {
        success: false,
        error: 'Impossible d\'envoyer l\'embed dans ce salon.',
      };
    }

    return { success: true };
  }

  async initiateVerification(params: {
    guildId: string;
    userId: string;
    ipAddress?: string;
  }) {
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    return this.verifications.create({
      guildId: params.guildId,
      userId: params.userId,
      token,
      expiresAt,
      ipAddress: params.ipAddress,
    });
  }

  async completeVerification(params: {
    token: string;
    verifiedDiscordId: string;
    ipAddress: string;
    guildId: string;
  }) {
    const verification = await this.verifications.findByToken(params.token);
    if (!verification || verification.guildId !== params.guildId) {
      return { success: false, error: 'Session invalide ou expirée.' };
    }

    // Vérification anti-usurpation
    if (verification.userId !== params.verifiedDiscordId) {
      return {
        success: false,
        error: 'L\'identité Discord ne correspond pas.',
      };
    }

    await this.verifications.markCompleted(
      verification.id,
      params.verifiedDiscordId,
      params.ipAddress
    );

    // Assigner le rôle vérifié si configuré
    const config = await this.guilds.getVerificationConfig(params.guildId);
    if (config?.verificationRoleId) {
      await this.discord.addRole(
        params.guildId,
        params.verifiedDiscordId,
        config.verificationRoleId
      );
    }

    return { success: true };
  }
}
```

### 4.4 Adaptateur Discord (implémentation du port)

```typescript
// apps/bot/src/adapters/discord.adapter.ts
import {
  Client,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';
import type { DiscordPort } from '@kotbo/core';

const BUTTON_STYLE_MAP = {
  primary: ButtonStyle.Primary,
  secondary: ButtonStyle.Secondary,
  link: ButtonStyle.Link,
} as const;

export class DiscordAdapter implements DiscordPort {
  constructor(private readonly client: Client) {}

  async sendEmbed(params: Parameters<DiscordPort['sendEmbed']>[0]) {
    const channel = await this.client.channels
      .fetch(params.channelId)
      .catch(() => null);
    if (!channel?.isTextBased()) return null;

    const embed = new EmbedBuilder()
      .setTitle(params.title)
      .setDescription(params.description)
      .setColor(params.color as `#${string}`);

    const components: ActionRowBuilder<ButtonBuilder>[] = [];
    if (params.components?.length) {
      const row = new ActionRowBuilder<ButtonBuilder>();
      for (const comp of params.components) {
        const btn = new ButtonBuilder()
          .setLabel(comp.label)
          .setStyle(BUTTON_STYLE_MAP[comp.style]);
        if (comp.url) btn.setURL(comp.url);
        if (comp.customId) btn.setCustomId(comp.customId);
        row.addComponents(btn);
      }
      components.push(row);
    }

    const msg = await (channel as any)
      .send({ embeds: [embed], components })
      .catch(() => null);
    return msg ? { messageId: msg.id } : null;
  }

  async fetchMember(guildId: string, userId: string) {
    const guild = this.client.guilds.cache.get(guildId);
    if (!guild) return null;
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) return null;
    return {
      id: member.id,
      username: member.user.username,
      displayName: member.displayName,
      permissions: member.permissions.toArray(),
      roles: member.roles.cache.map((r) => r.id),
    };
  }

  async addRole(guildId: string, userId: string, roleId: string) {
    const guild = this.client.guilds.cache.get(guildId);
    if (!guild) return false;
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) return false;
    return member.roles.add(roleId).then(() => true).catch(() => false);
  }

  async removeRole(guildId: string, userId: string, roleId: string) {
    const guild = this.client.guilds.cache.get(guildId);
    if (!guild) return false;
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) return false;
    return member.roles.remove(roleId).then(() => true).catch(() => false);
  }

  async getGuildInfo(guildId: string) {
    const guild = await this.client.guilds.fetch(guildId).catch(() => null);
    if (!guild) return null;
    return {
      id: guild.id,
      name: guild.name,
      iconUrl: guild.iconURL({ size: 128 }),
      memberCount: guild.memberCount,
    };
  }
}
```

### 4.5 Appel unifié depuis l'API Hono ET le Bot Discord

**Depuis une route Hono (`apps/api` ou `apps/bot/src/api/hono`) :**

```typescript
// apps/bot/src/api/hono/routes/verification.ts
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { requireAuth } from '../middleware/auth.js';
import { requireGuildAccess } from '../middleware/guildAccess.js';
import { getVerificationService } from '../../serviceFactory.js';

const router = new OpenAPIHono();

const deployRoute = createRoute({
  method: 'post',
  path: '/api/verify/{guildId}/deploy',
  request: {
    params: z.object({ guildId: z.string() }),
    body: {
      content: { 'application/json': { schema: z.object({ channelId: z.string() }) } },
    },
  },
  responses: {
    200: { description: 'Embed déployé' },
    403: { description: 'Accès refusé' },
  },
});

router.use('/api/verify/:guildId/deploy', requireAuth);
router.use('/api/verify/:guildId/deploy', requireGuildAccess(client, 'moderator'));

router.openapi(deployRoute, async (c) => {
  const { guildId } = c.req.valid('param');
  const { channelId } = c.req.valid('json');

  const service = getVerificationService();
  const result = await service.deployVerificationEmbed({
    guildId,
    channelId,
    dashboardUrl: getDashboardUrl(),
  });

  if (!result.success) {
    return c.json({ error: result.error }, 400);
  }
  return c.json({ success: true }, 200);
});
```

**Depuis une commande Discord (`apps/bot`) :**

```typescript
// apps/bot/src/commands/moderation/deploy-verification.ts
import { SlashCommandBuilder, ChannelType } from 'discord.js';
import type { ChatInputCommandInteraction } from 'discord.js';
import { getVerificationService } from '../../serviceFactory.js';
import { getDashboardUrl } from '../../api/shared.js';

export const data = new SlashCommandBuilder()
  .setName('deploy-verification')
  .setDescription('Déploie l\'embed de vérification dans un salon')
  .addChannelOption((opt) =>
    opt
      .setName('salon')
      .setDescription('Le salon cible')
      .setRequired(true)
      .addChannelTypes(ChannelType.GuildText)
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  await interaction.deferReply({ ephemeral: true });

  const channel = interaction.options.getChannel('salon', true);

  // Même service, même logique métier
  const service = getVerificationService();
  const result = await service.deployVerificationEmbed({
    guildId: interaction.guildId!,
    channelId: channel.id,
    dashboardUrl: getDashboardUrl(),
  });

  if (!result.success) {
    await interaction.editReply({ content: `❌ ${result.error}` });
    return;
  }

  await interaction.editReply({
    content: `✅ Embed de vérification déployé dans <#${channel.id}>`,
  });
}
```

### 4.6 Service Factory (injection des dépendances)

```typescript
// apps/bot/src/serviceFactory.ts
import { PrismaClient } from '@prisma/client';
import { VerificationService } from '@kotbo/core';
import { DiscordAdapter } from './adapters/discord.adapter.js';
import prisma from './utils/db.js';
import { getClient } from './utils/client.js';

let verificationService: VerificationService | null = null;

export function getVerificationService(): VerificationService {
  if (!verificationService) {
    const client = getClient();
    const discord = new DiscordAdapter(client);
    verificationService = new VerificationService(prisma, discord);
  }
  return verificationService;
}

// Même pattern pour les autres services :
// export function getTicketService(): TicketService { ... }
// export function getSanctionService(): SanctionService { ... }
// export function getActivationService(): ActivationService { ... }
```

---

## 5. Guide de Migration Progressif

### Principes

1. **Zéro big-bang** : Migrer domaine par domaine, route par route. Le dual-stack Hono/Legacy existe déjà (`dashboardApi.ts` ligne 162-176) - l'exploiter.
2. **Tests comme filet** : Chaque service migré dans `core` doit avoir des tests unitaires avant d'être branché.
3. **Feature flags** : Pas nécessaire - le routeur Hono prend naturellement la priorité sur le legacy. Quand une route est migrée, elle "shadow" la legacy.

### Phase 0 - Fondations (1-2 jours)

```
✅ Créer packages/core/ avec package.json, tsconfig.json
✅ Créer packages/core/src/ports/discord.port.ts
✅ Créer apps/bot/src/adapters/discord.adapter.ts
✅ Créer apps/bot/src/serviceFactory.ts
✅ Ajouter @kotbo/core dans les workspaces du root package.json
✅ Appliquer les Quick Wins sécurité (§1.1, §1.2, §1.3)
```

### Phase 1 - Domaine `verification` (3-5 jours)

C'est le domaine le plus isolé et le plus critique (faille active).

```
1. Créer packages/database/src/repositories/verification.repository.ts
2. Créer packages/database/src/repositories/guild.repository.ts
3. Créer packages/core/src/services/verification.service.ts
4. Écrire les tests unitaires (mock du DiscordPort)
5. Brancher sur la route Hono POST /api/verify/:guildId/deploy
6. Brancher sur la commande Discord /deploy-verification
7. Migrer les routes GET /api/verify/:guildId/:token vers Hono
8. Migrer le callback OAuth vers Hono
9. Supprimer le handler legacy apps/bot/src/api/routes/verify.ts
```

### Phase 2 - Domaine `activation` (2-3 jours)

```
1. Créer packages/database/src/repositories/activation.repository.ts
2. Créer packages/core/src/services/activation.service.ts
3. Migrer apps/bot/src/utils/activation.ts vers le core
4. Ajouter la transaction atomique (§1.4)
5. Migrer la commande /activate vers le service core
```

### Phase 3 - Domaine `members` (3-5 jours)

Le plus impactant en termes de scalabilité.

```
1. Créer packages/database/src/repositories/member.repository.ts (§2.1)
2. Ajouter les index Prisma (§2.1)
3. Créer packages/core/src/services/member.service.ts
4. Migrer GET /api/dashboard/guilds/:guildId/members/search vers Hono
5. Supprimer l'appel à fetchAllMembers() dans la route search
6. Migrer les linked accounts vers le service core
```

### Phase 4 - Domaines `tickets`, `sanctions`, `analytics` (5-10 jours chacun)

Même pattern :
1. Repository → 2. Service Core → 3. Tests → 4. Route Hono → 5. Suppression legacy

### Phase 5 - Nettoyage final

```
- Supprimer apps/bot/src/api/routes/ (tout le dossier legacy)
- Supprimer le fallback legacy dans dashboardApi.ts
- Supprimer fetchAllMembers() de apps/bot/src/utils/discord.ts
- Supprimer scratch/debug_api.log et le mécanisme de debug logging
- Migrer le rate limiting in-memory vers Redis (pour multi-instance)
```

---

## Résumé des priorités

| Priorité | Action | Effort | Impact |
|----------|--------|--------|--------|
| P0 | Supprimer les logs bruts (`dashboardApi.ts`) | 30 min | Critique - fuite de secrets |
| P0 | Sécuriser `/api/verify/:guildId/deploy` | 30 min | Haute - IDOR |
| P0 | Signer les URLs de transcription | 2h | Haute - données exposées |
| P1 | Transaction atomique pour activation | 1h | Moyenne - race condition |
| P1 | Créer le middleware `requireGuildAccess` | 2h | Réutilisable partout |
| P1 | Pagination SQL pour member search | 3h | Haute - scalabilité |
| P2 | Créer `packages/core` + ports | 1 jour | Fondation architecture |
| P2 | Migrer domaine verification | 3-5 jours | Premier domaine complet |
| P3 | Politique de rétention | 1 jour | Scalabilité long terme |
| P3 | Health check Redis obligatoire | 1h | Fiabilité multi-shard |
