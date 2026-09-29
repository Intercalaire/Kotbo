-- RPG : énergie max propre à chaque joueur, au-dessus de celle du serveur, que la boutique
-- de la Tour peut vendre.
ALTER TABLE "rpg_profiles" ADD COLUMN "bonusMaxEnergy" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "rpg_tower_rewards" ADD COLUMN "maxEnergy" INTEGER NOT NULL DEFAULT 0;
