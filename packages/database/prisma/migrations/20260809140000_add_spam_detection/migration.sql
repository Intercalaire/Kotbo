-- CreateTable
CREATE TABLE "spam_detection_configs" (
    "guildId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "shadowMode" BOOLEAN NOT NULL DEFAULT true,
    "logThreshold" INTEGER NOT NULL DEFAULT 30,
    "deleteThreshold" INTEGER NOT NULL DEFAULT 55,
    "timeoutThreshold" INTEGER NOT NULL DEFAULT 75,
    "banThreshold" INTEGER NOT NULL DEFAULT 95,
    "timeoutMinutes" INTEGER NOT NULL DEFAULT 60,
    "alertChannelId" TEXT,
    "bypassRoleIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "bypassChannelIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "typingSignalEnabled" BOOLEAN NOT NULL DEFAULT true,
    "crossChannelEnabled" BOOLEAN NOT NULL DEFAULT true,
    "duplicateEnabled" BOOLEAN NOT NULL DEFAULT true,
    "cadenceEnabled" BOOLEAN NOT NULL DEFAULT true,
    "contentEnabled" BOOLEAN NOT NULL DEFAULT true,
    "trustEnabled" BOOLEAN NOT NULL DEFAULT true,
    "windowSeconds" INTEGER NOT NULL DEFAULT 30,
    "crossChannelThreshold" INTEGER NOT NULL DEFAULT 3,
    "duplicateSimilarity" DOUBLE PRECISION NOT NULL DEFAULT 0.85,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "spam_detection_configs_pkey" PRIMARY KEY ("guildId")
);

-- CreateTable
CREATE TABLE "spam_detection_samples" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "messageId" TEXT,
    "score" INTEGER NOT NULL,
    "action" TEXT NOT NULL DEFAULT 'NONE',
    "shadow" BOOLEAN NOT NULL DEFAULT false,
    "features" JSONB NOT NULL,
    "contentPreview" TEXT,
    "label" TEXT,
    "decidedByUserId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "spam_detection_samples_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "spam_signal_weights" (
    "id" TEXT NOT NULL,
    "guildId" TEXT,
    "signalType" TEXT NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "sampleSize" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "spam_signal_weights_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "spam_detection_samples_guildId_createdAt_idx" ON "spam_detection_samples"("guildId", "createdAt");

-- CreateIndex
CREATE INDEX "spam_detection_samples_guildId_label_idx" ON "spam_detection_samples"("guildId", "label");

-- CreateIndex
CREATE INDEX "spam_detection_samples_guildId_userId_createdAt_idx" ON "spam_detection_samples"("guildId", "userId", "createdAt");

-- CreateIndex
CREATE INDEX "spam_signal_weights_signalType_idx" ON "spam_signal_weights"("signalType");

-- CreateIndex
CREATE UNIQUE INDEX "spam_signal_weights_guildId_signalType_key" ON "spam_signal_weights"("guildId", "signalType");

-- AddForeignKey
ALTER TABLE "spam_detection_configs" ADD CONSTRAINT "spam_detection_configs_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spam_detection_samples" ADD CONSTRAINT "spam_detection_samples_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spam_signal_weights" ADD CONSTRAINT "spam_signal_weights_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;
