-- Traque d'une créature choisie : surcoûts réglés par serveur, et cible de chaque joueur.
ALTER TABLE "economy_configs" ADD COLUMN "huntEnergyPercent" INTEGER NOT NULL DEFAULT 150;
ALTER TABLE "economy_configs" ADD COLUMN "huntCooldownPercent" INTEGER NOT NULL DEFAULT 200;
ALTER TABLE "rpg_profiles" ADD COLUMN "trackedMonsterId" TEXT;
