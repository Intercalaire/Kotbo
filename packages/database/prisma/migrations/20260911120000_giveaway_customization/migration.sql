-- Personnalisation des giveaways : apparence de l'embed, textes annoncés,
-- conditions de participation et modèles réutilisables.
-- Les valeurs par défaut reprennent exactement ce que le bot écrivait en dur,
-- donc un serveur qui ne touche à rien voit ses concours inchangés.

ALTER TABLE "giveaways" ADD COLUMN "styleOverrides" JSONB;

ALTER TABLE "giveaway_configs"
    ADD COLUMN "minAccountAgeDays" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "minMemberAgeDays" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "minLevel" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "bonusEntries" JSONB NOT NULL DEFAULT '[]',
    ADD COLUMN "embedColorActive" TEXT NOT NULL DEFAULT '#5865F2',
    ADD COLUMN "embedColorPending" TEXT NOT NULL DEFAULT '#FAA81A',
    ADD COLUMN "embedColorEnded" TEXT NOT NULL DEFAULT '#ED4245',
    ADD COLUMN "embedColorValidated" TEXT NOT NULL DEFAULT '#57F287',
    ADD COLUMN "titleTemplate" TEXT NOT NULL DEFAULT '🎉 GIVEAWAY : {prize} 🎉',
    ADD COLUMN "descriptionTemplate" TEXT,
    ADD COLUMN "footerTemplate" TEXT NOT NULL DEFAULT 'ID : {id}',
    ADD COLUMN "thumbnailUrl" TEXT,
    ADD COLUMN "imageUrl" TEXT,
    ADD COLUMN "joinButtonLabel" TEXT NOT NULL DEFAULT 'Rejoindre',
    ADD COLUMN "joinButtonEmoji" TEXT NOT NULL DEFAULT '🎉',
    ADD COLUMN "joinButtonStyle" TEXT NOT NULL DEFAULT 'PRIMARY',
    ADD COLUMN "announceWinnersTemplate" TEXT NOT NULL DEFAULT '🎉 Félicitations à {winners} qui gagne(nt) **{prize}** ! 🏆',
    ADD COLUMN "announceNoWinnerTemplate" TEXT NOT NULL DEFAULT '😢 Personne n''a participé au giveaway pour **{prize}**, il n''y a donc pas de gagnant.',
    ADD COLUMN "joinReplyTemplate" TEXT NOT NULL DEFAULT '🎉 Inscription validée ! Bonne chance !',
    ADD COLUMN "leaveReplyTemplate" TEXT NOT NULL DEFAULT '😢 Vous vous êtes retiré du giveaway.',
    ADD COLUMN "deniedBlockedTemplate" TEXT NOT NULL DEFAULT '❌ L''un de tes rôles t''exclut des giveaways de ce serveur.',
    ADD COLUMN "deniedRequiredTemplate" TEXT NOT NULL DEFAULT '❌ Tu n''as pas le rôle requis pour participer aux giveaways de ce serveur.',
    ADD COLUMN "deniedAccountAgeTemplate" TEXT NOT NULL DEFAULT '❌ Ton compte Discord doit avoir au moins {minAccountAgeDays} jour(s) pour participer.',
    ADD COLUMN "deniedMemberAgeTemplate" TEXT NOT NULL DEFAULT '❌ Tu dois être sur le serveur depuis au moins {minMemberAgeDays} jour(s) pour participer.',
    ADD COLUMN "deniedLevelTemplate" TEXT NOT NULL DEFAULT '❌ Tu dois être niveau {minLevel} au minimum pour participer.';

CREATE TABLE "giveaway_templates" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prize" TEXT NOT NULL,
    "description" TEXT,
    "winnerCount" INTEGER NOT NULL DEFAULT 1,
    "durationMinutes" INTEGER NOT NULL DEFAULT 1440,
    "channelId" TEXT,
    "rpgXp" INTEGER NOT NULL DEFAULT 0,
    "rpgCoins" INTEGER NOT NULL DEFAULT 0,
    "rpgItemId" TEXT,
    "needValidation" BOOLEAN NOT NULL DEFAULT false,
    "styleOverrides" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "giveaway_templates_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "giveaway_templates_guildId_name_key" ON "giveaway_templates"("guildId", "name");

ALTER TABLE "giveaway_templates" ADD CONSTRAINT "giveaway_templates_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;
