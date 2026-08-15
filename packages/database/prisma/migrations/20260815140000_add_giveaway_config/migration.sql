-- Réglages des giveaways par serveur : rôles gestionnaires (création, clôture,
-- reroll, suppression) et rôles autorisés/exclus côté participation.
-- Les serveurs sans ligne gardent le comportement historique : seuls les
-- administrateurs et les porteurs de « Gérer les messages » pilotent les
-- concours, et tout le monde peut y participer.
CREATE TABLE "giveaway_configs" (
    "guildId" TEXT NOT NULL,
    "managerRoleIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "requiredRoleIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "blockedRoleIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "giveaway_configs_pkey" PRIMARY KEY ("guildId")
);

ALTER TABLE "giveaway_configs" ADD CONSTRAINT "giveaway_configs_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;
