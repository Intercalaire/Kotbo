-- Ce que chacun a masque dans le bloc « A traiter » de l'accueil.
--
-- Un sujet qui ne concerne pas le lecteur (un sondage auquel il ne votera pas,
-- une etape de configuration dont le serveur n'a pas besoin) restait affiche
-- sans fin. Le choix est personnel : un administrateur qui ecarte les tickets
-- ne doit pas les retirer de l'accueil de ses collegues.
ALTER TABLE "dashboard_user_settings" ADD COLUMN IF NOT EXISTS "homeTodoPrefs" JSONB;
