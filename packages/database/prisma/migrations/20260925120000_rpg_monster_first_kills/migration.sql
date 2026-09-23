-- Prime du premier vainqueur, réglée par créature.
ALTER TABLE "rpg_monsters" ADD COLUMN "firstKillCoinReward" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "rpg_monsters" ADD COLUMN "firstKillXpReward" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "rpg_monsters" ADD COLUMN "firstKillItemName" TEXT;
ALTER TABLE "rpg_monsters" ADD COLUMN "firstKillClanPoints" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "rpg_monsters" ADD COLUMN "firstKillRoleId" TEXT;

-- Annonce du premier vainqueur.
ALTER TABLE "economy_configs" ADD COLUMN "firstKillAnnounce" TEXT NOT NULL DEFAULT 'NONE';
ALTER TABLE "economy_configs" ADD COLUMN "firstKillChannelId" TEXT;

CREATE TABLE "rpg_monster_first_kills" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "monsterName" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rpg_monster_first_kills_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "rpg_monster_first_kills_guildId_monsterName_key" ON "rpg_monster_first_kills"("guildId", "monsterName");

ALTER TABLE "rpg_monster_first_kills" ADD CONSTRAINT "rpg_monster_first_kills_guildId_userId_fkey" FOREIGN KEY ("guildId", "userId") REFERENCES "rpg_profiles"("guildId", "userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- Les créatures déjà abattues gardent leur vrai premier vainqueur, tiré du journal de
-- combats : sans cette reprise, la prochaine victoire sur un monstre farmé depuis des
-- mois décrocherait la prime.
INSERT INTO "rpg_monster_first_kills" ("id", "guildId", "monsterName", "userId", "createdAt")
SELECT DISTINCT ON ("guildId", "monsterName")
    gen_random_uuid()::text, "guildId", "monsterName", "userId", "createdAt"
FROM "rpg_battles"
WHERE "won" = true
ORDER BY "guildId", "monsterName", "createdAt" ASC;
