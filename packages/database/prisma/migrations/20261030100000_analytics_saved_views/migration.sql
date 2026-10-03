-- Vues enregistrées d'Analytics (onglet, période, filtres, comparaison).
CREATE TABLE IF NOT EXISTS "analytics_saved_views" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "shared" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "analytics_saved_views_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "analytics_saved_views_guildId_userId_idx" ON "analytics_saved_views"("guildId", "userId");
DO $$ BEGIN
    ALTER TABLE "analytics_saved_views" ADD CONSTRAINT "analytics_saved_views_guildId_fkey"
        FOREIGN KEY ("guildId") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
