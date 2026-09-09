-- CreateTable
CREATE TABLE "bot_instance_stats" (
    "id" TEXT NOT NULL,
    "botClientId" TEXT NOT NULL,
    "botName" TEXT NOT NULL,
    "botAvatarUrl" TEXT,
    "dashboardUrl" TEXT,
    "guildCount" INTEGER NOT NULL DEFAULT 0,
    "userCount" INTEGER NOT NULL DEFAULT 0,
    "version" TEXT,
    "isSelfHosted" BOOLEAN NOT NULL DEFAULT false,
    "machineFingerprint" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastPingAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bot_instance_stats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "local_instance_identity" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "machineFingerprint" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "local_instance_identity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bot_instance_stats_botClientId_key" ON "bot_instance_stats"("botClientId");

-- CreateIndex
CREATE INDEX "bot_instance_stats_machineFingerprint_idx" ON "bot_instance_stats"("machineFingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "local_instance_identity_machineFingerprint_key" ON "local_instance_identity"("machineFingerprint");
