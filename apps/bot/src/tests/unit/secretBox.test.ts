import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { SecretBoxUnavailableError, isSealed, openSecret, sealSecret } from '../../utils/secretBox.js';

const saved = {
  key: process.env.CUSTOM_BOT_ENCRYPTION_KEY,
  jwt: process.env.JWT_SECRET,
};

function restore(name: 'CUSTOM_BOT_ENCRYPTION_KEY' | 'JWT_SECRET', value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

describe('chiffrement des secrets', () => {
  beforeEach(() => {
    process.env.CUSTOM_BOT_ENCRYPTION_KEY = 'cle-de-test';
  });

  afterEach(() => {
    restore('CUSTOM_BOT_ENCRYPTION_KEY', saved.key);
    restore('JWT_SECRET', saved.jwt);
  });

  test('rend la valeur d\'origine sans la stocker en clair', () => {
    const sealed = sealSecret('MTIz.token.secret');
    expect(isSealed(sealed)).toBe(true);
    expect(sealed).not.toContain('MTIz.token.secret');
    expect(openSecret(sealed)).toBe('MTIz.token.secret');
  });

  test('deux chiffrements du même secret diffèrent', () => {
    expect(sealSecret('abc')).not.toBe(sealSecret('abc'));
  });

  test('laisse passer un secret enregistré en clair avant le chiffrement', () => {
    expect(openSecret('ancien-token-en-clair')).toBe('ancien-token-en-clair');
  });

  test('une valeur altérée ou chiffrée avec une autre clé est illisible', () => {
    const sealed = sealSecret('abc');
    const [head, tag, data] = sealed.split('.');
    // Le premier caractère base64 porte les bits de tête du premier octet :
    // le changer modifie forcément le chiffré.
    const tampered = `${head}.${tag}.${data[0] === 'A' ? 'B' : 'A'}${data.slice(1)}`;
    expect(openSecret(tampered)).toBeNull();

    process.env.CUSTOM_BOT_ENCRYPTION_KEY = 'autre-cle';
    expect(openSecret(sealed)).toBeNull();
  });

  test('retombe sur JWT_SECRET sans clé dédiée', () => {
    delete process.env.CUSTOM_BOT_ENCRYPTION_KEY;
    process.env.JWT_SECRET = 'jwt-de-test';
    expect(openSecret(sealSecret('abc'))).toBe('abc');
  });

  test('refuse de chiffrer sans aucune clé plutôt que de stocker en clair', () => {
    delete process.env.CUSTOM_BOT_ENCRYPTION_KEY;
    delete process.env.JWT_SECRET;
    expect(() => sealSecret('abc')).toThrow(SecretBoxUnavailableError);
  });
});
