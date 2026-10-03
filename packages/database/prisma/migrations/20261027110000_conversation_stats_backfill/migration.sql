-- Frontière du rattrapage des stats de conversation : tout message antérieur à
-- NOW() n'a pas été vu par le suivi en direct. Seuls les serveurs qui
-- journalisent leurs messages ont un historique à relire.
ALTER TABLE "guilds" ADD COLUMN IF NOT EXISTS "conversationStatsBackfillStatus" JSONB;

UPDATE "guilds"
SET "conversationStatsBackfillStatus" = jsonb_build_object(
    'status', 'PENDING',
    'cutoff', to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
)
WHERE "messageLoggingEnabled" = true
  AND "conversationStatsBackfillStatus" IS NULL;
