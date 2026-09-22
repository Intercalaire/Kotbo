-- Objets favoris du joueur, remontés en tête de l'inventaire.
ALTER TABLE "rpg_profiles" ADD COLUMN "favoriteItemIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
