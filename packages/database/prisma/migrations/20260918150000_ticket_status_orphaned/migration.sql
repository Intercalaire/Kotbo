-- Un ticket dont le salon a ete supprime directement depuis Discord restait
-- OPEN pour toujours : le cron d'inactivite le reprenait toutes les dix
-- minutes, echouait a retrouver le salon, et passait au suivant sans rien
-- ecrire. Ni le staff ni le dashboard ne pouvaient le voir.
--
-- ORPHANED plutot que CLOSED : un ticket CLOSED garde soit son salon, soit un
-- transcript. Un orphelin n'a ni l'un ni l'autre.
ALTER TYPE "TicketStatus" ADD VALUE IF NOT EXISTS 'ORPHANED';
