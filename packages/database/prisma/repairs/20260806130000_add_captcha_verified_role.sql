ALTER TABLE "raid_protection_configs"
  ADD COLUMN IF NOT EXISTS "captchaVerifiedRoleId" TEXT;
