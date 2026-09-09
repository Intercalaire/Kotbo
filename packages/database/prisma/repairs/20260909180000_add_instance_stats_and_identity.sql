ALTER TABLE "bot_instance_stats" ADD COLUMN IF NOT EXISTS "machineFingerprint" TEXT;
ALTER TABLE "bot_instance_stats" ADD COLUMN IF NOT EXISTS "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX IF NOT EXISTS "bot_instance_stats_machineFingerprint_idx" ON "bot_instance_stats"("machineFingerprint");

CREATE TABLE IF NOT EXISTS "local_instance_identity" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "machineFingerprint" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "local_instance_identity_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "local_instance_identity_machineFingerprint_key" ON "local_instance_identity"("machineFingerprint");
