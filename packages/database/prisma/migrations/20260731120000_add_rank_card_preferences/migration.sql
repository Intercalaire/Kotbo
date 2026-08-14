-- Personnalisation de la carte `/rank`. Pas de colonne guildId ni de clé
-- étrangère vers "guilds" : la préférence appartient à l'utilisateur et le suit
-- sur tous les serveurs, seuls le niveau et l'XP affichés dessus restent lus
-- dans "member_levels" du serveur courant.
CREATE TABLE IF NOT EXISTS "rank_card_preferences" (
  "userId" TEXT NOT NULL,
  "backgroundId" TEXT NOT NULL DEFAULT 'default',
  "emojis" JSONB NOT NULL DEFAULT '[]',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "rank_card_preferences_pkey" PRIMARY KEY ("userId")
);
