-- Points de clan proportionnels à l'XP franchie plutôt que forfaitaires.
-- Désactivé par défaut : le barème d'un serveur ne doit pas changer sans que
-- son administrateur l'ait décidé, la bascule rendant les scores de la saison
-- en cours non comparables entre eux.
ALTER TABLE "guilds"
  ADD COLUMN IF NOT EXISTS "clanXpLevelUpProportional" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "clanXpReferenceLevel" INTEGER NOT NULL DEFAULT 25;
