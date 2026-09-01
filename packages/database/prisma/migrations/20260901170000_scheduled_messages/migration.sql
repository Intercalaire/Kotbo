-- Messages programmes : nouveau type SEND_MESSAGE sur les taches planifiees.
-- La table, le runner cron et l'API existaient deja, seul le contenu manquait.
ALTER TABLE "scheduled_tasks" ADD COLUMN IF NOT EXISTS "message" TEXT;
ALTER TABLE "scheduled_tasks" ADD COLUMN IF NOT EXISTS "messageEmbed" JSONB;
-- Refus par defaut : une tache qui se repete ne doit pas pinger tout le serveur
-- sans que quelqu'un l'ait explicitement voulu.
ALTER TABLE "scheduled_tasks" ADD COLUMN IF NOT EXISTS "allowMentions" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "scheduled_tasks" ADD COLUMN IF NOT EXISTS "runOnce" BOOLEAN NOT NULL DEFAULT false;
