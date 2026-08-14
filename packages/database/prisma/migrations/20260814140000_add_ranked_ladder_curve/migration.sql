-- Réglages du générateur d'échelle de paliers : le dashboard pose une courbe
-- (nombre de paliers, écart de départ, élargissement, divisions) et le bot en
-- déduit l'échelle. Les valeurs par défaut décrivent une échelle proche de
-- l'échelle historique, mais ne la remplacent pas : `ladder` reste la source de
-- vérité tant qu'une courbe n'a pas été appliquée.
ALTER TABLE "ranked_configs"
  ADD COLUMN "ladderTierCount" INTEGER NOT NULL DEFAULT 19,
  ADD COLUMN "ladderBaseRp" INTEGER NOT NULL DEFAULT 250,
  ADD COLUMN "ladderExponent" DOUBLE PRECISION NOT NULL DEFAULT 1.35,
  ADD COLUMN "ladderDivisions" INTEGER NOT NULL DEFAULT 3;
