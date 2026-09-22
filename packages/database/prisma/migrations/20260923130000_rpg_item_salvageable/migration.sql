-- Démantèlement autorisé ou non, objet par objet.
ALTER TABLE "rpg_items" ADD COLUMN "salvageable" BOOLEAN NOT NULL DEFAULT true;
