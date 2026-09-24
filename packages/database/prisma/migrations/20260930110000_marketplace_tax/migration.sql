-- Taxe de l'hôtel des ventes : part du prix retenue au vendeur à chaque vente.
ALTER TABLE "economy_configs" ADD COLUMN "marketplaceTaxPercent" INTEGER NOT NULL DEFAULT 5;
