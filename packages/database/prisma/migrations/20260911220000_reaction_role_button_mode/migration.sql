-- Mode des boutons d'un menu de roles. « toggle » garde le comportement
-- historique (un second clic retire le role) et reste la valeur par defaut,
-- donc les menus deja publies ne changent pas de comportement.
-- « add_only » attribue le role sans jamais le retirer.
-- Chaque bouton peut surcharger ce mode via la cle « mode » de son entree JSON.

ALTER TABLE "reaction_role_menus" ADD COLUMN "buttonMode" TEXT NOT NULL DEFAULT 'toggle';
