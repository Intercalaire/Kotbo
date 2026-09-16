-- Compteur de déclenchements par membre, pour limiter une automatisation.
CREATE TABLE IF NOT EXISTS "workflow_member_runs" (
  "workflowId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "period" TEXT NOT NULL,
  "periodKey" TEXT NOT NULL,
  "count" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "workflow_member_runs_pkey" PRIMARY KEY ("workflowId", "userId", "period")
);

ALTER TABLE "workflow_member_runs"
  DROP CONSTRAINT IF EXISTS "workflow_member_runs_workflowId_fkey";
ALTER TABLE "workflow_member_runs"
  ADD CONSTRAINT "workflow_member_runs_workflowId_fkey"
  FOREIGN KEY ("workflowId") REFERENCES "workflows"("id") ON DELETE CASCADE ON UPDATE CASCADE;
