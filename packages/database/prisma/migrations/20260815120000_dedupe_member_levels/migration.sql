-- `MemberLevel` déclare `@@unique([guildId, userId])` depuis longtemps, mais
-- aucune migration ne l'a jamais créé : la table est antérieure à cet
-- historique. Sans la contrainte, deux gains d'XP simultanés pour le même
-- membre pouvaient insérer deux lignes, que le classement paginé du dashboard
-- affiche ensuite sous la même clé.

-- Fusion des doublons éventuels : la ligne la mieux dotée fait foi. On ne
-- somme pas les XP, les lignes doublées s'étant partagé les mêmes gains -
-- additionner créditerait des niveaux jamais gagnés.
WITH doublons AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "guildId", "userId"
      ORDER BY "xp" DESC, "lastXpGain" DESC, "id"
    ) AS rang
  FROM "member_levels"
)
DELETE FROM "member_levels"
USING doublons
WHERE "member_levels"."id" = doublons."id" AND doublons.rang > 1;

CREATE UNIQUE INDEX IF NOT EXISTS "member_levels_guildId_userId_key"
  ON "member_levels"("guildId", "userId");
