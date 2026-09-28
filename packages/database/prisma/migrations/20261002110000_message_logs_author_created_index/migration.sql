-- Index ("guildId", "authorId", "createdAt") sur message_logs.
--
-- Deux lectures en profitent :
--  - le temps de reaction au ping (analytics avancees, section « social ») :
--    pour chaque mention, on cherche le premier message du membre mentionne
--    dans les 24 h qui suivent. Avec l'ancien index ("guildId", "authorId"),
--    chaque mention relisait tout l'historique du membre sur le serveur ;
--  - la liste des messages d'un membre dans sa fiche, triee par date.
--
-- L'ancien index en est un prefixe : il devient inutile et est supprime.
--
-- Cree sans CONCURRENTLY : Prisma execute chaque migration dans une
-- transaction, ce qui l'interdit. Pendant la construction, au deploiement, les
-- ecritures sur message_logs attendent : elles ne sont pas perdues.

CREATE INDEX IF NOT EXISTS "message_logs_guildId_authorId_createdAt_idx"
  ON "message_logs"("guildId", "authorId", "createdAt");

DROP INDEX IF EXISTS "message_logs_guildId_authorId_idx";
