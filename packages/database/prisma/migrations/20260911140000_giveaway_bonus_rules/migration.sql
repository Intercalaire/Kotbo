-- Chances supplémentaires d'un tirage : reprise du bonus accordé au clan
-- vainqueur dans la section Clans, annonce des rôles avantagés dans l'embed,
-- et concours volontairement égalitaires.
-- Les valeurs par défaut reprennent le comportement en place : le tirage
-- doublait déjà les chances des membres du clan vainqueur.

ALTER TABLE "giveaways" ADD COLUMN "ignoreBonuses" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "giveaway_templates" ADD COLUMN "ignoreBonuses" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "giveaway_configs"
    ADD COLUMN "clanBonusEnabled" BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN "clanBonusWeight" INTEGER NOT NULL DEFAULT 2,
    ADD COLUMN "showBonusRoles" BOOLEAN NOT NULL DEFAULT true;
