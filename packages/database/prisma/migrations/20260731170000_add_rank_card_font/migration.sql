-- Police du pseudo sur la carte `/rank`. Le défaut reprend la valeur de la
-- colonne du modèle : les lignes existantes gardent donc la police système,
-- c'est-à-dire exactement le rendu qu'elles avaient avant cette migration.
ALTER TABLE "rank_card_preferences"
  ADD COLUMN IF NOT EXISTS "fontId" TEXT NOT NULL DEFAULT 'default';
