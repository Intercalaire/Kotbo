-- Délai de première réponse aux tickets : premier message d'une autre personne
-- que l'auteur. Les tickets antérieurs restent sans valeur (non mesurés).
ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "firstResponseAt" TIMESTAMP(3);
ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "firstResponderId" TEXT;
