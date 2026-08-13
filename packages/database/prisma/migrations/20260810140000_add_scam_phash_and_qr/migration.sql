-- AlterTable
ALTER TABLE "scam_image_hashes" ADD COLUMN     "phash" TEXT;

-- AlterTable
ALTER TABLE "raid_protection_configs" ADD COLUMN     "scamQrFilterEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "scamQrTrustedMessages" INTEGER NOT NULL DEFAULT 50;

-- CreateIndex
CREATE INDEX "scam_image_hashes_guildId_phash_idx" ON "scam_image_hashes"("guildId", "phash");
