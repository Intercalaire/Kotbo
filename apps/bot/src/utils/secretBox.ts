import crypto from 'node:crypto';

/**
 * Chiffrement au repos des secrets que les serveurs nous confient (jeton et
 * secret OAuth d'un Custom Bot).
 *
 * La clé vient de `CUSTOM_BOT_ENCRYPTION_KEY`, à défaut de `JWT_SECRET`. Aucun
 * repli aléatoire : `instanceResolver` en tire un au démarrage quand
 * `JWT_SECRET` manque, et un secret chiffré avec lui deviendrait illisible au
 * redémarrage suivant. Sans clé, on refuse d'enregistrer plutôt que de stocker
 * en clair ou de perdre la donnée.
 *
 * Changer la clé rend les secrets déjà stockés illisibles : il faudra les
 * ressaisir.
 */

const PREFIX = 'enc:v1:';

export class SecretBoxUnavailableError extends Error {
  constructor() {
    super('Chiffrement indisponible : définir CUSTOM_BOT_ENCRYPTION_KEY ou JWT_SECRET.');
    this.name = 'SecretBoxUnavailableError';
  }
}

function key(): Buffer {
  const secret = process.env.CUSTOM_BOT_ENCRYPTION_KEY || process.env.JWT_SECRET;
  if (!secret) throw new SecretBoxUnavailableError();
  return crypto.createHash('sha256').update(`kotbo-secret-box:${secret}`).digest();
}

export function isSealed(value: string): boolean {
  return value.startsWith(PREFIX);
}

export function sealSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return `${PREFIX}${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${encrypted.toString('base64url')}`;
}

/**
 * Déchiffre une valeur stockée. Une valeur sans préfixe est un secret enregistré
 * en clair avant le chiffrement : elle est rendue telle quelle, et sera chiffrée
 * au prochain enregistrement. Retourne `null` si la valeur est illisible (clé
 * changée, donnée altérée).
 */
export function openSecret(stored: string): string | null {
  if (!isSealed(stored)) return stored;

  const [iv, tag, data] = stored.slice(PREFIX.length).split('.');
  if (!iv || !tag || !data) return null;

  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
  } catch (error) {
    if (error instanceof SecretBoxUnavailableError) throw error;
    return null;
  }
}
