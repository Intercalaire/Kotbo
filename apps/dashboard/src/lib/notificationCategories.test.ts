import { describe, expect, test } from 'bun:test';
import { categoryOf } from './notificationCategories';

describe('categoryOf', () => {
  test('lit la famille sur la page de destination', () => {
    expect(categoryOf('/procedures')).toBe('staff');
    expect(categoryOf('/staff-management/members')).toBe('staff');
    expect(categoryOf('/planning')).toBe('planning');
    expect(categoryOf('/absences')).toBe('planning');
    expect(categoryOf('/security/sanctions')).toBe('moderation');
    expect(categoryOf('/tickets/123')).toBe('tickets');
    expect(categoryOf('/partnerships')).toBe('partnerships');
  });

  test('sans lien ou lien inconnu : « Autres »', () => {
    expect(categoryOf(undefined)).toBe('general');
    expect(categoryOf('')).toBe('general');
    expect(categoryOf('/economy')).toBe('general');
  });

  test('un lien absolu se lit par son chemin', () => {
    expect(categoryOf('https://dashboard.kotbo.fr/tickets')).toBe('tickets');
    expect(categoryOf('pas une url')).toBe('general');
  });
});
