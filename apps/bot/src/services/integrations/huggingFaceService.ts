/**
 * Suivi Hugging Face : nouveaux commits d'un modèle, d'un dataset ou d'un
 * space, ou nouveaux dépôts publiés par un utilisateur ou une organisation.
 *
 * L'API publique du Hub répond sans authentification ; `HF_TOKEN`, s'il est
 * défini, relève simplement le quota.
 */
import { type Client } from 'discord.js';
import type { HuggingFaceFollow } from '@prisma/client';
import prisma from '../../utils/db.js';
import { baseEmbed, truncate } from '../../utils/embeds.js';
import { logger } from '../../utils/logger.js';
import { isModuleEnabled } from '../core/moduleGate.js';
import { sendFollowAlert } from './socialDelivery.js';
import { resolveFollowMessage } from './socialTemplates.js';
import { itemsSince, type FetchLike } from './githubService.js';

const HUB = 'https://huggingface.co';
const REQUEST_TIMEOUT_MS = 10_000;
const HF_COLOR = 0xffd21e;
const MAX_COMMITS_LISTED = 5;
const MAX_NEW_REPOS = 5;

export const HF_KINDS = ['MODEL', 'DATASET', 'SPACE', 'AUTHOR'] as const;
export type HuggingFaceKind = (typeof HF_KINDS)[number];
type RepoKind = Exclude<HuggingFaceKind, 'AUTHOR'>;

const API_SEGMENT: Record<RepoKind, string> = { MODEL: 'models', DATASET: 'datasets', SPACE: 'spaces' };
const KIND_LABEL: Record<RepoKind, string> = { MODEL: 'modèle', DATASET: 'dataset', SPACE: 'space' };

export type HfCommit = {
  id: string;
  title: string;
  message?: string;
  date?: string;
  authors?: Array<{ user: string; avatar?: string }>;
};

export type HfRepo = { id: string; createdAt?: string };

// ==================== HELPERS PURS ====================

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/;

/** Page web d'un dépôt ou d'un auteur. */
export function huggingFaceUrl(kind: HuggingFaceKind, target: string): string {
  if (kind === 'DATASET') return `${HUB}/datasets/${target}`;
  if (kind === 'SPACE') return `${HUB}/spaces/${target}`;
  return `${HUB}/${target}`;
}

/**
 * Lit une saisie : `owner/nom`, nom d'auteur, ou URL du Hub (dont le type
 * l'emporte sur celui choisi, une URL `datasets/…` désignant sans ambiguïté
 * un dataset). `null` si rien d'exploitable.
 */
