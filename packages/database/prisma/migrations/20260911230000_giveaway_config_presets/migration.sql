-- Sauvegardes nommees des reglages giveaway d'un serveur.
-- L'onglet Configuration n'ecrivait qu'une ligne par serveur : remplacer une
-- apparence effacait la precedente, sans moyen d'y revenir.

CREATE TABLE "giveaway_config_presets" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "settings" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "giveaway_config_presets_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "giveaway_config_presets_guildId_name_key" ON "giveaway_config_presets"("guildId", "name");

ALTER TABLE "giveaway_config_presets" ADD CONSTRAINT "giveaway_config_presets_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;
