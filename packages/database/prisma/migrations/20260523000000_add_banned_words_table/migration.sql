-- Migration: add_banned_words_table
-- Remplace autoNicknameModerationWords String[] sur guilds par une table dédiée banned_words

-- 1. Création de la table banned_words
CREATE TABLE IF NOT EXISTS "banned_words" (
  "id"        TEXT NOT NULL,
  "guildId"   TEXT,
  "word"      TEXT NOT NULL,
  "category"  TEXT NOT NULL DEFAULT 'custom',
  "enabled"   BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "banned_words_pkey" PRIMARY KEY ("id")
);

-- 2. Index de recherche par serveur + état
CREATE INDEX IF NOT EXISTS "banned_words_guildId_enabled_idx" ON "banned_words"("guildId", "enabled");
CREATE INDEX IF NOT EXISTS "banned_words_guildId_word_idx" ON "banned_words"("guildId", "word");

-- 3. Index d'unicité partiels (gère correctement les NULL PostgreSQL)
--    Unicité sur (word) pour les mots globaux (guildId IS NULL)
CREATE UNIQUE INDEX IF NOT EXISTS "banned_words_global_word_unique"
  ON "banned_words"("word")
  WHERE "guildId" IS NULL;

--    Unicité sur (guildId, word) pour les mots de serveur (guildId IS NOT NULL)
CREATE UNIQUE INDEX IF NOT EXISTS "banned_words_guild_word_unique"
  ON "banned_words"("guildId", "word")
  WHERE "guildId" IS NOT NULL;

-- 4. Clé étrangère vers guilds
ALTER TABLE "banned_words"
  ADD CONSTRAINT "banned_words_guildId_fkey"
  FOREIGN KEY ("guildId") REFERENCES "guilds"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- 5. Migration des mots existants depuis autoNicknameModerationWords
