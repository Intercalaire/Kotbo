-- Salon qui relaie en direct les gains de points de clan, comme le flux public
-- des pages clan et clan-rpg. Vide = aucun relais.
ALTER TABLE "guilds" ADD COLUMN "clanPointsFeedChannelId" TEXT;
