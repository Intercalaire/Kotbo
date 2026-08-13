-- CreateTable
CREATE TABLE "sticky_messages" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "content" TEXT NOT NULL DEFAULT '',
    "embedEnabled" BOOLEAN NOT NULL DEFAULT false,
    "embedTitle" TEXT,
    "embedColor" TEXT NOT NULL DEFAULT '#5865F2',
    "messageThreshold" INTEGER NOT NULL DEFAULT 5,
    "cooldownSeconds" INTEGER NOT NULL DEFAULT 10,
    "lastMessageId" TEXT,
    "lastPostedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sticky_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sticky_messages_guildId_idx" ON "sticky_messages"("guildId");

-- CreateIndex
CREATE UNIQUE INDEX "sticky_messages_guildId_channelId_key" ON "sticky_messages"("guildId", "channelId");

-- AddForeignKey
ALTER TABLE "sticky_messages" ADD CONSTRAINT "sticky_messages_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable : l'auto-rôle tag passe de la recherche d'un mot dans le pseudo à
-- la détection du tag officiel du serveur (user.primary_guild), et gagne un
-- scan du statut / de l'activité.
ALTER TABLE "welcome_configs" DROP COLUMN "tagAutoRoleWord";

ALTER TABLE "welcome_configs"
    ADD COLUMN "statusScanEnabled" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "statusScanKeyword" TEXT NOT NULL DEFAULT '',
    ADD COLUMN "statusScanRoleId" TEXT,
    ADD COLUMN "statusScanScope" TEXT NOT NULL DEFAULT 'STATUS';
