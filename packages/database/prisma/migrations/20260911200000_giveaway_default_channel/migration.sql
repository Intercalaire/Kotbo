-- Salon propose d'office au lancement d'un concours.
-- Un serveur qui publie toujours au meme endroit le resélectionnait a chaque
-- fois : le formulaire n'avait aucun defaut a proposer, et seul un modele
-- pouvait en porter un.

ALTER TABLE "giveaway_configs"
    ADD COLUMN "defaultChannelId" TEXT;
