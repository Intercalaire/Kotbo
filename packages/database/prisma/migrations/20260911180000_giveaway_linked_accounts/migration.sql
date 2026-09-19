-- Une personne, une entree : les comptes lies d'un membre ne participent qu'une
-- fois a un concours et ne comptent qu'une fois au tirage.
-- Desactive par defaut : c'est un durcissement, pas une correction, et il
-- suppose que la section Moderation a valide les liens entre comptes.

ALTER TABLE "giveaway_configs"
    ADD COLUMN "blockLinkedAccounts" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "deniedLinkedTemplate" TEXT;
