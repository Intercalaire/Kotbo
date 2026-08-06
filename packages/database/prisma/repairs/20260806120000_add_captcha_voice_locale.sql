ALTER TABLE "raid_protection_configs"
  ADD COLUMN IF NOT EXISTS "captchaVoiceLocale" TEXT NOT NULL DEFAULT 'FR';
