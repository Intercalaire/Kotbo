-- Rappel de bump auto-detecte : un etat par serveur (introduit par 91394438
-- sans migration).

CREATE TABLE IF NOT EXISTS "bump_states" (
    "guildId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerLabel" TEXT NOT NULL,
    "lastBumpAt" TIMESTAMP(3) NOT NULL,
    "lastBumpUserId" TEXT,
    "lastChannelId" TEXT NOT NULL,
    "nextBumpAt" TIMESTAMP(3) NOT NULL,
    "reminded" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bump_states_pkey" PRIMARY KEY ("guildId")
);

CREATE INDEX IF NOT EXISTS "bump_states_nextBumpAt_reminded_idx" ON "bump_states"("nextBumpAt", "reminded");

DO $$ BEGIN
  ALTER TABLE "bump_states" ADD CONSTRAINT "bump_states_guildId_fkey"
    FOREIGN KEY ("guildId") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
