-- CreateTable
CREATE TABLE "starboard_configs" (
    "guildId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "channelId" TEXT,
    "upvoteEmojis" TEXT[] DEFAULT ARRAY['👍']::TEXT[],
    "downvoteEmojis" TEXT[] DEFAULT ARRAY['👎']::TEXT[],
    "threshold" INTEGER NOT NULL DEFAULT 5,
    "countEmbedReactions" BOOLEAN NOT NULL DEFAULT true,
    "autoReactEmbed" BOOLEAN NOT NULL DEFAULT true,
    "autoReactChannels" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "watchedChannels" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "ignoredChannels" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "allowBots" BOOLEAN NOT NULL DEFAULT false,
    "embedColor" TEXT NOT NULL DEFAULT '#F5C518',
    "removeBelowThreshold" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "starboard_configs_pkey" PRIMARY KEY ("guildId")
);

-- CreateTable
CREATE TABLE "starboard_entries" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "starMessageId" TEXT,
    "starChannelId" TEXT,
    "upvotes" INTEGER NOT NULL DEFAULT 0,
    "downvotes" INTEGER NOT NULL DEFAULT 0,
    "score" INTEGER NOT NULL DEFAULT 0,
    "peakScore" INTEGER NOT NULL DEFAULT 0,
    "postedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "starboard_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "starboard_entries_guildId_score_idx" ON "starboard_entries"("guildId", "score");

-- CreateIndex
CREATE INDEX "starboard_entries_starMessageId_idx" ON "starboard_entries"("starMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "starboard_entries_guildId_messageId_key" ON "starboard_entries"("guildId", "messageId");

-- AddForeignKey
ALTER TABLE "starboard_configs" ADD CONSTRAINT "starboard_configs_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "starboard_entries" ADD CONSTRAINT "starboard_entries_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "starboard_configs"("guildId") ON DELETE CASCADE ON UPDATE CASCADE;
