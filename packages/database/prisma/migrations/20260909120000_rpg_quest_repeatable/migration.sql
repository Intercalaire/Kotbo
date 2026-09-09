-- Répétition des quêtes RPG personnelles.
--
-- Une quête personnelle ne paie qu'une fois par 24 h. La rendre répétable la fait repartir à
-- zéro dès qu'elle est payée, et elle peut alors rendre plusieurs fois dans la journée.
ALTER TABLE "rpg_quests" ADD COLUMN "repeatable" BOOLEAN NOT NULL DEFAULT false;

-- Une quête répétable remet son compteur à zéro : lui seul ne dirait plus rien de ce que la
-- fenêtre a rendu.
ALTER TABLE "rpg_quest_progress" ADD COLUMN "completions" INTEGER NOT NULL DEFAULT 0;

-- Le verrou de 24 h cherche le dernier versement d'un joueur sur une quête, toutes fenêtres
-- confondues : sans cet index, il balaierait la table à chaque action de jeu.
CREATE INDEX "rpg_quest_progress_questId_userId_claimedAt_idx" ON "rpg_quest_progress"("questId", "userId", "claimedAt");

-- Les lignes déjà payées comptent pour une : sans quoi une quête répétable existante
-- repartirait de zéro et paraîtrait n'avoir jamais rien rendu.
UPDATE "rpg_quest_progress" SET "completions" = 1 WHERE "status" = 'CLAIMED';
