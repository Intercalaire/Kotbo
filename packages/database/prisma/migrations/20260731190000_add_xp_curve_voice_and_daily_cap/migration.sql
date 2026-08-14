-- Courbe d'XP configurable. Les valeurs par défaut reprennent la formule
-- historique codée en dur (100 * niveau^2 + 200 * niveau) : les guildes
-- existantes gardent exactement la progression qu'elles avaient.
ALTER TABLE "level_configs"
  ADD COLUMN IF NOT EXISTS "curveBaseXp" INTEGER NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS "curveLinearXp" INTEGER NOT NULL DEFAULT 200,
  ADD COLUMN IF NOT EXISTS "curveExponent" DOUBLE PRECISION NOT NULL DEFAULT 2.0,
  ADD COLUMN IF NOT EXISTS "maxLevel" INTEGER NOT NULL DEFAULT 0;

-- Conditions d'XP vocale. `voiceRequireUnmuted` et `voiceRequireUndeafened`
-- valent true par défaut : c'était le comportement en dur de la boucle vocale.
ALTER TABLE "level_configs"
  ADD COLUMN IF NOT EXISTS "voiceRequireUnmuted" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "voiceRequireUndeafened" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "voiceIgnoreAfkChannel" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "voiceMinMembers" INTEGER NOT NULL DEFAULT 1;

-- Plafond d'XP quotidien, désactivé par défaut.
ALTER TABLE "level_configs"
  ADD COLUMN IF NOT EXISTS "dailyXpCap" INTEGER NOT NULL DEFAULT 0;

-- Compteur du plafond, porté par la ligne du membre : elle est déjà écrite à
-- chaque gain d'XP et a la même cardinalité qu'une table dédiée, qui aurait
-- demandé sa propre purge. `dailyXpDate` est le jour UTC auquel `dailyXp` se
-- rapporte ; laissé à NULL, le compteur est considéré comme périmé.
ALTER TABLE "member_levels"
  ADD COLUMN IF NOT EXISTS "dailyXp" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "dailyXpDate" TEXT;
