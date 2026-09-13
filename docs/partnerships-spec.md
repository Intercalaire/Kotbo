# Module Partenariats

Outil de gestion des partenariats d'une communauté : partenaires, dossiers,
accords, avantages accordés, publicités croisées, retombées mesurées, annuaire
inter-serveurs et réputation partagée.

À ne pas confondre avec `packages/database/prisma/partnership.prisma` (au
singulier), qui traite des **candidatures adressées à Kotbo lui-même** via le
formulaire du dashboard. Le module décrit ici vit dans `partnerships.prisma`.

---

## 1. Les trois axes

Tout le module se paramètre par trois axes indépendants, définis dans
`packages/contracts/src/types/partnerships.ts` :

| Axe | Ce qu'il dit | Valeurs |
| --- | --- | --- |
| `type` | Ce qu'est le partenariat | 25 types, de `CROSS_PROMO` à `AFFILIATE` |
| `tier` | Jusqu'où on le formalise | `SIMPLE`, `PIPELINE`, `CONTRACT` |
| `stage` | Où il en est | 12 étapes, de `LEAD` à `ARCHIVED` |

Croiser trois axes plutôt que multiplier les entités évite la dérive habituelle :
une table « sponsors », une table « alliés » et une table « créateurs » qui
finissent par porter les mêmes colonnes sans les mêmes corrections.

Les trois sont des `String` en base, pas des `enum` Prisma : la liste bouge à
chaque type ajouté, et une migration par type rendrait le module coûteux à faire
évoluer. La validation se fait à l'entrée (`isPartnershipType`, `isPartnershipTier`,
`isPartnershipStage`).

### Le niveau se choisit dossier par dossier

Un échange de pubs avec un serveur ami et un contrat de sponsor à quatre chiffres
ne méritent pas la même cérémonie. Imposer la seconde à tout le monde ferait
abandonner le module au bout de trois fiches.

- `SIMPLE` : une fiche, des dates, un statut.
- `PIPELINE` : pipeline complet, responsable assigné, engagements mesurés.
- `CONTRACT` : accord versionné accepté des deux côtés, volet financier, double
  validation.

Monter ou descendre de niveau ne perd aucune donnée : ce qui a été saisi reste,
il cesse seulement d'être exigé.

---

## 2. Ce que le module garantit

### Une étape ne change jamais sans passer par `changePartnershipStage`

C'est là que sont réunies les quatre choses qui doivent aller ensemble et qu'un
`update` direct dissocierait : la transition autorisée, la trace, les avantages,
l'alerte. Un dossier passé en actif par une écriture directe aurait un partenaire
sans rôle, sans salon et sans personne au courant.

Le graphe `nextPartnershipStages` interdit les sauts : un dossier refusé ne
repart pas en actif sans repasser par le début. Une rupture exige un motif — c'est
ce motif qui nourrit la réputation du partenaire et le retour d'expérience.

### Les avantages sont rendus comme ils ont été trouvés

Avant ce module, un partenariat qui se terminait laissait derrière lui son rôle,
son salon, ses exemptions d'automod et son serveur ajouté à la liste des
invitations autorisées. Personne ne s'en souvenait six mois plus tard.

`PartnershipBenefitGrant` retient chaque application **et** si la ressource
préexistait. À la fin, ce qui préexistait n'est pas touché. Le salon dédié est
archivé — renommé et fermé — jamais supprimé : l'historique des échanges avec un
partenaire est précisément ce qu'on veut relire avant de retravailler avec lui.

Points d'ancrage utilisés dans les modules existants :

| Avantage | Où il s'applique |
| --- | --- |
| `AUTOMOD_EXEMPTION` | `AutoModConfig.bypassRoles` |
| `INVITE_ALLOWED` | `AutoModConfig.inviteFilterAllowedGuilds` + `RaidProtectionConfig.inviteBypassRoleIds` |
| `RAID_WHITELIST` | `RaidProtectionConfig.inviteBypassRoleIds` |
| `PARTNER_ROLE`, `CHANNEL_ACCESS`, `DEDICATED_CHANNEL` | Discord directement |
| `COIN_BONUS` | `RpgProfile.balance`, à l'arrivée du membre |
| `XP_BONUS` | via le rôle « venu d'un partenaire » et le multiplicateur par rôle du module Niveaux |

### Un partenaire n'écrit jamais directement sur le serveur

Le contenu des publicités vient d'une source non fiable. Avant publication, les
mentions sont neutralisées **dans le texte lui-même** (et pas seulement par
`allowedMentions`, pour que le rendu ne laisse pas croire à une mention réelle),
les images sont restreintes à `https`, les longueurs bornées. `defuse` est
exportée et testée : c'est la seule barrière entre le texte d'un partenaire et un
`@everyone` posté par le bot du serveur qui l'héberge.

### Le réseau informe, il ne décide pas

Un signal qui refuserait un partenariat tout seul deviendrait une arme : deux
serveurs en conflit se bloqueraient mutuellement le lendemain. Le staff voit
combien de signalements, de quelle nature, sur quelle période — et tranche.

L'agrégat `PartnerReputationSignal` ne porte aucun identifiant de serveur
signaleur : désigner un accusateur à une communauté mécontente ferait que plus
personne ne signalerait. Il publie en revanche le **nombre de serveurs
distincts**, parce que trois signalements venus de trois serveurs ne disent pas
la même chose que trois du même.

Contribuer (`reputationShare`) et consulter (`reputationConsume`) sont deux
réglages distincts, éteints par défaut. Seule la gravité 2 ou 3 remonte au
réseau.

---

## 3. Mesure des retombées