--    Chaque mot du tableau devient une ligne avec le guildId du serveur
INSERT INTO "banned_words" ("id", "guildId", "word", "category", "enabled", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  g."id",
  TRIM(LOWER(word)),
  'custom',
  true,
  NOW(),
  NOW()
FROM "guilds" g,
     UNNEST(g."autoNicknameModerationWords") AS word
WHERE TRIM(LOWER(word)) != ''
ON CONFLICT DO NOTHING;

-- 6. Suppression de l'ancienne colonne
ALTER TABLE "guilds" DROP COLUMN IF EXISTS "autoNicknameModerationWords";

-- 7. Seed des mots globaux (guildId = NULL) - liste de base
--    Ces mots sont partagés entre tous les serveurs, gérables uniquement par les admins globaux
INSERT INTO "banned_words" ("id", "guildId", "word", "category", "enabled", "createdAt", "updatedAt")
VALUES
  -- Racisme / haine ethnique FR
  (gen_random_uuid()::text, NULL, 'nègre',             'racism',    true, NOW(), NOW()),
  (gen_random_uuid()::text, NULL, 'négro',             'racism',    true, NOW(), NOW()),
  (gen_random_uuid()::text, NULL, 'neger',             'racism',    true, NOW(), NOW()),
  (gen_random_uuid()::text, NULL, 'niggr',             'racism',    true, NOW(), NOW()),
  (gen_random_uuid()::text, NULL, 'nigger',            'racism',    true, NOW(), NOW()),
  (gen_random_uuid()::text, NULL, 'nigga',             'racism',    true, NOW(), NOW()),
  (gen_random_uuid()::text, NULL, 'youpin',            'racism',    true, NOW(), NOW()),
  (gen_random_uuid()::text, NULL, 'youpine',           'racism',    true, NOW(), NOW()),
  (gen_random_uuid()::text, NULL, 'feuj',              'racism',    true, NOW(), NOW()),
  (gen_random_uuid()::text, NULL, 'juif de merde',     'racism',    true, NOW(), NOW()),
  (gen_random_uuid()::text, NULL, 'sale juif',         'racism',    true, NOW(), NOW()),
  (gen_random_uuid()::text, NULL, 'arabe de merde',    'racism',    true, NOW(), NOW()),
  (gen_random_uuid()::text, NULL, 'sale arabe',        'racism',    true, NOW(), NOW()),
  (gen_random_uuid()::text, NULL, 'bougnoule',         'racism',    true, NOW(), NOW()),
  (gen_random_uuid()::text, NULL, 'bicot',             'racism',    true, NOW(), NOW()),
  (gen_random_uuid()::text, NULL, 'crouille',          'racism',    true, NOW(), NOW()),
  (gen_random_uuid()::text, NULL, 'chinetoque',        'racism',    true, NOW(), NOW()),
  (gen_random_uuid()::text, NULL, 'ritale',            'racism',    true, NOW(), NOW()),
  (gen_random_uuid()::text, NULL, 'polak',             'racism',    true, NOW(), NOW()),
  (gen_random_uuid()::text, NULL, 'raton',             'racism',    true, NOW(), NOW()),
  (gen_random_uuid()::text, NULL, 'bamboula',          'racism',    true, NOW(), NOW()),
  (gen_random_uuid()::text, NULL, 'nègresse',          'racism',    true, NOW(), NOW()),
  (gen_random_uuid()::text, NULL, 'noiraud',           'racism',    true, NOW(), NOW()),
  (gen_random_uuid()::text, NULL, 'renoi',             'racism',    true, NOW(), NOW()),
  (gen_random_uuid()::text, NULL, 'kebla',             'racism',    true, NOW(), NOW()),
  (gen_random_uuid()::text, NULL, 'reubeu',            'racism',    true, NOW(), NOW()),
  (gen_random_uuid()::text, NULL, 'gitan de merde',    'racism',    true, NOW(), NOW()),
  (gen_random_uuid()::text, NULL, 'romanichel',        'racism',    true, NOW(), NOW()),
  -- Menaces
  (gen_random_uuid()::text, NULL, 'je vais te tuer',   'threat',    true, NOW(), NOW()),
  (gen_random_uuid()::text, NULL, 'je vais te crever', 'threat',    true, NOW(), NOW()),
  (gen_random_uuid()::text, NULL, 'death threat',      'threat',    true, NOW(), NOW()),
  (gen_random_uuid()::text, NULL, 'kill yourself',     'threat',    true, NOW(), NOW()),
  (gen_random_uuid()::text, NULL, 'kys',               'threat',    true, NOW(), NOW()),
  (gen_random_uuid()::text, NULL, 'go die',            'threat',    true, NOW(), NOW()),
  -- Idéologie haineuse
  (gen_random_uuid()::text, NULL, 'pédophile',         'hate',      true, NOW(), NOW()),
  (gen_random_uuid()::text, NULL, 'pedo',              'hate',      true, NOW(), NOW()),
  (gen_random_uuid()::text, NULL, 'nazi',              'hate',      true, NOW(), NOW()),
  (gen_random_uuid()::text, NULL, 'führer',            'hate',      true, NOW(), NOW()),
  (gen_random_uuid()::text, NULL, 'hitler',            'hate',      true, NOW(), NOW()),
  (gen_random_uuid()::text, NULL, 'heil',              'hate',      true, NOW(), NOW()),
  (gen_random_uuid()::text, NULL, 'génocide',          'hate',      true, NOW(), NOW()),
  (gen_random_uuid()::text, NULL, 'zyklon',            'hate',      true, NOW(), NOW()),
  -- LGBTphobie
  (gen_random_uuid()::text, NULL, 'pédé',              'lgbtphobia',true, NOW(), NOW()),
  (gen_random_uuid()::text, NULL, 'pede',              'lgbtphobia',true, NOW(), NOW()),
  (gen_random_uuid()::text, NULL, 'tapette',           'lgbtphobia',true, NOW(), NOW()),
  (gen_random_uuid()::text, NULL, 'gouine',            'lgbtphobia',true, NOW(), NOW()),
  (gen_random_uuid()::text, NULL, 'fiotte',            'lgbtphobia',true, NOW(), NOW()),
  (gen_random_uuid()::text, NULL, 'travelo',           'lgbtphobia',true, NOW(), NOW()),
  -- Sexuel explicite
  (gen_random_uuid()::text, NULL, 'bite',              'sexual',    true, NOW(), NOW()),
  (gen_random_uuid()::text, NULL, 'pénis',             'sexual',    true, NOW(), NOW()),
  (gen_random_uuid()::text, NULL, 'vagin',             'sexual',    true, NOW(), NOW()),
  (gen_random_uuid()::text, NULL, 'enculé',            'sexual',    true, NOW(), NOW()),
  (gen_random_uuid()::text, NULL, 'encule',            'sexual',    true, NOW(), NOW()),
  -- Insultes EN
  (gen_random_uuid()::text, NULL, 'motherfucker',      'insult',    true, NOW(), NOW()),
  (gen_random_uuid()::text, NULL, 'cunt',              'insult',    true, NOW(), NOW()),
  (gen_random_uuid()::text, NULL, 'faggot',            'insult',    true, NOW(), NOW())
ON CONFLICT DO NOTHING;
