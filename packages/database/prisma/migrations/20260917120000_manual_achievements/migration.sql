-- Succès attribués à la main depuis le panel admin : qui l'a donné et pourquoi.
ALTER TABLE "user_achievements"
  ADD COLUMN IF NOT EXISTS "grantedBy" TEXT,
  ADD COLUMN IF NOT EXISTS "note" TEXT;

-- Liste des détenteurs d'un succès : la clé primaire commence par "userId".
CREATE INDEX IF NOT EXISTS "user_achievements_achievementId_idx" ON "user_achievements"("achievementId");
