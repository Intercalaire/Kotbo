/**
 * Tests unitaires pour les fonctions pures d'Admin Permission Lock :
 * détection de la permission ADMINISTRATOR dans un bitfield, et résolution
 * du bypass (owner / rôles sécurité) indépendamment des objets discord.js.
 *
 * Importées depuis utils/adminLockPermissions.ts (et non adminLockService.ts)
 * pour éviter de tirer transitivement l'import de Prisma/DB dans ce test -
 * adminLockService.ts est réexporté depuis ce module pour les autres appelants.
 */

import { describe, it, expect } from 'bun:test';
import { PermissionsBitField } from 'discord.js';
import { roleGrantsAdministrator, isAdminLockBypassedCore } from '../../utils/adminLockPermissions.js';

describe('roleGrantsAdministrator', () => {
  it('retourne true pour un bitfield contenant uniquement Administrator', () => {
    expect(roleGrantsAdministrator(PermissionsBitField.Flags.Administrator)).toBe(true);
  });

  it('retourne true pour un bitfield combinant Administrator avec d\'autres permissions', () => {
    const bits = PermissionsBitField.Flags.Administrator | PermissionsBitField.Flags.ManageGuild | PermissionsBitField.Flags.KickMembers;
    expect(roleGrantsAdministrator(bits)).toBe(true);
  });

  it('retourne false pour un bitfield sans Administrator', () => {
    const bits = PermissionsBitField.Flags.ManageGuild | PermissionsBitField.Flags.KickMembers | PermissionsBitField.Flags.BanMembers;
    expect(roleGrantsAdministrator(bits)).toBe(false);
  });

  it('retourne false pour un bitfield vide', () => {
    expect(roleGrantsAdministrator(0n)).toBe(false);
  });
});

describe('isAdminLockBypassedCore', () => {
  const OWNER_ID = '111111111111111111';
  const OTHER_ID = '222222222222222222';
  const SECURITY_ROLE = '333333333333333333';
  const OTHER_ROLE = '444444444444444444';

  it('bypass le propriétaire du serveur inconditionnellement', () => {
    expect(isAdminLockBypassedCore(OWNER_ID, OWNER_ID, [], [])).toBe(true);
    expect(isAdminLockBypassedCore(OWNER_ID, OWNER_ID, [OTHER_ROLE], [])).toBe(true);
  });

  it("bypass un membre possédant un rôle 'sécurité'", () => {
    expect(isAdminLockBypassedCore(OTHER_ID, OWNER_ID, [SECURITY_ROLE], [SECURITY_ROLE])).toBe(true);
  });

  it("ne bypass pas un membre sans rôle 'sécurité' ni owner", () => {
    expect(isAdminLockBypassedCore(OTHER_ID, OWNER_ID, [OTHER_ROLE], [SECURITY_ROLE])).toBe(false);
  });

  it("ne bypass pas quand aucun rôle sécurité n'est configuré", () => {
    expect(isAdminLockBypassedCore(OTHER_ID, OWNER_ID, [OTHER_ROLE], [])).toBe(false);
  });

  it('un propriétaire configuré par erreur comme rôle sécurité ne casse pas le bypass des autres membres', () => {
    // Un rôle sécurité vide ou mal configuré ne doit jamais accidentellement bypasser un non-owner.
    expect(isAdminLockBypassedCore(OTHER_ID, OWNER_ID, [], [])).toBe(false);
  });
});
