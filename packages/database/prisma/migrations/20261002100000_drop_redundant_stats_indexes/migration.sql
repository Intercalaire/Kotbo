-- Index redondants sur les tables de statistiques.
--
-- Chacun de ces index est un prefixe de la cle unique de sa table (ou lui est
-- identique) : Postgres sert deja les memes filtres par la cle unique. Ils ne
-- faisaient donc rien gagner en lecture, mais chaque flush des statistiques
-- (toutes les 60 s) devait les maintenir en plus de la cle unique, et ils
-- occupaient disque et cache pour rien.
--
-- IF EXISTS : ces tables datent d'avant les migrations (creees par db push),
-- l'index peut donc manquer sur une instance.

-- Identique a la cle unique ("guildId", "dateKey").
DROP INDEX IF EXISTS "guild_daily_stats_guildId_dateKey_idx";

-- Prefixe de la cle unique ("guildId", "dateKey", "hour").
DROP INDEX IF EXISTS "guild_hourly_stats_guildId_dateKey_idx";

-- Prefixe de la cle unique ("guildId", "channelId", "dateKey").
DROP INDEX IF EXISTS "channel_daily_stats_guildId_channelId_idx";

-- Prefixe de la cle unique ("guildId", "userId", "dateKey").
DROP INDEX IF EXISTS "member_daily_stats_guildId_userId_idx";
