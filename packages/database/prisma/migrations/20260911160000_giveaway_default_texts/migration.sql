-- Textes d'usine des concours : ils quittent la base pour revenir dans le bot,
-- qui les rend dans la langue du serveur. Une colonne vide vaut desormais
-- « texte d'usine » et non « texte francais fige ».
-- Les valeurs encore identiques aux anciens defauts sont remises a NULL : elles
-- n'etaient pas un choix du serveur, seulement le pre-remplissage du dashboard.

ALTER TABLE "giveaway_configs"
    ALTER COLUMN "titleTemplate" DROP DEFAULT,
    ALTER COLUMN "titleTemplate" DROP NOT NULL,
    ALTER COLUMN "footerTemplate" DROP DEFAULT,
    ALTER COLUMN "footerTemplate" DROP NOT NULL,
    ALTER COLUMN "joinButtonLabel" DROP DEFAULT,
    ALTER COLUMN "joinButtonLabel" DROP NOT NULL,
    ALTER COLUMN "joinButtonEmoji" DROP DEFAULT,
    ALTER COLUMN "joinButtonEmoji" DROP NOT NULL,
    ALTER COLUMN "announceWinnersTemplate" DROP DEFAULT,
    ALTER COLUMN "announceWinnersTemplate" DROP NOT NULL,
    ALTER COLUMN "announceNoWinnerTemplate" DROP DEFAULT,
    ALTER COLUMN "announceNoWinnerTemplate" DROP NOT NULL,
    ALTER COLUMN "joinReplyTemplate" DROP DEFAULT,
    ALTER COLUMN "joinReplyTemplate" DROP NOT NULL,
    ALTER COLUMN "leaveReplyTemplate" DROP DEFAULT,
    ALTER COLUMN "leaveReplyTemplate" DROP NOT NULL,
    ALTER COLUMN "deniedBlockedTemplate" DROP DEFAULT,
    ALTER COLUMN "deniedBlockedTemplate" DROP NOT NULL,
    ALTER COLUMN "deniedRequiredTemplate" DROP DEFAULT,
    ALTER COLUMN "deniedRequiredTemplate" DROP NOT NULL,
    ALTER COLUMN "deniedAccountAgeTemplate" DROP DEFAULT,
    ALTER COLUMN "deniedAccountAgeTemplate" DROP NOT NULL,
    ALTER COLUMN "deniedMemberAgeTemplate" DROP DEFAULT,
    ALTER COLUMN "deniedMemberAgeTemplate" DROP NOT NULL,
    ALTER COLUMN "deniedLevelTemplate" DROP DEFAULT,
    ALTER COLUMN "deniedLevelTemplate" DROP NOT NULL;

UPDATE "giveaway_configs" SET
    "titleTemplate" = NULLIF("titleTemplate", '🎉 GIVEAWAY : {prize} 🎉'),
    "footerTemplate" = NULLIF("footerTemplate", 'ID : {id}'),
    "joinButtonLabel" = NULLIF("joinButtonLabel", 'Rejoindre'),
    "joinButtonEmoji" = NULLIF("joinButtonEmoji", '🎉'),
    "announceWinnersTemplate" = NULLIF("announceWinnersTemplate", '🎉 Félicitations à {winners} qui gagne(nt) **{prize}** ! 🏆'),
    "announceNoWinnerTemplate" = NULLIF("announceNoWinnerTemplate", '😢 Personne n''a participé au giveaway pour **{prize}**, il n''y a donc pas de gagnant.'),
    "joinReplyTemplate" = NULLIF("joinReplyTemplate", '🎉 Inscription validée ! Bonne chance !'),
    "leaveReplyTemplate" = NULLIF("leaveReplyTemplate", '😢 Vous vous êtes retiré du giveaway.'),
    "deniedBlockedTemplate" = NULLIF("deniedBlockedTemplate", '❌ L''un de tes rôles t''exclut des giveaways de ce serveur.'),
    "deniedRequiredTemplate" = NULLIF("deniedRequiredTemplate", '❌ Tu n''as pas le rôle requis pour participer aux giveaways de ce serveur.'),
    "deniedAccountAgeTemplate" = NULLIF("deniedAccountAgeTemplate", '❌ Ton compte Discord doit avoir au moins {minAccountAgeDays} jour(s) pour participer.'),
    "deniedMemberAgeTemplate" = NULLIF("deniedMemberAgeTemplate", '❌ Tu dois être sur le serveur depuis au moins {minMemberAgeDays} jour(s) pour participer.'),
    "deniedLevelTemplate" = NULLIF("deniedLevelTemplate", '❌ Tu dois être niveau {minLevel} au minimum pour participer.');

-- Le corps de l'annonce a circule en deux versions : celle d'origine, puis
-- celle qui annonce les roles avantages. Les deux valent « pas de choix ».
UPDATE "giveaway_configs" SET "descriptionTemplate" = NULL
WHERE "descriptionTemplate" IN (
    '{description}Cliquez sur le bouton ci-dessous pour participer !' || chr(10) || '{bonus}' || chr(10) || '**Fin :** {endsRelative} ({endsAt})' || chr(10) || '**Nombre de gagnants :** {winnerCount}' || chr(10) || '**Participants :** {participants}',
    '{description}Cliquez sur le bouton ci-dessous pour participer !' || chr(10) || '{bonus}{bonusRoles}' || chr(10) || '**Fin :** {endsRelative} ({endsAt})' || chr(10) || '**Nombre de gagnants :** {winnerCount}' || chr(10) || '**Participants :** {participants}'
);
