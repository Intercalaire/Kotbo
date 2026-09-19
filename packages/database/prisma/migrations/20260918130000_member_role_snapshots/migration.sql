-- AlterTable
ALTER TABLE "raid_protection_configs" ADD COLUMN IF NOT EXISTS "rolePersistEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "rolePersistMode" TEXT NOT NULL DEFAULT 'ALL',
ADD COLUMN IF NOT EXISTS "rolePersistRoleIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN IF NOT EXISTS "rolePersistMaxDays" INTEGER NOT NULL DEFAULT 90;

-- CreateTable
CREATE TABLE IF NOT EXISTS "member_role_snapshots" (
  "guildId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "roleIds" TEXT[],
  "leftAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "member_role_snapshots_pkey" PRIMARY KEY ("guildId", "userId")
);

CREATE INDEX IF NOT EXISTS "member_role_snapshots_leftAt_idx" ON "member_role_snapshots"("leftAt");

ALTER TABLE "member_role_snapshots"
  DROP CONSTRAINT IF EXISTS "member_role_snapshots_guildId_fkey";
ALTER TABLE "member_role_snapshots"
  ADD CONSTRAINT "member_role_snapshots_guildId_fkey"
  FOREIGN KEY ("guildId") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;