export function normalizeHuggingFaceTarget(
  input: string,
  kind: HuggingFaceKind,
): { kind: HuggingFaceKind; target: string } | null {
  let value = input.trim();
  let resolvedKind = kind;

  const url = value.match(/huggingface\.co\/(?:(datasets|spaces)\/)?([^?#\s]+)/i);
  if (url) {
    // Les pages d'un dépôt (`/tree/main`, `/blob/…`) ne gardent que owner/nom.
    value = url[2]!.split('/').slice(0, 2).join('/');
    const prefix = url[1]?.toLowerCase();
    if (prefix === 'datasets') resolvedKind = 'DATASET';
    else if (prefix === 'spaces') resolvedKind = 'SPACE';
    // Sans préfixe, l'URL désigne un modèle, ou un auteur si elle s'arrête au nom.
    else resolvedKind = value.includes('/') ? 'MODEL' : 'AUTHOR';
  }
  value = value.replace(/^@/, '').replace(/\/+$/, '');

  const segments = value.split('/');
  if (resolvedKind === 'AUTHOR') {
    if (segments.length !== 1 || !NAME_RE.test(segments[0]!)) return null;
    return { kind: resolvedKind, target: segments[0]! };
  }
  if (segments.length !== 2 || !segments.every((s) => NAME_RE.test(s))) return null;
  return { kind: resolvedKind, target: value };
}

/** Date de création d'un dépôt en ms, 0 si l'API ne l'a pas fournie. */
function createdAtMs(repo: HfRepo): number {
  const time = repo.createdAt ? new Date(repo.createdAt).getTime() : NaN;
  return Number.isFinite(time) ? time : 0;
}

/**
 * Dépôts publiés après `since`, du plus ancien au plus récent (ordre d'annonce),
 * limités aux `max` plus récents.
 */
export function reposPublishedAfter<T extends { repo: HfRepo }>(entries: readonly T[], since: Date, max: number): T[] {
  return entries
    .filter(({ repo }) => createdAtMs(repo) > since.getTime())
    .sort((a, b) => createdAtMs(a.repo) - createdAtMs(b.repo))
    .slice(-max);
}

// ==================== HTTP ====================

async function hubGet<T>(path: string, fetchImpl: FetchLike): Promise<{ ok: true; data: T } | { ok: false; status: number }> {
  const headers: Record<string, string> = { Accept: 'application/json', 'User-Agent': 'Kotbo' };
  if (process.env.HF_TOKEN) headers.Authorization = `Bearer ${process.env.HF_TOKEN}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetchImpl(`${HUB}${path}`, { headers, signal: controller.signal });
    if (!res.ok) return { ok: false, status: res.status };
    const data = await res.json().catch(() => null) as T | null;
    return data === null ? { ok: false, status: res.status } : { ok: true, data };
  } catch (error) {
    logger.warn('HuggingFaceService', `Appel ${path} en échec : ${error instanceof Error ? error.message : String(error)}`);
    return { ok: false, status: 0 };
  } finally {
    clearTimeout(timeoutId);
  }
}

/** Vrai si le dépôt ou l'auteur existe et est public. */
export async function huggingFaceTargetExists(
  kind: HuggingFaceKind,
  target: string,
  fetchImpl: FetchLike = fetch,
): Promise<boolean> {
  if (kind === 'AUTHOR') {
    const user = await hubGet(`/api/users/${encodeURIComponent(target)}/overview`, fetchImpl);
    if (user.ok) return true;
    const org = await hubGet(`/api/organizations/${encodeURIComponent(target)}/overview`, fetchImpl);
    return org.ok;
  }
  return (await hubGet(`/api/${API_SEGMENT[kind]}/${target}`, fetchImpl)).ok;
}

// ==================== MESSAGES ====================

export function buildHfCommitsAlert(
  follow: Pick<HuggingFaceFollow, 'kind' | 'target' | 'message'>,
  commits: readonly HfCommit[],
) {
  const kind = follow.kind as RepoKind;
  const repoUrl = huggingFaceUrl(kind, follow.target);
  const latest = commits[0]!;
  const commitUrl = (c: HfCommit) => `${repoUrl}/commit/${c.id}`;
  const vars = { title: latest.title, channel: follow.target, url: commitUrl(latest), author: latest.authors?.[0]?.user ?? null };
  const fallback = commits.length === 1
    ? `🤗 Nouveau commit sur le ${KIND_LABEL[kind]} **${follow.target}**`
    : `🤗 ${commits.length} nouveaux commits sur le ${KIND_LABEL[kind]} **${follow.target}**`;

  const lines = commits.slice(0, MAX_COMMITS_LISTED).map((c) =>
    `[\`${c.id.slice(0, 7)}\`](${commitUrl(c)}) ${truncate(c.title, 80)}${c.authors?.[0] ? ` - ${c.authors[0].user}` : ''}`);
  if (commits.length > MAX_COMMITS_LISTED) lines.push(`… et ${commits.length - MAX_COMMITS_LISTED} autres`);

  const embed = baseEmbed(HF_COLOR)
    .setAuthor({ name: follow.target, url: repoUrl })
    .setTitle(truncate(`[${follow.target}] ${commits.length} commit${commits.length > 1 ? 's' : ''}`, 256))
    .setURL(commits.length === 1 ? commitUrl(latest) : `${repoUrl}/commits/main`)
    .setDescription(truncate(lines.join('\n'), 4000));
  return { content: resolveFollowMessage(follow.message, fallback, vars), embeds: [embed] };
}

export function buildHfNewRepoAlert(
  follow: Pick<HuggingFaceFollow, 'target' | 'message'>,
  repo: HfRepo,
  kind: RepoKind,
) {
  const url = huggingFaceUrl(kind, repo.id);
  const vars = { title: repo.id, channel: follow.target, url, author: follow.target };
  const embed = baseEmbed(HF_COLOR)
    .setAuthor({ name: follow.target, url: huggingFaceUrl('AUTHOR', follow.target) })
    .setTitle(truncate(repo.id, 256))
    .setURL(url)
    .setDescription(`Nouveau ${KIND_LABEL[kind]} publié sur Hugging Face.`);
  return {
    content: resolveFollowMessage(follow.message, `🤗 **${follow.target}** a publié un nouveau ${KIND_LABEL[kind]} : ${repo.id}`, vars),
    embeds: [embed],
  };
}

// ==================== BOUCLE PRINCIPALE ====================

type FollowWithGuild = HuggingFaceFollow & { guild: { publicChannelId: string | null } };

export async function checkHuggingFaceFollows(client: Client, fetchImpl: FetchLike = fetch): Promise<void> {
  try {
    const follows = await prisma.huggingFaceFollow.findMany({
      include: { guild: { select: { publicChannelId: true } } },
    }) as FollowWithGuild[];
    if (follows.length === 0) return;

    // Une requête par cible et par passage, quel que soit le nombre de serveurs.
    const memo = new Map<string, Promise<{ ok: true; data: unknown } | { ok: false; status: number }>>();
    const get = <T>(path: string) => {
      let pending = memo.get(path);
      if (!pending) {
        pending = hubGet<unknown>(path, fetchImpl);
        memo.set(path, pending);
      }
      return pending as Promise<{ ok: true; data: T } | { ok: false; status: number }>;
    };

    for (const follow of follows) {
      if (!(await isModuleEnabled(follow.guildId, 'social_networks'))) continue;
      const task = follow.kind === 'AUTHOR'
        ? processAuthorFollow(client, follow, get)
        : processRepoFollow(client, follow, get);
      await task.catch((error) =>
        logger.error('HuggingFaceService', `Suivi ${follow.kind} ${follow.target} (guilde ${follow.guildId}) en échec :`, error));
    }
  } catch (error) {
    logger.error('HuggingFaceService', 'Erreur pendant la vérification des suivis Hugging Face :', error);
  }
}

type HubGetter = <T>(path: string) => Promise<{ ok: true; data: T } | { ok: false; status: number }>;

async function processRepoFollow(client: Client, follow: FollowWithGuild, get: HubGetter): Promise<void> {
  const kind = follow.kind as RepoKind;
  if (!API_SEGMENT[kind]) return;

  const res = await get<HfCommit[]>(`/api/${API_SEGMENT[kind]}/${follow.target}/commits/main`);
  if (!res.ok || res.data.length === 0) return;

  const latest = res.data[0]!.id;
  if (follow.lastCommitId === latest) return;

  // Premier passage : on pose la référence sans annoncer l'historique.
  if (follow.lastCommitId) {
    const fresh = itemsSince(res.data, (c) => c.id === follow.lastCommitId);
    if (fresh.length > 0) {
      await sendFollowAlert(client, follow, follow.guild.publicChannelId, buildHfCommitsAlert(follow, fresh), 'HuggingFaceService');
    }
  }
  await prisma.huggingFaceFollow.update({ where: { id: follow.id }, data: { lastCommitId: latest } });
}

async function processAuthorFollow(client: Client, follow: FollowWithGuild, get: HubGetter): Promise<void> {
  const author = encodeURIComponent(follow.target);
  const kinds: RepoKind[] = ['MODEL', 'DATASET', 'SPACE'];
  const results = await Promise.all(kinds.map((kind) =>
    get<HfRepo[]>(`/api/${API_SEGMENT[kind]}?author=${author}&sort=createdAt&direction=-1&limit=10`)));
  // Une liste en échec fausserait la référence : on retentera au prochain passage.
  if (results.some((r) => !r.ok)) return;

  const all = kinds.flatMap((kind, i) => ((results[i] as { data: HfRepo[] }).data ?? []).map((repo) => ({ repo, kind })));
  const newest = all.reduce((acc, { repo }) => Math.max(acc, createdAtMs(repo)), 0);

  // Premier passage : on pose la référence sans annoncer les dépôts existants.
  if (!follow.lastCreatedAt) {
    await prisma.huggingFaceFollow.update({
      where: { id: follow.id },
      data: { lastCreatedAt: new Date(newest || Date.now()) },
    });
    return;
  }

  const fresh = reposPublishedAfter(all, follow.lastCreatedAt, MAX_NEW_REPOS);
  if (fresh.length === 0) return;

  for (const { repo, kind } of fresh) {
    await sendFollowAlert(client, follow, follow.guild.publicChannelId, buildHfNewRepoAlert(follow, repo, kind), 'HuggingFaceService');
  }
  await prisma.huggingFaceFollow.update({ where: { id: follow.id }, data: { lastCreatedAt: new Date(newest) } });
}
