-- Alertes sur seuil et rapports planifiés d'Analytics.
CREATE TABLE IF NOT EXISTS "analytics_alert_rules" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "condition" TEXT NOT NULL,
    "threshold" DOUBLE PRECISION NOT NULL,
    "window" TEXT NOT NULL,
    "channelId" TEXT,
    "notifyChannelId" TEXT,
    "notifyUserIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "cooldownHours" INTEGER NOT NULL DEFAULT 24,
    "lastPeriodKey" TEXT,
    "lastTriggeredAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "analytics_alert_rules_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "analytics_alert_rules_guildId_idx" ON "analytics_alert_rules"("guildId");
CREATE INDEX IF NOT EXISTS "analytics_alert_rules_enabled_idx" ON "analytics_alert_rules"("enabled");
DO $$ BEGIN
    ALTER TABLE "analytics_alert_rules" ADD CONSTRAINT "analytics_alert_rules_guildId_fkey"
        FOREIGN KEY ("guildId") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "analytics_alert_events" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "periodKey" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "baseline" DOUBLE PRECISION,
    "delivered" BOOLEAN NOT NULL DEFAULT true,
    "triggeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "analytics_alert_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "analytics_alert_events_guildId_triggeredAt_idx" ON "analytics_alert_events"("guildId", "triggeredAt");
CREATE INDEX IF NOT EXISTS "analytics_alert_events_ruleId_triggeredAt_idx" ON "analytics_alert_events"("ruleId", "triggeredAt");
DO $$ BEGIN
    ALTER TABLE "analytics_alert_events" ADD CONSTRAINT "analytics_alert_events_ruleId_fkey"
        FOREIGN KEY ("ruleId") REFERENCES "analytics_alert_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "analytics_report_schedules" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "frequency" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL DEFAULT 1,
    "monthDay" INTEGER NOT NULL DEFAULT 1,
    "hour" INTEGER NOT NULL DEFAULT 9,
    "channelId" TEXT,
    "userIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sections" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "nextRunAt" TIMESTAMP(3) NOT NULL,
    "lastSentAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "analytics_report_schedules_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "analytics_report_schedules_guildId_idx" ON "analytics_report_schedules"("guildId");
CREATE INDEX IF NOT EXISTS "analytics_report_schedules_enabled_nextRunAt_idx" ON "analytics_report_schedules"("enabled", "nextRunAt");
DO $$ BEGIN
    ALTER TABLE "analytics_report_schedules" ADD CONSTRAINT "analytics_report_schedules_guildId_fkey"
        FOREIGN KEY ("guildId") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
