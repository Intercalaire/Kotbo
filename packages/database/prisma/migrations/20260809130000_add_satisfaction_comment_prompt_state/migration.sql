-- AlterTable
ALTER TABLE "ticket_satisfactions" ADD COLUMN     "commentPromptChannelId" TEXT,
ADD COLUMN     "commentPromptMessageId" TEXT,
ADD COLUMN     "commentPromptExpiresAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "ticket_satisfactions_commentPromptExpiresAt_idx" ON "ticket_satisfactions"("commentPromptExpiresAt");
