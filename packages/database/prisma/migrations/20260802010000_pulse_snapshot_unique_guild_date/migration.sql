-- Le modèle PulseSnapshot déclare `@@unique([guildId, dateKey])`, mais aucune
-- migration ne l'a jamais créée : la table a été posée hors de l'historique, à
-- une époque où le schéma portait un simple index sur ces deux colonnes. Sans
-- contrainte unique, l'upsert quotidien du Pulse échoue sur « there is no
-- unique or exclusion constraint matching the ON CONFLICT specification » et
-- aucun snapshot ne s'écrit.
--
-- Le bloc entier est conditionné à l'existence de la table : les bases posées
-- par `db push` plutôt que par l'historique de migrations traversent alors
-- cette migration sans erreur.
DO $$
BEGIN
  IF to_regclass('public.pulse_snapshots') IS NULL THEN
    RETURN;
  END IF;

  -- Les doublons accumulés faute de contrainte empêcheraient la création de
  -- l'index. On garde la ligne la plus fraîche de chaque couple (serveur,
  -- jour), celle que l'upsert aurait mise à jour.
  DELETE FROM "pulse_snapshots" p
  USING (
    SELECT
      id,
      row_number() OVER (
        PARTITION BY "guildId", "dateKey"
        ORDER BY "updatedAt" DESC, "createdAt" DESC, id DESC
      ) AS rn
    FROM "pulse_snapshots"
  ) dup
  WHERE p.id = dup.id
    AND dup.rn > 1;

  -- Nom attendu par Prisma pour un `@@unique([guildId, dateKey])` : une base
  -- déjà correcte ne fait rien ici.
  EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS "pulse_snapshots_guildId_dateKey_key" ON "pulse_snapshots"("guildId", "dateKey")';
END
$$;
