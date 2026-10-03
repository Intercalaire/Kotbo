-- La Tour : éclats en plus pour chaque salle résolue, pour récompenser l'exploration.
ALTER TABLE "rpg_tower_configs" ADD COLUMN "shardsPerRoom" INTEGER NOT NULL DEFAULT 0;
