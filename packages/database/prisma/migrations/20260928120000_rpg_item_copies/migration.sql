-- Exemplaires forgés distincts des exemplaires ordinaires.
--
-- Avant : une seule progression par (profil, objet), partagée par toute la pile. Une épée
-- forgée à +2 rendait +2 toutes les épées ramassées ensuite. Après : chaque ligne désigne
-- UN exemplaire forgé ou enchanté, et le reste de la pile redevient ordinaire.
--
-- Aucun objet n'est retiré d'un inventaire : seule la progression cesse de s'étendre à
-- toute la pile. Elle reste sur un exemplaire, celui porté quand l'objet est équipé.

ALTER TABLE "rpg_item_instances" ADD COLUMN "equipped" BOOLEAN NOT NULL DEFAULT false;

DROP INDEX IF EXISTS "rpg_item_instances_rpgProfileId_itemId_key";
CREATE INDEX "rpg_item_instances_rpgProfileId_itemId_idx" ON "rpg_item_instances"("rpgProfileId", "itemId");

-- Un exemplaire sans forge ni enchantement est un exemplaire ordinaire : il n'a plus de ligne.
DELETE FROM "rpg_item_instances"
WHERE "upgrade" = 0 AND "enchants" = '[]'::jsonb;

-- Une progression dont l'objet a quitté l'inventaire ne désigne plus aucun exemplaire.
DELETE FROM "rpg_item_instances" AS i
WHERE NOT EXISTS (
    SELECT 1 FROM "rpg_inventory_items" AS inv
    WHERE inv."rpgProfileId" = i."rpgProfileId"
      AND inv."itemId" = i."itemId"
      AND inv."quantity" > 0
);

-- L'exemplaire forgé est celui que le joueur porte, quand l'objet est équipé.
UPDATE "rpg_item_instances" AS i
SET "equipped" = true
FROM "rpg_profiles" AS p
WHERE p."id" = i."rpgProfileId"
  AND i."itemId" IN (p."weaponId", p."armorId", p."accessoryId", p."accessory2Id", p."accessory3Id");
