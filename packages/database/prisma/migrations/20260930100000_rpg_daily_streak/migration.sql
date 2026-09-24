-- Série de récompenses journalières : jours de /daily réclamés d'affilée.
ALTER TABLE "rpg_profiles" ADD COLUMN "dailyStreak" INTEGER NOT NULL DEFAULT 0;
