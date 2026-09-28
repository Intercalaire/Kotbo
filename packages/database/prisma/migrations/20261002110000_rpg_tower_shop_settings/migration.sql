-- La Tour : améliorations permanentes et marchand réglables par serveur.
ALTER TABLE "rpg_tower_configs" ADD COLUMN "upgrades" JSONB;
ALTER TABLE "rpg_tower_configs" ADD COLUMN "merchant" JSONB;

-- Les emojis par défaut cèdent la place aux icônes du bot : une valeur vide les affiche.
ALTER TABLE "rpg_tower_configs" ALTER COLUMN "emoji" SET DEFAULT '';
ALTER TABLE "rpg_tower_configs" ALTER COLUMN "currencyEmoji" SET DEFAULT '';
ALTER TABLE "rpg_tower_rewards" ALTER COLUMN "emoji" SET DEFAULT '';
UPDATE "rpg_tower_configs" SET "emoji" = '' WHERE "emoji" = '🗼';
UPDATE "rpg_tower_configs" SET "currencyEmoji" = '' WHERE "currencyEmoji" = '💠';
UPDATE "rpg_tower_rewards" SET "emoji" = '' WHERE "emoji" IN ('🎁', '🏆');
