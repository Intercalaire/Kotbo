-- AlterTable
ALTER TABLE "welcome_thread_configs" ADD COLUMN     "inactivityDeleteEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "inactivityDeleteHours" INTEGER NOT NULL DEFAULT 48;
