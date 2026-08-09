-- AlterTable
ALTER TABLE "guilds" ADD COLUMN     "ticketSatisfactionCommentEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "ticketSatisfactionCommentQuestion" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "ticketSatisfactionCommentTimeout" INTEGER NOT NULL DEFAULT 120;
