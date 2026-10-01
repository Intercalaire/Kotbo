/**
 * Le dashboard en démonstration : le même code, sans back-end.
 *
 * Construit avec `VITE_DEMO=1` (voir `bun run build:demo`), le dashboard ne
 * parle à aucune API. Chaque appel est servi par `demo/backend.ts` à partir de
 * données fictives écrites à la main (`demo/fixtures.ts`), et chaque écriture
 * (sanctionner, régler un module, fermer un ticket) est gardée dans le
 * `localStorage` du visiteur. Rien ne quitte le navigateur.
 *
 * Ce drapeau est la seule chose que le reste du code consulte : il coupe ce
 * qui ne peut pas exister sans serveur (WebSocket, service worker, télémétrie,
 * remontée d'erreurs) et affiche le bandeau de démonstration.
 */
export const DEMO_MODE =
  import.meta.env.VITE_DEMO === '1' ||
  (typeof window !== 'undefined' && (window.location.pathname.startsWith('/demo') || window.location.port === '5199'));

/** Préfixe d'URL sous lequel la démo est servie (`/demo` sur kotbo.fr). */
export const DEMO_BASE = (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '');

/** Le serveur de démonstration. Un identifiant au format Discord : les routes publiques le testent. */
export const DEMO_GUILD_ID = '900000000000000001';
export const DEMO_GUILD_NAME = 'Atelier Nova';

/** La personne connectée : l'administrateur du serveur de démo. */
export const DEMO_USER_ID = '900000000000000101';
export const DEMO_USERNAME = 'toi';

/** Où mène « Ajouter Kotbo » depuis la démo. */
export const DEMO_INVITE_URL = 'https://api.kotbo.fr/api/public/invite?utm_source=landing&utm_content=demo';
