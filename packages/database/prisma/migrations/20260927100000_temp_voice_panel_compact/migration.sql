-- Salons vocaux temporaires : comment se comportent les sous-panneaux ephemeres.
--
-- `false` (defaut) = chaque action ouvre un ephemere de plus, le comportement
-- livre. `true` = un seul ephemere, reecrit sur place, avec un bouton Retour.
-- Le defaut ne change rien pour les serveurs existants : c'est a
-- l'administrateur d'aller chercher le mode compact s'il le veut.
ALTER TABLE "temp_voice_mod_permissions_configs"
  ADD COLUMN IF NOT EXISTS "panelCompactMode" BOOLEAN NOT NULL DEFAULT false;
