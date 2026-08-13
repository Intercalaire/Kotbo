/**
 * Tests unitaires pour recordAndCheckBurst (tracker de rafale générique
 * utilisé par Admin Permission Lock - anti-rafale et coupe-circuit).
 */

import { describe, it, expect } from 'bun:test';
import { recordAndCheckBurst, resetBurst } from '../../utils/burstTracker.js';

describe('recordAndCheckBurst', () => {
  it("ne déclenche pas tant que la limite n'est pas dépassée", () => {
    const key = 'test:burst:1';
    resetBurst(key);
    const windows = [{ limit: 5, windowMs: 1000 }];
    let tripped = false;
    for (let i = 0; i < 5; i++) {
      tripped = recordAndCheckBurst(key, i * 100, windows);
    }
    expect(tripped).toBe(false);
  });

  it('déclenche au-delà de la limite dans la fenêtre', () => {
    const key = 'test:burst:2';
    resetBurst(key);
    const windows = [{ limit: 5, windowMs: 1000 }];
    let tripped = false;
    for (let i = 0; i < 6; i++) {
      tripped = recordAndCheckBurst(key, i * 100, windows);
    }
    expect(tripped).toBe(true);
  });

  it('ignore les occurrences hors de la fenêtre temporelle', () => {
    const key = 'test:burst:3';
    resetBurst(key);
    const windows = [{ limit: 2, windowMs: 1000 }];
    recordAndCheckBurst(key, 0, windows);
    recordAndCheckBurst(key, 100, windows);
    // Bien après la fenêtre des deux premières occurrences : ne doit pas les compter.
    recordAndCheckBurst(key, 5000, windows);
    const tripped = recordAndCheckBurst(key, 5100, windows);
    expect(tripped).toBe(false);
  });

  it("déclenche si n'importe laquelle des fenêtres fournies est dépassée (limite lente)", () => {
    const key = 'test:burst:4';
    resetBurst(key);
    // Fenêtre rapide jamais dépassée (espacement 10s > 1s), fenêtre lente dépassée (3 > 2 en 60s).
    const windows = [{ limit: 5, windowMs: 1000 }, { limit: 2, windowMs: 60000 }];
    let tripped = false;
    for (let i = 0; i < 3; i++) {
      tripped = recordAndCheckBurst(key, i * 10000, windows);
    }
    expect(tripped).toBe(true);
  });

  it('resetBurst réinitialise le compteur pour une clé', () => {
    const key = 'test:burst:5';
    resetBurst(key);
    const windows = [{ limit: 1, windowMs: 1000 }];
    recordAndCheckBurst(key, 0, windows);
    const trippedBeforeReset = recordAndCheckBurst(key, 100, windows);
    expect(trippedBeforeReset).toBe(true);

    resetBurst(key);
    const trippedAfterReset = recordAndCheckBurst(key, 200, windows);
    expect(trippedAfterReset).toBe(false);
  });

  it('des clés différentes ont des compteurs indépendants', () => {
    const keyA = 'test:burst:6a';
    const keyB = 'test:burst:6b';
    resetBurst(keyA);
    resetBurst(keyB);
    const windows = [{ limit: 1, windowMs: 1000 }];
    recordAndCheckBurst(keyA, 0, windows);
    recordAndCheckBurst(keyA, 100, windows);
    const trippedB = recordAndCheckBurst(keyB, 100, windows);
    expect(trippedB).toBe(false);
  });
});
