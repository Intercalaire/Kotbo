/**
 * Acces sur aux valeurs levees.
 *
 * Le contenu a rejoint @kotbo/shared : le dashboard en avait le meme besoin et
 * annotait ses `catch` en `any` faute de l'avoir sous la main. Ce fichier ne
 * fait plus que reexporter, les quelque cent modules qui importent
 * 'utils/errors.js' restent inchanges.
 */
export { errorMessage, errorStack, errorCode, errorStatus } from '@kotbo/shared';