Compter les arrivées ne suffit pas : un partenaire qui amène trois cents comptes
repartis le lendemain coûte plus qu'il ne rapporte, et sans mesure de qualité il
apparaîtrait en tête du classement.

Chaque arrivée attribuée est suivie pendant la fenêtre de rétention (trente jours
par défaut) : est-elle restée, a-t-elle parlé, a-t-elle été sanctionnée. Le score
de santé du dossier (0-100) combine quatre termes : engagements tenus (le plus
lourd), rétention, activité, sanctions reçues (en négatif). Un dossier sans
mesure possible reste à 50 — l'absence de données n'est ni une bonne ni une
mauvaise nouvelle.

### L'événement `member:join:invite`

La provenance d'une arrivée se déduit d'un **différentiel de compteurs
d'invitations**, et ce différentiel se consomme : un second détecteur ne verrait
plus rien. Il est donc calculé au seul endroit qui le faisait déjà
(`events/advancedLogs.ts`), publié sur le bus, et tous ceux qui en ont besoin s'y
abonnent. Ne pas ajouter de second détecteur.

---

## 4. Le pont entre deux serveurs Kotbo

Chaque équipe garde son dossier : ses notes, son responsable, ses avantages. Le
pont dit que les deux dossiers parlent du même accord.

**Le pont propose, il n'impose pas.** Une étape reçue du dossier distant
déclenche une alerte au lieu d'écraser l'état local — sans cette règle, l'équipe
d'en face pourrait activer un partenariat chez nous, donc appliquer des rôles et
des exemptions sur notre serveur, sans que personne de chez nous ait rien décidé.

Deux exceptions, sûres parce qu'elles ne font que retirer : la rupture et la fin.

---

## 5. Surfaces

| Surface | Fichiers |
| --- | --- |
| Services bot | `apps/bot/src/services/partnerships/` |
| Abonnements bus | `apps/bot/src/modules/partnerships.module.ts` |
| Tâches périodiques | `apps/bot/src/events/crons.ts` (4 entrées `partnerships-*`) |
| API dashboard | `apps/bot/src/api/routes/dashboard/partnerships.ts` |
| Portail invité | `apps/bot/src/api/routes/public.ts` (`/api/public/partner-portal/:token`) |
| Commande Discord | `apps/bot/src/commands/community/partenariat.ts` |
| Pages dashboard | `apps/dashboard/src/pages/Partnerships.svelte`, `PartnershipDirectory.svelte`, `PartnerPortal.svelte` |
| Déclencheurs workflow | `packages/shared/src/workflow/catalog.ts` (`OnPartnership*`) |

### Droits

Écriture réservée aux administrateurs du dashboard. Les quatre segments d'API
sont inscrits sous la clé `partnerships` dans `SEGMENT_FEATURE_KEYS` : le centre
de gestion peut donc ouvrir le module à un rôle précis sans toucher au code.
Côté Discord, les actions de staff demandent `ManageGuild`.

### Tâches périodiques

| Tâche | Fréquence | Ce qu'elle fait |
| --- | --- | --- |
| `partnerships-hourly` | 10 min après chaque heure | Publications dues, réciprocité, constat des engagements |
| `partnerships-daily` | 04:10 | Échéances, renouvellements, rétention, matchmaking, archivage, santé |
| `partnerships-digest-weekly` | Lundi 09:15 | Bilan hebdomadaire |
| `partnerships-digest-monthly` | 1er du mois 09:20 | Bilan mensuel |

L'ordre du cycle horaire est délibéré : publier, puis contrôler, puis constater.
Constater d'abord reprocherait au partenaire une période que le bot n'a pas
encore honorée de son côté.

---

## 6. Mise en service

```bash
bun run db:generate          # client Prisma, apres tout changement de schema
bun run db:migrate:deploy    # applique 20260913120000_add_partnerships
bun run deploy-commands      # publie /partenariat aupres de Discord
```

Puis, sur le serveur : activer le module dans la page Modules, ouvrir la page
Partenariats → Réglages, et renseigner au minimum le salon de travail du staff.
Tous les automatismes sont éteints par défaut — ils touchent à des rôles, à des
salons et à des exemptions d'automod, et un réglage qui s'activerait seul
retirerait un jour un rôle que personne n'a demandé de retirer.

---

## 7. Ce qui n'est pas fait

À traiter, pas à ignorer :

- **Avantages déclaratifs.** `GIVEAWAY_ACCESS`, `DROP_ACCESS`, `EVENT_ACCESS`,
  `SHOP_DISCOUNT`, `SUPPORT_PRIORITY` et `VERIFICATION_BYPASS` sont enregistrés
  et lisibles par `activeBenefitsFor`, mais les modules concernés ne les
  consultent pas encore. Ils s'affichent comme accordés sans produire d'effet.
  `VERIFICATION_BYPASS` n'a pas d'ancrage du tout : le module Vérification n'a
  aucune liste d'exemption.
- **Aucune exécution réelle.** Le module n'a pas tourné contre un serveur
  Discord : les chemins qui appellent l'API Discord (création de salon, pose de
  rôle, publication, lecture d'un salon distant) sont couverts par le typecheck
  et la relecture, pas par l'usage.
- **Rotation de la vitrine.** `adRotationHours` est stocké et exposé, mais seule
  la republication par publicité (`repeatHours`) est implémentée.
- **Suppressions de publicité.** Elles sont attribuées à `moderator` par défaut ;
  distinguer un retrait par un modérateur d'une suppression par un tiers
  demanderait de lire le journal d'audit Discord.
- **Tests d'intégration.** Les 37 tests ajoutés couvrent le registre, le graphe
  de transitions, les bornes de période et la neutralisation du contenu. Les
  services qui écrivent en base ne sont pas testés.
