-- La recherche de membres du dashboard compare des pseudos saisis à la main :
-- « jose » doit trouver « José ». `unaccent` fait ce repli côté base, là où la
-- recherche se fait désormais.
CREATE EXTENSION IF NOT EXISTS unaccent;
