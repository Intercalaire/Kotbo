-- La Tour : la limite d'achats d'un article peut se remettre à zéro chaque jour ou chaque semaine.
ALTER TABLE "rpg_tower_rewards" ADD COLUMN "limitPeriod" TEXT NOT NULL DEFAULT 'NEVER';
