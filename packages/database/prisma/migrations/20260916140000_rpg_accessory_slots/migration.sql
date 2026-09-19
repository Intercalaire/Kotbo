-- Deux emplacements d'accessoire supplémentaires, débloqués au niveau.
-- `accessoryId` reste le premier emplacement : les profils existants gardent
-- l'accessoire qu'ils portaient, sans reprise de données.
ALTER TABLE "rpg_profiles"
  ADD COLUMN IF NOT EXISTS "accessory2Id" TEXT,
  ADD COLUMN IF NOT EXISTS "accessory3Id" TEXT;
