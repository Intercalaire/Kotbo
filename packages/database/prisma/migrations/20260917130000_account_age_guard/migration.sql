-- AlterTable
ALTER TABLE "raid_protection_configs" ADD COLUMN     "accountAgeGuardEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "accountAgeMinValue" INTEGER NOT NULL DEFAULT 7,
ADD COLUMN     "accountAgeMinUnit" TEXT NOT NULL DEFAULT 'DAYS',
ADD COLUMN     "accountAgeAction" TEXT NOT NULL DEFAULT 'KICK',
ADD COLUMN     "accountAgeAlertChannelId" TEXT,
ADD COLUMN     "accountAgeMessage" TEXT NOT NULL DEFAULT 'Ton compte Discord est trop récent pour rejoindre ce serveur.',
ADD COLUMN     "accountAgeWhitelist" TEXT[] DEFAULT ARRAY[]::TEXT[];
