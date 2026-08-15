-- Marché noir : une fenêtre d'ouverture courte et imprévisible, commune au serveur,
-- pendant laquelle chaque membre se voit proposer sa propre sélection d'objets de la
-- boutique à prix réduit. Les réglages vivent sur la config économie ; la fenêtre et
-- les offres tirées vivent dans deux tables dédiées.
ALTER TABLE "economy_configs" ADD COLUMN "blackMarketEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "economy_configs" ADD COLUMN "blackMarketIntervalDays" INTEGER NOT NULL DEFAULT 7;
ALTER TABLE "economy_configs" ADD COLUMN "blackMarketDurationMin" INTEGER NOT NULL DEFAULT 120;
ALTER TABLE "economy_configs" ADD COLUMN "blackMarketOfferCount" INTEGER NOT NULL DEFAULT 4;
ALTER TABLE "economy_configs" ADD COLUMN "blackMarketMaxQuantity" INTEGER NOT NULL DEFAULT 3;
ALTER TABLE "economy_configs" ADD COLUMN "blackMarketDiscountMin" INTEGER NOT NULL DEFAULT 20;
ALTER TABLE "economy_configs" ADD COLUMN "blackMarketDiscountMax" INTEGER NOT NULL DEFAULT 50;
ALTER TABLE "economy_configs" ADD COLUMN "blackMarketAnnounce" TEXT NOT NULL DEFAULT 'NONE';
ALTER TABLE "economy_configs" ADD COLUMN "blackMarketChannelId" TEXT;
ALTER TABLE "economy_configs" ADD COLUMN "blackMarketRoleId" TEXT;

CREATE TABLE "rpg_black_market_sessions" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "opensAt" TIMESTAMP(3) NOT NULL,
    "closesAt" TIMESTAMP(3) NOT NULL,
    "announcedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rpg_black_market_sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "rpg_black_market_offers" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "price" INTEGER NOT NULL,
    "discount" INTEGER NOT NULL,
    "stock" INTEGER NOT NULL DEFAULT 1,
    "purchased" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rpg_black_market_offers_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "rpg_black_market_sessions_guildId_opensAt_idx" ON "rpg_black_market_sessions"("guildId", "opensAt");
CREATE INDEX "rpg_black_market_sessions_guildId_closesAt_idx" ON "rpg_black_market_sessions"("guildId", "closesAt");
CREATE INDEX "rpg_black_market_offers_sessionId_userId_idx" ON "rpg_black_market_offers"("sessionId", "userId");
CREATE UNIQUE INDEX "rpg_black_market_offers_sessionId_userId_itemId_key" ON "rpg_black_market_offers"("sessionId", "userId", "itemId");

ALTER TABLE "rpg_black_market_sessions" ADD CONSTRAINT "rpg_black_market_sessions_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "rpg_black_market_offers" ADD CONSTRAINT "rpg_black_market_offers_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "rpg_black_market_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "rpg_black_market_offers" ADD CONSTRAINT "rpg_black_market_offers_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "rpg_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
