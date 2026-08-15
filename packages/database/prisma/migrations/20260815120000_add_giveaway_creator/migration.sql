-- Auteur du giveaway, affiché sur sa page publique. Les giveaways créés avant
-- cette colonne restent sans auteur connu : la page les affiche simplement sans
-- créateur plutôt que d'en inventer un.
ALTER TABLE "giveaways" ADD COLUMN "createdById" TEXT;

-- La page publique liste les giveaways d'un serveur en séparant ceux en cours
-- de ceux terminés, triés par date de fin.
CREATE INDEX "giveaways_guildId_ended_endsAt_idx" ON "giveaways"("guildId", "ended", "endsAt");
