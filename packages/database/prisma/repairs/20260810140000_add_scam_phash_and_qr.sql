-- Reprise idempotente : empreinte perceptuelle des images d'arnaque et filtre QR.

ALTER TABLE "scam_image_hashes"
  ADD COLUMN IF NOT EXISTS "phash" TEXT;

ALTER TABLE "raid_protection_configs"
  ADD COLUMN IF NOT EXISTS "scamQrFilterEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "scamQrTrustedMessages" INTEGER NOT NULL DEFAULT 50;

CREATE INDEX IF NOT EXISTS "scam_image_hashes_guildId_phash_idx"
  ON "scam_image_hashes"("guildId", "phash");
