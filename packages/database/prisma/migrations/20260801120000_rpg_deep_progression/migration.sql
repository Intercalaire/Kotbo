-- RPG « jeu profond » : classes, points de caractéristiques, accessoires,
-- amélioration d'équipement (forge) et artisanat.
--
-- Cette migration change aussi la SÉMANTIQUE de rpg_profiles.attack/defense/speed :
-- ces colonnes stockaient jusqu'ici les stats *effectives* (bonus d'équipement inclus,
-- appliqués par incréments à chaque équipement). Elles deviennent les stats de BASE,
-- les bonus étant désormais recalculés à la lecture. Le dernier bloc de ce fichier
-- retire donc, une fois pour toutes, les bonus déjà incorporés aux profils existants.

-- ── Profils : classe, points à répartir, accessoire, niveaux de forge ────────────
ALTER TABLE "rpg_profiles" ADD COLUMN IF NOT EXISTS "className" TEXT;
ALTER TABLE "rpg_profiles" ADD COLUMN IF NOT EXISTS "statPoints" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "rpg_profiles" ADD COLUMN IF NOT EXISTS "accessoryId" TEXT;
ALTER TABLE "rpg_profiles" ADD COLUMN IF NOT EXISTS "weaponUpgrade" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "rpg_profiles" ADD COLUMN IF NOT EXISTS "armorUpgrade" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "rpg_profiles" ADD COLUMN IF NOT EXISTS "accessoryUpgrade" INTEGER NOT NULL DEFAULT 0;

-- ── Objets : PV accordés + unicité du nom (indispensable aux recettes) ──────────
ALTER TABLE "rpg_items" ADD COLUMN IF NOT EXISTS "hpBonus" INTEGER NOT NULL DEFAULT 0;

-- Deux objets homonymes dans la même portée empêcheraient de résoudre une recette
-- ou un drop par nom : on déduplique avant de poser la contrainte.
-- NB : comme tout index unique Postgres, celui-ci ne contraint pas les lignes dont
-- `guildId` est NULL (objets globaux) - deux NULL sont considérés distincts. Le seed
-- s'en protège en relisant les noms existants et n'insérant que les manquants.
DELETE FROM "rpg_items" a
  USING "rpg_items" b
  WHERE a.ctid > b.ctid
    AND a."name" = b."name"
    AND a."guildId" IS NOT DISTINCT FROM b."guildId";

CREATE UNIQUE INDEX IF NOT EXISTS "rpg_items_guildId_name_key"
  ON "rpg_items" ("guildId", "name");
CREATE INDEX IF NOT EXISTS "rpg_items_guildId_type_idx"
  ON "rpg_items" ("guildId", "type");

-- ── Artisanat ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "rpg_recipes" (
  "id" TEXT NOT NULL,
  "guildId" TEXT,
  "resultItemId" TEXT NOT NULL,
  "ingredients" JSONB NOT NULL,
  "coinCost" INTEGER NOT NULL DEFAULT 0,
  "levelRequired" INTEGER NOT NULL DEFAULT 1,

  CONSTRAINT "rpg_recipes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "rpg_recipes_guildId_idx" ON "rpg_recipes" ("guildId");

DO $$
BEGIN
  ALTER TABLE "rpg_recipes"
    ADD CONSTRAINT "rpg_recipes_resultItemId_fkey"
    FOREIGN KEY ("resultItemId") REFERENCES "rpg_items" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "rpg_recipes"
    ADD CONSTRAINT "rpg_recipes_guildId_fkey"
    FOREIGN KEY ("guildId") REFERENCES "guilds" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Conversion des stats effectives en stats de base ────────────────────────────
-- On soustrait les bonus de l'arme et de l'armure actuellement portées, qui avaient
-- été ajoutés aux colonnes par l'ancien `equipInventoryItem`. Sans cela, les bonus
-- seraient comptés deux fois après le passage aux stats dérivées.
-- GREATEST(..., 1) protège contre une stat qui tomberait à zéro ou en négatif sur
-- des profils dont l'historique d'équipement aurait dérivé.
UPDATE "rpg_profiles" p
SET
  "attack"  = GREATEST(p."attack"  - COALESCE(w."atkBonus", 0) - COALESCE(a."atkBonus", 0), 1),
  "defense" = GREATEST(p."defense" - COALESCE(w."defBonus", 0) - COALESCE(a."defBonus", 0), 1),
  "speed"   = GREATEST(p."speed"   - COALESCE(w."spdBonus", 0) - COALESCE(a."spdBonus", 0), 1)
FROM "rpg_profiles" src
  LEFT JOIN "rpg_items" w ON w."id" = src."weaponId"
  LEFT JOIN "rpg_items" a ON a."id" = src."armorId"
WHERE src."id" = p."id"
  AND (src."weaponId" IS NOT NULL OR src."armorId" IS NOT NULL);

-- Les références d'équipement orphelines (objet supprimé) ne peuvent plus être
-- déduites : on les nettoie pour repartir sur un état cohérent.
UPDATE "rpg_profiles"
SET "weaponId" = NULL, "weaponUpgrade" = 0
WHERE "weaponId" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "rpg_items" i WHERE i."id" = "rpg_profiles"."weaponId");

UPDATE "rpg_profiles"
SET "armorId" = NULL, "armorUpgrade" = 0
WHERE "armorId" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "rpg_items" i WHERE i."id" = "rpg_profiles"."armorId");
