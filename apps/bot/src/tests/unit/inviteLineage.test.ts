import { describe, expect, test } from 'bun:test';
import path from 'node:path';
import { mock } from 'bun:test';

// Le service importe Prisma au chargement ; seules les fonctions pures du
// graphe sont testées ici, la base n'est jamais touchée.
const mockDb = {
  memberInvite: { findMany: mock(() => Promise.resolve([] as unknown[])) },
  sanction: { findMany: mock(() => Promise.resolve([] as unknown[])) },
};

for (const dbPath of ['../../utils/db.ts', '../../utils/db.js']) {
  mock.module(path.resolve(__dirname, dbPath), () => ({
    default: mockDb,
    prisma: mockDb,
    prismaRead: mockDb,
  }));
}

import {
  buildInviteGraph,
  ancestorsOf,
  descendantsOf,
  inheritedTrustPenalty,
  type InviteEdge,
} from '../../services/moderation/inviteLineageService.js';

const AT = new Date('2026-01-01T00:00:00Z');

function edge(userId: string, inviterId: string | null, offsetDays = 0): InviteEdge {
  return {
    userId,
    inviterId,
    joinedAt: new Date(AT.getTime() + offsetDays * 86_400_000),
  };
}

/**
 * Arbre de test :
 *   root
 *   ├── a
 *   │   ├── a1
 *   │   └── a2
 *   │       └── a2x
 *   └── b
 */
const TREE: InviteEdge[] = [
  edge('root', null),
  edge('a', 'root', 1),
  edge('b', 'root', 1),
  edge('a1', 'a', 2),
  edge('a2', 'a', 2),
  edge('a2x', 'a2', 3),
];

describe('buildInviteGraph', () => {
  test('indexe les deux sens de la relation', () => {
    const graph = buildInviteGraph(TREE);
    expect(graph.inviterOf.get('a2x')).toBe('a2');
    expect(graph.invitedBy.get('a')?.sort()).toEqual(['a1', 'a2']);
    expect(graph.invitedBy.get('a2x')).toBeUndefined();
  });

  test('ignore un membre qui se serait invite lui-meme', () => {
    const graph = buildInviteGraph([edge('x', 'x')]);
    expect(graph.inviterOf.has('x')).toBe(false);
  });

  test('ignore les arrivees sans parrain connu', () => {
    const graph = buildInviteGraph([edge('x', null)]);
    expect(graph.inviterOf.size).toBe(0);
    expect(graph.joinedAt.has('x')).toBe(true);
  });
});

describe('ancestorsOf', () => {
  test('remonte la chaine du plus proche au plus lointain', () => {
    expect(ancestorsOf(buildInviteGraph(TREE), 'a2x')).toEqual(['a2', 'a', 'root']);
  });

  test('renvoie une chaine vide pour une racine', () => {
    expect(ancestorsOf(buildInviteGraph(TREE), 'root')).toEqual([]);
  });

  test('respecte la profondeur maximale', () => {
    expect(ancestorsOf(buildInviteGraph(TREE), 'a2x', 2)).toEqual(['a2', 'a']);
  });

  test('ne boucle pas sur un cycle', () => {
    // Deux comptes qui se parrainent mutuellement apres un depart/retour.
    const graph = buildInviteGraph([edge('x', 'y'), edge('y', 'x')]);
    expect(ancestorsOf(graph, 'x').length).toBeLessThanOrEqual(2);
  });
});

describe('descendantsOf', () => {
  test('parcourt toute la descendance avec sa profondeur', () => {
    const nodes = descendantsOf(buildInviteGraph(TREE), 'root');
    expect(nodes.map((n) => n.userId).sort()).toEqual(['a', 'a1', 'a2', 'a2x', 'b']);
    expect(nodes.find((n) => n.userId === 'a')?.depth).toBe(1);
    expect(nodes.find((n) => n.userId === 'a2x')?.depth).toBe(3);
  });

  test('conserve le parrain direct de chaque noeud', () => {
    const nodes = descendantsOf(buildInviteGraph(TREE), 'root');
    expect(nodes.find((n) => n.userId === 'a2x')?.inviterId).toBe('a2');
  });

  test('respecte la profondeur maximale', () => {
    const nodes = descendantsOf(buildInviteGraph(TREE), 'root', 1);
    expect(nodes.map((n) => n.userId).sort()).toEqual(['a', 'b']);
  });

  test('renvoie une liste vide pour une feuille', () => {
    expect(descendantsOf(buildInviteGraph(TREE), 'a2x')).toEqual([]);
  });

  test('ne boucle pas sur un cycle', () => {
    const graph = buildInviteGraph([edge('x', 'y'), edge('y', 'x')]);
    expect(descendantsOf(graph, 'x').length).toBeLessThanOrEqual(2);
  });
});

describe('inheritedTrustPenalty', () => {
  test('ne penalise pas une chaine saine', () => {
    const trust = inheritedTrustPenalty(['a', 'root'], new Set(['inconnu']));
    expect(trust.penalty).toBe(0);
    expect(trust.taintedBy).toBeNull();
  });

  test('penalise lourdement un parrain direct sanctionne', () => {
    const trust = inheritedTrustPenalty(['a2', 'a', 'root'], new Set(['a2']));
    expect(trust.penalty).toBe(60);
    expect(trust.taintedBy).toBe('a2');
    expect(trust.depth).toBe(1);
  });

  test('l influence decroit avec la distance', () => {
    const direct = inheritedTrustPenalty(['a2', 'a', 'root'], new Set(['a2'])).penalty;
    const grand = inheritedTrustPenalty(['a2', 'a', 'root'], new Set(['a'])).penalty;
    const great = inheritedTrustPenalty(['a2', 'a', 'root'], new Set(['root'])).penalty;
    expect(direct).toBeGreaterThan(grand);
    expect(grand).toBeGreaterThan(great);
  });

  test('retient l ancetre problematique le plus proche', () => {
    const trust = inheritedTrustPenalty(['a2', 'a', 'root'], new Set(['a', 'root']));
    expect(trust.taintedBy).toBe('a');
  });

  test('annule une penalite devenue negligeable', () => {
    // Au-dela de quelques niveaux, le lien de parrainage ne veut plus rien dire.
    const chain = ['n1', 'n2', 'n3', 'n4', 'n5', 'n6'];
    expect(inheritedTrustPenalty(chain, new Set(['n6'])).penalty).toBe(0);
  });
});
