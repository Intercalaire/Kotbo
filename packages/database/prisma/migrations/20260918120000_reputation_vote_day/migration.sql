-- Un vote de réputation par donneur, receveur et jour du serveur.
ALTER TABLE "reputation_votes" ADD COLUMN IF NOT EXISTS "day" TEXT;

UPDATE "reputation_votes" rv
SET "day" = to_char((rv."createdAt" AT TIME ZONE 'UTC') AT TIME ZONE (
  CASE WHEN g."timezone" IN (SELECT "name" FROM pg_timezone_names) THEN g."timezone" ELSE 'Europe/Paris' END
), 'YYYY-MM-DD')
FROM "guilds" g
WHERE g."id" = rv."guildId" AND rv."day" IS NULL;

UPDATE "reputation_votes"
SET "day" = to_char("createdAt", 'YYYY-MM-DD')
WHERE "day" IS NULL;

-- Les doublons nés de votes simultanés empêcheraient l'index unique : on garde le plus ancien.
DELETE FROM "reputation_votes" rv
USING "reputation_votes" older
WHERE rv."guildId" = older."guildId"
  AND rv."giverId" = older."giverId"
  AND rv."receiverId" = older."receiverId"
  AND rv."day" = older."day"
  AND (rv."createdAt", rv."id") > (older."createdAt", older."id");

ALTER TABLE "reputation_votes" ALTER COLUMN "day" SET NOT NULL;

DROP INDEX IF EXISTS "reputation_votes_guildId_giverId_receiverId_createdAt_key";
DROP INDEX IF EXISTS "reputation_votes_guildId_giverId_createdAt_idx";

CREATE UNIQUE INDEX IF NOT EXISTS "reputation_votes_guildId_giverId_receiverId_day_key" ON "reputation_votes"("guildId", "giverId", "receiverId", "day");
CREATE INDEX IF NOT EXISTS "reputation_votes_guildId_giverId_day_idx" ON "reputation_votes"("guildId", "giverId", "day");
