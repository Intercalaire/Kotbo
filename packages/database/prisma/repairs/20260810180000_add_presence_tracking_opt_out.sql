-- Reprise idempotente : refus individuel du suivi de présence (/opt-out presence).

ALTER TABLE "member_profiles"
  ADD COLUMN IF NOT EXISTS "presenceTrackingOptOut" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "presenceOptOutAt" TIMESTAMP(3);
