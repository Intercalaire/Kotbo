-- Rôles donnés pour une durée par une automatisation, retirés à l'échéance.
CREATE TABLE IF NOT EXISTS "workflow_temporary_roles" (
  "id" TEXT NOT NULL,
  "guildId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "roleId" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "workflow_temporary_roles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "workflow_temporary_roles_guildId_userId_roleId_key"
  ON "workflow_temporary_roles"("guildId", "userId", "roleId");
CREATE INDEX IF NOT EXISTS "workflow_temporary_roles_expiresAt_idx"
  ON "workflow_temporary_roles"("expiresAt");

ALTER TABLE "workflow_temporary_roles"
  DROP CONSTRAINT IF EXISTS "workflow_temporary_roles_guildId_fkey";
ALTER TABLE "workflow_temporary_roles"
  ADD CONSTRAINT "workflow_temporary_roles_guildId_fkey"
  FOREIGN KEY ("guildId") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;
