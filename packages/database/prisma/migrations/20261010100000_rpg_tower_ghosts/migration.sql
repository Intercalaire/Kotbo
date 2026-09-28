-- La Tour : l'équipement d'un joueur tombé reste dans la salle, pour le premier qui la reprend.
ALTER TABLE "rpg_tower_runs" ADD COLUMN "ghostGear" JSONB;
ALTER TABLE "rpg_tower_runs" ADD COLUMN "ghostClaimedBy" TEXT;
