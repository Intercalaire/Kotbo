-- La Tour : réserve d'or de la source commune, partagée par tout le serveur.
ALTER TABLE "rpg_tower_configs" ADD COLUMN "fountainGold" INTEGER NOT NULL DEFAULT 0;
