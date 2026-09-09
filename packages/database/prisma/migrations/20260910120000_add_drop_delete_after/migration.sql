-- Suppression automatique des messages de drop terminés (0 = jamais).

ALTER TABLE "guilds" ADD COLUMN IF NOT EXISTS "dropDeleteAfterMinutes" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "drops" ADD COLUMN IF NOT EXISTS "deleteAfterMinutes" INTEGER NOT NULL DEFAULT 0;
