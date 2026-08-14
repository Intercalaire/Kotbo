-- AlterTable
ALTER TABLE "guilds" ADD COLUMN IF NOT EXISTS "regulationMessageIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- Reprise des règlements déjà publiés en un seul message.
UPDATE "guilds"
SET "regulationMessageIds" = ARRAY["regulationMessageId"]
WHERE "regulationMessageId" IS NOT NULL
  AND cardinality("regulationMessageIds") = 0;
