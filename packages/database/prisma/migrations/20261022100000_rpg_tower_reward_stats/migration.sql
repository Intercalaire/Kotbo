-- La Tour : récompenses de boutique qui montent les statistiques du profil RPG, et articles
-- à quantité limitée par joueur.
ALTER TABLE "rpg_tower_rewards" ADD COLUMN "stat" TEXT;
ALTER TABLE "rpg_tower_rewards" ADD COLUMN "statAmount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "rpg_tower_rewards" ADD COLUMN "maxPurchases" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "rpg_tower_profiles" ADD COLUMN "purchases" JSONB NOT NULL DEFAULT '{}';
