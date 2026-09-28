-- Télémétrie produit du dashboard : pages, modules, onglets consultés, temps
-- passé, enregistrements, erreurs. Agrégats par jour, jamais d'ID Discord en
-- clair (hash salé quotidien pour les visiteurs uniques).
CREATE TABLE IF NOT EXISTS "dashboard_telemetry_daily_stats" (
    "id" TEXT NOT NULL,
    "dateKey" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "page" TEXT NOT NULL,
    "tab" TEXT NOT NULL DEFAULT '',
    "feature" TEXT NOT NULL DEFAULT '',
    "event" TEXT NOT NULL,
    "dimension" TEXT NOT NULL DEFAULT '',
    "count" INTEGER NOT NULL DEFAULT 0,
    "valueSum" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dashboard_telemetry_daily_stats_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "dashboard_telemetry_daily_stats_key"
    ON "dashboard_telemetry_daily_stats"("dateKey", "guildId", "page", "tab", "feature", "event", "dimension");

CREATE INDEX IF NOT EXISTS "dashboard_telemetry_daily_stats_event_dateKey_idx"
    ON "dashboard_telemetry_daily_stats"("event", "dateKey");

CREATE INDEX IF NOT EXISTS "dashboard_telemetry_daily_stats_guildId_dateKey_idx"
    ON "dashboard_telemetry_daily_stats"("guildId", "dateKey");

CREATE TABLE IF NOT EXISTS "dashboard_telemetry_visitors" (
    "id" TEXT NOT NULL,
    "dateKey" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "visitorHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dashboard_telemetry_visitors_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "dashboard_telemetry_visitors_key"
    ON "dashboard_telemetry_visitors"("dateKey", "guildId", "scope", "visitorHash");

CREATE INDEX IF NOT EXISTS "dashboard_telemetry_visitors_dateKey_scope_idx"
    ON "dashboard_telemetry_visitors"("dateKey", "scope");
