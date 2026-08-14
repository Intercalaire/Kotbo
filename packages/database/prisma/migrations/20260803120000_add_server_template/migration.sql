-- Mise en place guidée du serveur : l'horodatage porte le verrou « une seule
-- fois par serveur », l'auteur permet de dire à qui s'adresser quand un second
-- administrateur se voit refuser la création, et la liste des sections retient
-- ce qui a été coché pour que la page le rappelle après coup.
ALTER TABLE "guilds"
  ADD COLUMN IF NOT EXISTS "serverTemplateAppliedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "serverTemplateAppliedBy" TEXT,
  ADD COLUMN IF NOT EXISTS "serverTemplateSections" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS "serverTemplateRefs" JSONB;
