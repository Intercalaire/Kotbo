-- Salons vocaux temporaires : demandes d'accès (bouton sur salon
-- verrouillé/réservé) et permissions modérateur, action par action.
-- Voir packages/database/prisma/temp-voice-access.prisma.

-- CreateTable
CREATE TABLE IF NOT EXISTS "temp_voice_access_request_configs" (
  "guildId" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "responders" TEXT NOT NULL DEFAULT 'OWNER_AND_STAFF',
  "notifyVia" TEXT NOT NULL DEFAULT 'VOICE',
  "notifyChannelId" TEXT,
  "requestExpiresMinutes" INTEGER NOT NULL DEFAULT 10,
  "denyCooldownMinutes" INTEGER NOT NULL DEFAULT 10,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "temp_voice_access_request_configs_pkey" PRIMARY KEY ("guildId")
);

ALTER TABLE "temp_voice_access_request_configs"
  DROP CONSTRAINT IF EXISTS "temp_voice_access_request_configs_guildId_fkey";
ALTER TABLE "temp_voice_access_request_configs"
  ADD CONSTRAINT "temp_voice_access_request_configs_guildId_fkey"
  FOREIGN KEY ("guildId") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE IF NOT EXISTS "temp_voice_mod_permissions_configs" (
  "guildId" TEXT NOT NULL,
  "canRename" BOOLEAN NOT NULL DEFAULT true,
  "canChangeLimit" BOOLEAN NOT NULL DEFAULT true,
  "canLock" BOOLEAN NOT NULL DEFAULT true,
  "canChangeWriteMode" BOOLEAN NOT NULL DEFAULT true,
  "canKickOrBan" BOOLEAN NOT NULL DEFAULT true,
  "canReserve" BOOLEAN NOT NULL DEFAULT true,
  "canTransfer" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "temp_voice_mod_permissions_configs_pkey" PRIMARY KEY ("guildId")
);

ALTER TABLE "temp_voice_mod_permissions_configs"
  DROP CONSTRAINT IF EXISTS "temp_voice_mod_permissions_configs_guildId_fkey";
ALTER TABLE "temp_voice_mod_permissions_configs"
  ADD CONSTRAINT "temp_voice_mod_permissions_configs_guildId_fkey"
  FOREIGN KEY ("guildId") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable : le mode d'ecriture d'un salon temporaire.
-- Trois des quatre modes se relisent dans les surcharges Discord au demarrage ;
-- « ceux qui sont en vocal » ne s'y distingue d'aucun autre. Sans cette colonne,
-- un redemarrage rangeait le salon en « personne » et abandonnait derriere lui
-- des surcharges de presence que plus rien ne retirait.
ALTER TABLE "temp_voice_channels"
  ADD COLUMN IF NOT EXISTS "writeMode" TEXT;
