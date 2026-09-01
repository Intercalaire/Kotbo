-- Extension du module Fun : chaîne de mots, rébus emoji, "ni oui ni non", salon
-- emoji uniquement, et bascule punitive pour les jeux à compteur (comptage,
-- chaîne de mots) - erreur = reset si actif, sinon simple suppression du message.
ALTER TABLE "Guild" ADD COLUMN IF NOT EXISTS "funWordChainChannelId" TEXT;
ALTER TABLE "Guild" ADD COLUMN IF NOT EXISTS "funEmojiRiddleChannelId" TEXT;
ALTER TABLE "Guild" ADD COLUMN IF NOT EXISTS "funNeverSayChannelId" TEXT;
ALTER TABLE "Guild" ADD COLUMN IF NOT EXISTS "funEmojiOnlyChannelId" TEXT;
ALTER TABLE "Guild" ADD COLUMN IF NOT EXISTS "funPunitiveMode" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "fun_game_states" ADD COLUMN IF NOT EXISTS "wordChainLastWord" TEXT;
ALTER TABLE "fun_game_states" ADD COLUMN IF NOT EXISTS "wordChainLastUserId" TEXT;
ALTER TABLE "fun_game_states" ADD COLUMN IF NOT EXISTS "emojiRiddleEmojis" TEXT;
ALTER TABLE "fun_game_states" ADD COLUMN IF NOT EXISTS "emojiRiddleAnswer" TEXT;
