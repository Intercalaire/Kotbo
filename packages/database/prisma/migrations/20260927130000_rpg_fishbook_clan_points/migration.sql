-- Points de clan, ou XP de guilde, versés par un palier du carnet de pêche.
ALTER TABLE "rpg_fishbook_rewards" ADD COLUMN "clanPoints" INTEGER NOT NULL DEFAULT 0;
