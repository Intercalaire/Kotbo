ALTER TABLE "rpg_tower_configs" ADD COLUMN "dailyPaidKey" TEXT;
ALTER TABLE "rpg_tower_profiles" ADD COLUMN "dailyStreak" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "rpg_tower_profiles" ADD COLUMN "dailyLastKey" TEXT;
