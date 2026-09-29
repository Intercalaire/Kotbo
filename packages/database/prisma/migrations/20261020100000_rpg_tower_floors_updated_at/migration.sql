-- La Tour : date du dernier enregistrement des étages, pour ne relire les cartes qu'à leur changement.
ALTER TABLE "rpg_tower_configs" ADD COLUMN "floorsUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "rpg_clan_tower_configs" ADD COLUMN "floorsUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
