-- Bannissement d'instances self-host (introduit par 903cab3c sans migration).

CREATE TABLE IF NOT EXISTS "banned_instances" (
    "id" TEXT NOT NULL,
    "botClientId" TEXT,
    "machineFingerprint" TEXT,
    "reason" TEXT,
    "mode" TEXT NOT NULL,
    "bannedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unbannedAt" TIMESTAMP(3),
    "unbannedBy" TEXT,

    CONSTRAINT "banned_instances_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "banned_instances_botClientId_idx" ON "banned_instances"("botClientId");
CREATE INDEX IF NOT EXISTS "banned_instances_machineFingerprint_idx" ON "banned_instances"("machineFingerprint");
CREATE INDEX IF NOT EXISTS "banned_instances_unbannedAt_idx" ON "banned_instances"("unbannedAt");
