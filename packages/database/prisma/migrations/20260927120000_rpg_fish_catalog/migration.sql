-- Espèces de poisson propres à un serveur : elles remplacent par leur nom celles livrées dans le code.
CREATE TABLE "rpg_fish" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "emoji" TEXT NOT NULL DEFAULT '🐟',
    "rarity" TEXT NOT NULL DEFAULT 'COMMON',
    "value" INTEGER NOT NULL DEFAULT 5,
    "xp" INTEGER NOT NULL DEFAULT 5,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rpg_fish_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "rpg_fish_guildId_name_key" ON "rpg_fish"("guildId", "name");

ALTER TABLE "rpg_fish" ADD CONSTRAINT "rpg_fish_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Récompenses des paliers du carnet de pêche.
CREATE TABLE "rpg_fishbook_rewards" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "coinReward" INTEGER NOT NULL DEFAULT 0,
    "xpReward" INTEGER NOT NULL DEFAULT 0,
    "itemName" TEXT,
    "roleId" TEXT,
    "titleId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rpg_fishbook_rewards_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "rpg_fishbook_rewards_guildId_tier_key" ON "rpg_fishbook_rewards"("guildId", "tier");

ALTER TABLE "rpg_fishbook_rewards" ADD CONSTRAINT "rpg_fishbook_rewards_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "rpg_fishbook_rewards" ADD CONSTRAINT "rpg_fishbook_rewards_titleId_fkey" FOREIGN KEY ("titleId") REFERENCES "rpg_titles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Paliers du carnet déjà versés à chaque joueur.
CREATE TABLE "rpg_fishbook_claims" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rpg_fishbook_claims_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "rpg_fishbook_claims_guildId_userId_tier_key" ON "rpg_fishbook_claims"("guildId", "userId", "tier");

ALTER TABLE "rpg_fishbook_claims" ADD CONSTRAINT "rpg_fishbook_claims_guildId_userId_fkey" FOREIGN KEY ("guildId", "userId") REFERENCES "rpg_profiles"("guildId", "userId") ON DELETE CASCADE ON UPDATE CASCADE;
