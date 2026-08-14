-- Messages d'annonce du classement de prestige. `null` conserve le texte par
-- défaut traduit dans la langue du serveur : une guilde qui ne personnalise
-- rien ne voit donc aucun changement.
ALTER TABLE "ranked_configs"
  ADD COLUMN "announcePromotionMessage" TEXT,
  ADD COLUMN "announceDemotionMessage" TEXT;
