-- AlterTable
ALTER TABLE "channel_links" ADD COLUMN     "relayPins" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "channel_link_invites" ADD COLUMN     "relayPins" BOOLEAN NOT NULL DEFAULT true;
