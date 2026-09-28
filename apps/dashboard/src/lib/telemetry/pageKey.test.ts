import { describe, test, expect } from 'bun:test';
import { resolveTelemetryPage, telemetrySlug, type TelemetryPageRegistry } from './pageKey';

const registry: TelemetryPageRegistry = {
  pages: [
    { href: '/', featureKey: 'dashboard' },
    { href: '/security', featureKey: 'raid_protection' },
    { href: '/security/sanctions', featureKey: 'sanctions' },
    { href: '/inbox', featureKey: 'inbox' },
    { href: '/members', featureKey: 'members' },
    { href: '/billing' },
  ],
  tabs: {
    '/inbox': [{ id: 'tous' }, { id: 'modération' }],
  },
};

describe('resolveTelemetryPage', () => {
  test('le préfixe le plus long gagne', () => {
    expect(resolveTelemetryPage('/security/sanctions', registry)).toEqual({ page: '/security/sanctions', tab: '', feature: 'sanctions' });
    expect(resolveTelemetryPage('/security', registry)).toEqual({ page: '/security', tab: '', feature: 'raid_protection' });
  });

  test('un onglet déclaré est retenu, sans accent', () => {
    expect(resolveTelemetryPage('/inbox/mod%C3%A9ration', registry)).toEqual({ page: '/inbox', tab: 'moderation', feature: 'inbox' });
  });

  test('un segment inconnu (identifiant, jeton) est jeté', () => {
    expect(resolveTelemetryPage('/members/123456789012345678', registry)).toEqual({ page: '/members', tab: '', feature: 'members' });
    expect(resolveTelemetryPage('/inbox/123456789012345678/x', registry)?.tab).toBe('');
  });

  test('hors registre : rien', () => {
    expect(resolveTelemetryPage('/verify/1234/abcdef', registry)).toBeNull();
    expect(resolveTelemetryPage('/admin/analytics', registry)).toBeNull();
    // La racine ne capte pas tout le reste.
    expect(resolveTelemetryPage('/nimporte', registry)).toBeNull();
  });

  test('pages hors barre latérale et sans module', () => {
    expect(resolveTelemetryPage('/servers', registry)).toEqual({ page: '/servers', tab: '', feature: 'servers' });
    expect(resolveTelemetryPage('/billing/', registry)).toEqual({ page: '/billing', tab: '', feature: '' });
  });
});

describe('telemetrySlug', () => {
  test('forme acceptée par le bot', () => {
    expect(telemetrySlug('Administration Globale')).toBe('administration-globale');
    expect(telemetrySlug('Économie & RPG')).toBe('economie-rpg');
  });
});
