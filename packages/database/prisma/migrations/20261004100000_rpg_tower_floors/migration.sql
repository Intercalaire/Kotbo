-- La Tour : plusieurs étages dessinés, part d'éclats gardée en partant, bilan différé.
ALTER TABLE "rpg_tower_configs" ADD COLUMN "layouts" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "rpg_tower_configs" ADD COLUMN "leaveShardPercent" INTEGER NOT NULL DEFAULT 80;
ALTER TABLE "rpg_tower_profiles" ADD COLUMN "pendingSettlement" JSONB;

-- L'ancienne carte unique devient le premier étage.
UPDATE "rpg_tower_configs" SET "layouts" = jsonb_build_array("layout") WHERE "layout" IS NOT NULL;
UPDATE "rpg_tower_configs" SET "layout" = NULL WHERE "layout" IS NOT NULL;

-- Les ascensions sur carte en cours comptaient une salle pour un étage. Elles sont closes
-- comme un départ, tous leurs éclats versés, sans toucher au record ni aux paliers qu'un
-- compte d'étages gonflé aurait faussés.
WITH closed AS (
  UPDATE "rpg_tower_runs"
  SET "status" = 'LEFT',
      "endedAt" = NOW(),
      "shardsEarned" = GREATEST(0, COALESCE(("state"->>'shards')::int, 0))
  WHERE "status" = 'ACTIVE' AND jsonb_typeof("state"->'map') = 'object'
  RETURNING "profileId", "shardsEarned"
)
UPDATE "rpg_tower_profiles" AS profile
SET "shards" = profile."shards" + closed_total.total,
    "lifetimeShards" = profile."lifetimeShards" + closed_total.total
FROM (SELECT "profileId", SUM("shardsEarned")::int AS total FROM closed GROUP BY "profileId") AS closed_total
WHERE profile."id" = closed_total."profileId";
