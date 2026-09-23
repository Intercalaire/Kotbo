-- Titres du RPG : catalogue du serveur, collection de chaque joueur et titre porté.
CREATE TABLE "rpg_titles" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "color" TEXT NOT NULL DEFAULT '#fbbf24',
    "attackBonus" INTEGER NOT NULL DEFAULT 0,
    "defenseBonus" INTEGER NOT NULL DEFAULT 0,
    "speedBonus" INTEGER NOT NULL DEFAULT 0,
    "healthBonus" INTEGER NOT NULL DEFAULT 0,
    "critBonus" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rpg_titles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "rpg_titles_guildId_name_key" ON "rpg_titles"("guildId", "name");

ALTER TABLE "rpg_titles" ADD CONSTRAINT "rpg_titles_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "rpg_profile_titles" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "titleId" TEXT NOT NULL,
    "obtainedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rpg_profile_titles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "rpg_profile_titles_profileId_titleId_key" ON "rpg_profile_titles"("profileId", "titleId");

ALTER TABLE "rpg_profile_titles" ADD CONSTRAINT "rpg_profile_titles_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "rpg_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "rpg_profile_titles" ADD CONSTRAINT "rpg_profile_titles_titleId_fkey" FOREIGN KEY ("titleId") REFERENCES "rpg_titles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "rpg_profiles" ADD COLUMN "activeTitleId" TEXT;
ALTER TABLE "rpg_profiles" ADD CONSTRAINT "rpg_profiles_activeTitleId_fkey" FOREIGN KEY ("activeTitleId") REFERENCES "rpg_titles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Titres gagnés en battant une créature, la première fois ou à chaque vainqueur.
ALTER TABLE "rpg_monsters" ADD COLUMN "firstKillTitleId" TEXT;
ALTER TABLE "rpg_monsters" ADD COLUMN "winTitleId" TEXT;
ALTER TABLE "rpg_monsters" ADD CONSTRAINT "rpg_monsters_firstKillTitleId_fkey" FOREIGN KEY ("firstKillTitleId") REFERENCES "rpg_titles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "rpg_monsters" ADD CONSTRAINT "rpg_monsters_winTitleId_fkey" FOREIGN KEY ("winTitleId") REFERENCES "rpg_titles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
