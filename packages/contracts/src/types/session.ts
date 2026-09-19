/**
 * Ce que le dashboard sait de la personne connectee et des serveurs qu'elle
 * peut ouvrir.
 *
 * Le store d'authentification tenait `user`, `member` et `guilds` en `any` :
 * ce sont pourtant les trois valeurs les plus lues de toute l'application, et
 * chaque ecran devinait ce qu'il pouvait en tirer. Une faute de frappe sur
 * `user.usernam` ne disait rien avant l'execution, et personne ne voyait
 * passer un champ que l'API avait cesse de rendre.
 */

/** Niveau d'acces d'un compte sur un serveur, tel que l'API le calcule. */
export type DashboardGuildAccessLevel = 'moderator' | 'admin';

/** Compte connecte, rendu par GET /api/user/me. */
export type SessionUser = {
  id: string;
  username: string;
  /** Hash de l'avatar Discord, absent si le compte n'en a pas. */
  avatar: string | null;
  /** Administrateur de l'instance, et non d'un serveur. */
  isBotAdmin?: boolean;
};

/**
 * Serveur ouvrable depuis le dashboard, rendu par GET /api/user/guilds.
 *
 * `botPresent` est toujours vrai dans cette liste : la route ne rend que des
 * serveurs ou le bot se trouve. Le champ subsiste parce que les ecrans
 * filtrent encore dessus.
 */
export type SessionGuild = {
  id: string;
  name: string;
  /** Hash de l'icone Discord, null si le serveur n'en a pas. */
  icon: string | null;
  owner: boolean;
  botPresent: boolean;
  accessLevel: DashboardGuildAccessLevel;
  /** Le serveur est le salon d'equipe rattache a un autre serveur. */
  isStaffServer: boolean;
  /** Serveur relie, quand celui-ci est un serveur d'equipe. */
  pairedGuildId: string | null;
  /** Le compte peut ouvrir la facturation de ce serveur. */
  billingAccess: boolean;
};

/** Role Discord tel que l'API le rend au dashboard. */
export type SessionRole = {
  id: string;
  name: string;
  /** Rang dans la hierarchie : le plus grand l'emporte. */
  position: number;
  /** Role pose par une integration, qu'aucun humain ne porte volontairement. */
  managed: boolean;
};

/** Appartenance de la personne connectee au serveur courant. */
export type SessionMember = {
  id: string;
  nickname: string | null;
  roles: SessionRole[];
  isTutor?: boolean;
};
