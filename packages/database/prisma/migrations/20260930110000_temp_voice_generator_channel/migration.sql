-- Salons vocaux temporaires : de quel generateur vient un salon, et
-- l'interrupteur qui decide si ce generateur a le droit d'imposer sa
-- presentation.
--
-- Les deux colonnes sont ADDITIVES et sans remplissage retroactif. Au
-- deploiement, rien ne change pour personne : la premiere vaut `NULL` sur toutes
-- les lignes existantes, la seconde `false` sur toutes.
--
-- `temp_voice_channels.generatorChannelId` — le salon generateur d'origine.
--   NULLABLE et SANS backfill, deliberement : un salon deja vivant ne garde
--   aucune trace de son generateur et personne ne peut la deviner apres coup
--   (deux generateurs peuvent viser la meme categorie et le meme gabarit de
--   nom). `NULL` = salon d'avant cette colonne : il herite de la presentation du
--   serveur, ce qui est exactement ce qu'il affichait deja. Pas de contrainte de
--   cle etrangere : le generateur est un salon Discord que rien ne garantit
--   vivant, et le supprimer ne doit pas emporter les salons qu'il a crees.
--
-- `temp_voice_mod_permissions_configs.perGeneratorPresentation` — l'interrupteur
--   de secours. `false` = les cinq reglages du serveur valent pour TOUS les
--   salons, et les surcharges des generateurs ne sont meme pas lues. C'est le
--   comportement livre aujourd'hui, donc le defaut. NOT NULL avec DEFAULT false
--   pour que les lignes deja en base le prennent sans aucune ecriture.
--   Le couper IGNORE les surcharges, il ne les EFFACE PAS : elles restent dans
--   `guilds.tempVoiceGenerators` et reviennent telles quelles au rallumage.
ALTER TABLE "temp_voice_channels"
  ADD COLUMN IF NOT EXISTS "generatorChannelId" TEXT;

ALTER TABLE "temp_voice_mod_permissions_configs"
  ADD COLUMN IF NOT EXISTS "perGeneratorPresentation" BOOLEAN NOT NULL DEFAULT false;
