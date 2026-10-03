import { describe, expect, test } from 'bun:test';
import {
  buildHfCommitsAlert,
  buildHfNewRepoAlert,
  huggingFaceUrl,
  normalizeHuggingFaceTarget,
  reposPublishedAfter,
} from '../../services/integrations/huggingFaceService';

describe('normalizeHuggingFaceTarget', () => {
  test('owner/nom pour un dépôt, nom seul pour un auteur', () => {
    expect(normalizeHuggingFaceTarget('meta-llama/Llama-3.1-8B', 'MODEL')).toEqual({ kind: 'MODEL', target: 'meta-llama/Llama-3.1-8B' });
    expect(normalizeHuggingFaceTarget('mistralai', 'AUTHOR')).toEqual({ kind: 'AUTHOR', target: 'mistralai' });
    expect(normalizeHuggingFaceTarget('@mistralai', 'AUTHOR')).toEqual({ kind: 'AUTHOR', target: 'mistralai' });
  });

  test("le type porté par l'URL l'emporte sur le type choisi", () => {
    expect(normalizeHuggingFaceTarget('https://huggingface.co/datasets/HuggingFaceFW/fineweb', 'MODEL'))
      .toEqual({ kind: 'DATASET', target: 'HuggingFaceFW/fineweb' });
    expect(normalizeHuggingFaceTarget('https://huggingface.co/spaces/owner/demo/tree/main', 'MODEL'))
      .toEqual({ kind: 'SPACE', target: 'owner/demo' });
    expect(normalizeHuggingFaceTarget('https://huggingface.co/openai/whisper-large-v3', 'AUTHOR'))
      .toEqual({ kind: 'MODEL', target: 'openai/whisper-large-v3' });
    expect(normalizeHuggingFaceTarget('https://huggingface.co/openai', 'MODEL'))
      .toEqual({ kind: 'AUTHOR', target: 'openai' });
  });

  test('refuse une saisie inexploitable', () => {
    expect(normalizeHuggingFaceTarget('', 'MODEL')).toBeNull();
    expect(normalizeHuggingFaceTarget('owner', 'MODEL')).toBeNull();
    expect(normalizeHuggingFaceTarget('a/b', 'AUTHOR')).toBeNull();
    expect(normalizeHuggingFaceTarget('a/b c', 'MODEL')).toBeNull();
  });
});

describe('huggingFaceUrl', () => {
  test('préfixe selon le type', () => {
    expect(huggingFaceUrl('MODEL', 'a/b')).toBe('https://huggingface.co/a/b');
    expect(huggingFaceUrl('DATASET', 'a/b')).toBe('https://huggingface.co/datasets/a/b');
    expect(huggingFaceUrl('SPACE', 'a/b')).toBe('https://huggingface.co/spaces/a/b');
  });
});

describe('reposPublishedAfter', () => {
  test("ne garde que les dépôts publiés après la référence, dans l'ordre d'annonce", () => {
    const entries = [
      { repo: { id: 'x/new2', createdAt: '2026-10-03T12:00:00Z' }, kind: 'MODEL' },
      { repo: { id: 'x/old', createdAt: '2026-09-01T00:00:00Z' }, kind: 'MODEL' },
      { repo: { id: 'x/new1', createdAt: '2026-10-02T12:00:00Z' }, kind: 'SPACE' },
      { repo: { id: 'x/nodate' }, kind: 'DATASET' },
    ];
    const fresh = reposPublishedAfter(entries, new Date('2026-10-01T00:00:00Z'), 5);
    expect(fresh.map((e) => e.repo.id)).toEqual(['x/new1', 'x/new2']);
    expect(reposPublishedAfter(entries, new Date('2026-10-01T00:00:00Z'), 1).map((e) => e.repo.id)).toEqual(['x/new2']);
  });
});

describe('alertes', () => {
  test('commits listés avec lien vers chaque commit', () => {
    const alert = buildHfCommitsAlert(
      { kind: 'DATASET', target: 'a/b', message: null },
      [{ id: 'abcdef123', title: 'Upload', authors: [{ user: 'alice' }] }],
    );
    expect(alert.content).toContain('dataset **a/b**');
    expect(alert.embeds[0]!.data.description).toContain('https://huggingface.co/datasets/a/b/commit/abcdef123');
  });

  test('nouveau dépôt d’un auteur', () => {
    const alert = buildHfNewRepoAlert({ target: 'mistralai', message: '[author] : [title] ([url])' }, { id: 'mistralai/new' }, 'MODEL');
    expect(alert.content).toBe('mistralai : mistralai/new (https://huggingface.co/mistralai/new)');
  });
});
