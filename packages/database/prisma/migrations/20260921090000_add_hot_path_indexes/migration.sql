-- Index manquants sur des tables qui grossissent avec l'usage.
--
-- Chacun de ces filtres provoquait jusqu'ici un parcours complet de la table,
-- tous serveurs confondus : le cout ne dependait pas du serveur consulte mais
-- du volume cumule de l'instance, et se degradait donc continuellement.
--
-- Les index sont crees sans CONCURRENTLY : Prisma execute chaque migration
-- dans une transaction, ce qui l'interdit. Les tables visees restent modestes
-- et la prise de verrou en ecriture est breve. Si l'une d'elles devenait
-- volumineuse, il faudrait la construire a la main, hors migration.

-- La liste des suggestions du tableau de bord : filtre sur le serveur, tri par date.
CREATE INDEX IF NOT EXISTS "suggestions_guildId_createdAt_idx"
  ON "suggestions"("guildId", "createdAt");

-- Re-rendu des panneaux de roles par reaction au demarrage.
CREATE INDEX IF NOT EXISTS "reaction_role_menus_guildId_idx"
  ON "reaction_role_menus"("guildId");

-- Liste des evenements d'un serveur, triee par date.
CREATE INDEX IF NOT EXISTS "events_guildId_createdAt_idx"
  ON "events"("guildId", "createdAt");

-- Participations d'un membre sur un serveur. La cle unique existante commence
-- par eventId et ne pouvait donc pas servir ce filtre.
CREATE INDEX IF NOT EXISTS "event_participants_guildId_userId_idx"
  ON "event_participants"("guildId", "userId");

-- Flux de contenu d'un serveur.
CREATE INDEX IF NOT EXISTS "feeds_guildId_idx"
  ON "feeds"("guildId");

-- Recherche du probleme deja tire pour une date, tous serveurs confondus.
-- La cle unique commence par guildId et ne pouvait pas la servir, alors que la
-- table gagne une ligne par serveur et par jour.
CREATE INDEX IF NOT EXISTS "daily_algo_runs_dateKey_idx"
  ON "daily_algo_runs"("dateKey");
