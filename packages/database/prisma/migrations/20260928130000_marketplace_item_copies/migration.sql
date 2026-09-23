-- Annonces d'exemplaires forgés : la progression voyage avec l'annonce jusqu'à l'acheteur.
ALTER TABLE "marketplace_listings" ADD COLUMN "upgrade" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "marketplace_listings" ADD COLUMN "enchants" JSONB NOT NULL DEFAULT '[]';

-- Niveau de forge vendu, pour le prix moyen proposé à la mise en vente.
ALTER TABLE "marketplace_transactions" ADD COLUMN "upgrade" INTEGER NOT NULL DEFAULT 0;
CREATE INDEX "marketplace_transactions_guildId_itemId_createdAt_idx" ON "marketplace_transactions"("guildId", "itemId", "createdAt");
