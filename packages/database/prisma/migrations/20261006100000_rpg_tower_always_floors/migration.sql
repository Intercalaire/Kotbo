-- La Tour : l'ascension du jour devient une option à activer, désactivée par défaut.
ALTER TABLE "rpg_tower_configs" ALTER COLUMN "dailyEnabled" SET DEFAULT false;
UPDATE "rpg_tower_configs" SET "dailyEnabled" = false;

-- Les étages se jouent toujours : l'ancien interrupteur « carte jouée » est levé partout.
-- Une tour sans étage dessiné génère les siens.
UPDATE "rpg_tower_configs" SET "layoutEnabled" = true;
