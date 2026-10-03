-- Salons vocaux temporaires : reglages d'affichage et de comportement du
-- panneau de gestion, configurables par serveur.
--
-- Chaque defaut reproduit EXACTEMENT le comportement livre aujourd'hui, pour
-- qu'un deploiement ne change rien tant qu'un administrateur n'a pas ouvert
-- l'onglet :
-- `panelMode` CLASSIC = les trois portes actuelles (Salon / Membres /
--   Propriete), chacune un ephemere separe, avec recherche de n'importe qui
--   du serveur.
-- `stateLayout` GRID3 = les six champs inline actuels (Etat / Places /
--   Ecriture / Autorises / Bannis / Reserve).
-- `stateColors` NEUTRAL = le rendu actuel des rendus image du panneau
--   uniquement (aucun effet sur les embeds ou les Components V2).
-- `panelComponents` V2 = deja le comportement livre aujourd'hui, le patch qui
--   convertit tout en V2 s'applique sans bascule, avant meme cette colonne.
-- `reservationFallbackMode` ANY_ROLE = ce que fait aujourd'hui le bouton
--   Reserver pour quelqu'un sans aucun role de reservableRoleIds : le menu
--   propose n'importe quel role du serveur.
ALTER TABLE "temp_voice_mod_permissions_configs"
  ADD COLUMN IF NOT EXISTS "panelMode" TEXT NOT NULL DEFAULT 'CLASSIC';

ALTER TABLE "temp_voice_mod_permissions_configs"
  ADD COLUMN IF NOT EXISTS "stateLayout" TEXT NOT NULL DEFAULT 'GRID3';

ALTER TABLE "temp_voice_mod_permissions_configs"
  ADD COLUMN IF NOT EXISTS "stateColors" TEXT NOT NULL DEFAULT 'NEUTRAL';

ALTER TABLE "temp_voice_mod_permissions_configs"
  ADD COLUMN IF NOT EXISTS "panelComponents" TEXT NOT NULL DEFAULT 'V2';

ALTER TABLE "temp_voice_mod_permissions_configs"
  ADD COLUMN IF NOT EXISTS "reservationFallbackMode" TEXT NOT NULL DEFAULT 'ANY_ROLE';
