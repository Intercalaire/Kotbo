-- Migration: add verification warn threshold fields
ALTER TABLE "Guild" ADD COLUMN IF NOT EXISTS "verificationWarnThreshold" INTEGER;
ALTER TABLE "Guild" ADD COLUMN IF NOT EXISTS "verificationWarnAutoMode" TEXT NOT NULL DEFAULT 'FULL_AUTO';
ALTER TABLE "Guild" ADD COLUMN IF NOT EXISTS "verificationWarnReason" TEXT NOT NULL DEFAULT 'Seuil d''avertissements atteint - vérification de sécurité requise.';
