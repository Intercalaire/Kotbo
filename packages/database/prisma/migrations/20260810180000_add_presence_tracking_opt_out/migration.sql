-- AlterTable
ALTER TABLE "member_profiles" ADD COLUMN     "presenceTrackingOptOut" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "presenceOptOutAt" TIMESTAMP(3);
