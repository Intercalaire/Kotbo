-- L'etat du dashboard lit les journaux d'audit en deux passes : les evenements
-- Discord d'un cote, tout le reste de l'autre, chaque fois tries par date
-- decroissante. L'index existant (guildId, dateIso) sert le tri mais pas le
-- filtre sur eventType : Postgres remontait donc l'historique du serveur en
-- ecartant les lignes une a une, et le cout de la page grandissait avec l'age
-- du serveur plutot qu'avec ce qui est affiche.
CREATE INDEX IF NOT EXISTS "dashboard_audit_logs_guildId_eventType_dateIso_idx"
    ON "dashboard_audit_logs" ("guildId", "eventType", "dateIso");
