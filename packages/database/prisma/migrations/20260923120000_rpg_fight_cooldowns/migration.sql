-- Délais de combat réglables par serveur, et verrou propre aux boss pour qu'ils ne
-- partagent plus celui des monstres ordinaires.
ALTER TABLE "economy_configs" ADD COLUMN "fightCooldownSec" INTEGER NOT NULL DEFAULT 120;
ALTER TABLE "economy_configs" ADD COLUMN "bossCooldownMin" INTEGER NOT NULL DEFAULT 2;
ALTER TABLE "rpg_profiles" ADD COLUMN "lastBossBattle" TIMESTAMP(3);
