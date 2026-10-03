-- Notes datées posées sur les courbes d'Analytics.
CREATE TABLE IF NOT EXISTS "analytics_annotations" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "dateKey" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "analytics_annotations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "analytics_annotations_guildId_dateKey_idx"
    ON "analytics_annotations"("guildId", "dateKey");

DO $$ BEGIN
    ALTER TABLE "analytics_annotations" ADD CONSTRAINT "analytics_annotations_guildId_fkey"
        FOREIGN KEY ("guildId") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
