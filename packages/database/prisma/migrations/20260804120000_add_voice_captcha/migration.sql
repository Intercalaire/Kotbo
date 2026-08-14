-- AlterTable
ALTER TABLE "raid_protection_configs" ADD COLUMN     "captchaMode" TEXT NOT NULL DEFAULT 'IMAGE',
ADD COLUMN     "captchaVoiceChannelId" TEXT,
ADD COLUMN     "captchaVoiceQueueLimit" INTEGER NOT NULL DEFAULT 25;

-- AlterTable
ALTER TABLE "captcha_sessions" ADD COLUMN     "awaitingTurn" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "mode" TEXT NOT NULL DEFAULT 'IMAGE';
