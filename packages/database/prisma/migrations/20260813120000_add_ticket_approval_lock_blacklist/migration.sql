-- AlterEnum : une demande vit d'abord en PENDING (aucun salon créé), et finit
-- en REJECTED si le staff la refuse.
ALTER TYPE "TicketStatus" ADD VALUE IF NOT EXISTS 'PENDING';
ALTER TYPE "TicketStatus" ADD VALUE IF NOT EXISTS 'REJECTED';

-- AlterTable
ALTER TABLE "guilds" ADD COLUMN     "ticketLockUntilClaim" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "ticketApprovalEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "ticketApprovalChannelId" TEXT;

-- AlterTable
ALTER TABLE "tickets" ADD COLUMN     "lockUntilClaim" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "reviewChannelId" TEXT,
ADD COLUMN     "reviewMessageId" TEXT,
ADD COLUMN     "reviewedById" TEXT,
ADD COLUMN     "reviewedByName" TEXT,
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "rejectionReason" TEXT;

-- CreateTable
CREATE TABLE "ticket_blacklist" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "username" TEXT,
    "reason" TEXT,
    "addedByUserId" TEXT,
    "addedByTag" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_blacklist_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ticket_blacklist_guildId_userId_key" ON "ticket_blacklist"("guildId", "userId");

-- CreateIndex
CREATE INDEX "ticket_blacklist_guildId_createdAt_idx" ON "ticket_blacklist"("guildId", "createdAt");

-- AddForeignKey
ALTER TABLE "ticket_blacklist" ADD CONSTRAINT "ticket_blacklist_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;
