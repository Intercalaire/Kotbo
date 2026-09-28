-- La Tour : brouillard réglable sur les étages générés.
ALTER TABLE "rpg_tower_configs" ADD COLUMN "generatedFog" BOOLEAN NOT NULL DEFAULT true;
