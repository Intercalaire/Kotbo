-- La Tour : les compétences du RPG s'achètent en éclats au départ d'une ascension.
ALTER TABLE "rpg_tower_configs" ADD COLUMN "skillPrice" INTEGER NOT NULL DEFAULT 10;
