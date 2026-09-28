-- Stats de contenu des messages : types, emojis, stickers, GIF, markdown, liens.
-- Compteurs uniquement, jamais de texte ni d'URL complète.
CREATE TABLE IF NOT EXISTS "message_content_daily_stats" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "dateKey" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "messages" INTEGER NOT NULL DEFAULT 0,
    "withEmoji" INTEGER NOT NULL DEFAULT 0,
    "withMarkdown" INTEGER NOT NULL DEFAULT 0,
    "withLink" INTEGER NOT NULL DEFAULT 0,
    "withMedia" INTEGER NOT NULL DEFAULT 0,
    "reactedMessages" INTEGER NOT NULL DEFAULT 0,
    "typeText" INTEGER NOT NULL DEFAULT 0,
    "typeImage" INTEGER NOT NULL DEFAULT 0,
    "typeGif" INTEGER NOT NULL DEFAULT 0,
    "typeVideo" INTEGER NOT NULL DEFAULT 0,
    "typeSticker" INTEGER NOT NULL DEFAULT 0,
    "typeFile" INTEGER NOT NULL DEFAULT 0,
    "typeAudio" INTEGER NOT NULL DEFAULT 0,
    "typeVoice" INTEGER NOT NULL DEFAULT 0,
    "typePoll" INTEGER NOT NULL DEFAULT 0,
    "typeLink" INTEGER NOT NULL DEFAULT 0,
    "typeForward" INTEGER NOT NULL DEFAULT 0,
    "styleReply" INTEGER NOT NULL DEFAULT 0,
    "styleMention" INTEGER NOT NULL DEFAULT 0,
    "styleThread" INTEGER NOT NULL DEFAULT 0,
    "styleEdited" INTEGER NOT NULL DEFAULT 0,
    "emojiOnly" INTEGER NOT NULL DEFAULT 0,
    "lenShort" INTEGER NOT NULL DEFAULT 0,
    "lenMedium" INTEGER NOT NULL DEFAULT 0,
    "lenLong" INTEGER NOT NULL DEFAULT 0,
    "mdBold" INTEGER NOT NULL DEFAULT 0,
    "mdItalic" INTEGER NOT NULL DEFAULT 0,
    "mdUnderline" INTEGER NOT NULL DEFAULT 0,
    "mdStrike" INTEGER NOT NULL DEFAULT 0,
    "mdSpoiler" INTEGER NOT NULL DEFAULT 0,
    "mdInlineCode" INTEGER NOT NULL DEFAULT 0,
    "mdCodeBlock" INTEGER NOT NULL DEFAULT 0,
    "mdQuote" INTEGER NOT NULL DEFAULT 0,
    "mdHeading" INTEGER NOT NULL DEFAULT 0,
    "mdList" INTEGER NOT NULL DEFAULT 0,
    "mdMaskedLink" INTEGER NOT NULL DEFAULT 0,
    "mdSubtext" INTEGER NOT NULL DEFAULT 0,
    "emojiUnicode" INTEGER NOT NULL DEFAULT 0,
    "emojiGuild" INTEGER NOT NULL DEFAULT 0,
    "emojiExternal" INTEGER NOT NULL DEFAULT 0,
    "emojiAnimated" INTEGER NOT NULL DEFAULT 0,
    "stickerGuild" INTEGER NOT NULL DEFAULT 0,
    "stickerExternal" INTEGER NOT NULL DEFAULT 0,
    "stickerStandard" INTEGER NOT NULL DEFAULT 0,
    "gifTenor" INTEGER NOT NULL DEFAULT 0,
    "gifGiphy" INTEGER NOT NULL DEFAULT 0,
    "gifUpload" INTEGER NOT NULL DEFAULT 0,
    "gifOther" INTEGER NOT NULL DEFAULT 0,
    "reactUnicode" INTEGER NOT NULL DEFAULT 0,
    "reactGuild" INTEGER NOT NULL DEFAULT 0,
    "reactExternal" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "message_content_daily_stats_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "message_content_daily_stats_guildId_dateKey_channelId_userId_key"
    ON "message_content_daily_stats"("guildId", "dateKey", "channelId", "userId");
CREATE INDEX IF NOT EXISTS "message_content_daily_stats_guildId_userId_dateKey_idx"
    ON "message_content_daily_stats"("guildId", "userId", "dateKey");

DO $$ BEGIN
    ALTER TABLE "message_content_daily_stats" ADD CONSTRAINT "message_content_daily_stats_guildId_fkey"
        FOREIGN KEY ("guildId") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "content_item_daily_stats" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "dateKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "channelId" TEXT NOT NULL DEFAULT '',
    "userId" TEXT NOT NULL DEFAULT '',
    "count" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "content_item_daily_stats_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "content_item_daily_stats_guildId_dateKey_kind_key_channelId_userId_key"
    ON "content_item_daily_stats"("guildId", "dateKey", "kind", "key", "channelId", "userId");
CREATE INDEX IF NOT EXISTS "content_item_daily_stats_guildId_userId_dateKey_idx"
    ON "content_item_daily_stats"("guildId", "userId", "dateKey");

DO $$ BEGIN
    ALTER TABLE "content_item_daily_stats" ADD CONSTRAINT "content_item_daily_stats_guildId_fkey"
        FOREIGN KEY ("guildId") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "discord_asset_sources" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT,
    "animated" BOOLEAN NOT NULL DEFAULT false,
    "sourceGuildId" TEXT,
    "sourceGuildName" TEXT,
    "sourceGuildIcon" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "checkedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "discord_asset_sources_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "discord_asset_sources_status_checkedAt_idx"
    ON "discord_asset_sources"("status", "checkedAt");

-- Frontière du rattrapage : la migration passe avant que le nouveau code ne
-- tourne, donc tout message antérieur à NOW() n'a pas été compté en live. Seuls
-- les serveurs qui journalisent leurs messages ont un historique à relire.
ALTER TABLE "guilds" ADD COLUMN IF NOT EXISTS "contentStatsBackfillStatus" JSONB;

UPDATE "guilds"
SET "contentStatsBackfillStatus" = jsonb_build_object(
    'status', 'PENDING',
    'cutoff', to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
)
WHERE "messageLoggingEnabled" = true
  AND "contentStatsBackfillStatus" IS NULL;
