-- Reserve de raid ramenee au rythme d'avant le changement de formule.
--
-- Les degats sont passes d'une soustraction `attaque - defense / 2` a une attenuation
-- par ratio. Les boss de raid ont 30 a 56 de defense : a ce niveau, le ratio laisse
-- passer environ un quart de degats en moins. A reserve inchangee, le meme raid aurait
-- demande un tiers de coups en plus, sans que personne ne l'ait decide.
--
-- Le facteur 0,766 est la moyenne mesuree sur les quatre boss livres, a plusieurs
-- niveaux d'attaque. On l'applique aux valeurs DEJA ENREGISTREES : changer la valeur
-- par defaut de la colonne ne touche que les serveurs qui n'ont jamais rien regle, et
-- ceux-la sont justement les seuls a ne pas avoir de ligne a corriger.
--
-- Le reglage de chaque serveur garde sa proportion : qui avait monte la difficulte la
-- garde plus haute que la moyenne, simplement a la nouvelle echelle.

ALTER TABLE "economy_configs"
  ALTER COLUMN "raidHealthPerMember" SET DEFAULT 920,
  ALTER COLUMN "raidHealthFloor" SET DEFAULT 1915,
  ALTER COLUMN "raidHealthCap" SET DEFAULT 46000;

-- `GREATEST` respecte les bornes que le code oppose ensuite a ces colonnes
-- (`RAID_HEALTH_PER_MEMBER_RANGE` et `RAID_HEALTH_BOUND_RANGE`) : sans lui, un serveur
-- regle au minimum passerait sous la borne et serait silencieusement remonte au defaut.
UPDATE "economy_configs"
SET
  "raidHealthPerMember" = GREATEST(100, ROUND("raidHealthPerMember" * 0.766)::int),
  "raidHealthFloor"     = GREATEST(500, ROUND("raidHealthFloor" * 0.766)::int),
  "raidHealthCap"       = GREATEST(500, ROUND("raidHealthCap" * 0.766)::int);
