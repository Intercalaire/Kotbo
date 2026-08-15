-- Suspension d'un membre du staff : contrairement au renvoi, la ligne est
-- conservée (grade, ancienneté, avertissements, tutorat) et seuls les rôles
-- Discord staff sont retirés le temps de la suspension. Les colonnes restent
-- nulles pour les membres actifs, ce qui fait de `suspendedAt IS NULL` le test
-- d'activité.
ALTER TABLE "staff_members" ADD COLUMN "suspendedAt" TIMESTAMP(3);
ALTER TABLE "staff_members" ADD COLUMN "suspendedReason" TEXT;
ALTER TABLE "staff_members" ADD COLUMN "suspendedById" TEXT;
