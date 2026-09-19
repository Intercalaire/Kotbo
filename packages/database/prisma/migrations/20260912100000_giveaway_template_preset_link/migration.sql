-- Un modele ne d'une sauvegarde de configuration se reconnaissait a son nom :
-- renommer l'un devait renommer l'autre, et un homonyme suffisait a rompre le
-- lien sans que rien ne le dise. La reference le tient desormais.

ALTER TABLE "giveaway_templates" ADD COLUMN "presetId" TEXT;

-- Les jumeaux deja en place gardent leur lien : on reprend la regle qui valait
-- jusqu'ici, l'egalite des noms a la casse pres, avant de la rendre explicite.
-- Un seul modele par sauvegarde, le plus ancien : deux noms qui ne different
-- que par la casse se ressemblent une fois abaisses, et poser la meme
-- sauvegarde sur deux lignes ferait echouer l'index unique qui suit.
UPDATE "giveaway_templates" t
SET "presetId" = jumeau."presetId"
FROM (
    SELECT DISTINCT ON (p."id") p."id" AS "presetId", candidat."id" AS "templateId"
    FROM "giveaway_config_presets" p
    JOIN "giveaway_templates" candidat
      ON candidat."guildId" = p."guildId"
     AND lower(candidat."name") = lower(p."name")
    ORDER BY p."id", candidat."createdAt"
) jumeau
WHERE t."id" = jumeau."templateId";

CREATE UNIQUE INDEX "giveaway_templates_presetId_key" ON "giveaway_templates"("presetId");

ALTER TABLE "giveaway_templates" ADD CONSTRAINT "giveaway_templates_presetId_fkey" FOREIGN KEY ("presetId") REFERENCES "giveaway_config_presets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
