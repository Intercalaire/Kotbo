-- Donjons : titre et rôle du coffre, prime et record du premier vainqueur.
ALTER TABLE "rpg_dungeons" ADD COLUMN "completionTitleId" TEXT;
ALTER TABLE "rpg_dungeons" ADD COLUMN "completionRoleId" TEXT;
ALTER TABLE "rpg_dungeons" ADD COLUMN "firstClearCoins" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "rpg_dungeons" ADD COLUMN "firstClearXp" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "rpg_dungeons" ADD COLUMN "firstClearItemName" TEXT;
ALTER TABLE "rpg_dungeons" ADD COLUMN "firstClearTitleId" TEXT;
ALTER TABLE "rpg_dungeons" ADD COLUMN "firstClearRoleId" TEXT;
ALTER TABLE "rpg_dungeons" ADD COLUMN "firstClearUserId" TEXT;
ALTER TABLE "rpg_dungeons" ADD COLUMN "firstClearAt" TIMESTAMP(3);

ALTER TABLE "rpg_dungeons" ADD CONSTRAINT "rpg_dungeons_completionTitleId_fkey" FOREIGN KEY ("completionTitleId") REFERENCES "rpg_titles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "rpg_dungeons" ADD CONSTRAINT "rpg_dungeons_firstClearTitleId_fkey" FOREIGN KEY ("firstClearTitleId") REFERENCES "rpg_titles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
