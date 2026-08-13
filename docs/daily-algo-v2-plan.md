# Daily Algo v2 - Cahier des charges & plan de travail

> Version 2 du doc, après arbitrages. Branche cible : `feat/daily-algo-v2`,
> à créer depuis `origin/main` (les clans y sont mergés - PR #87 / #88).

---

## 1. Décisions verrouillées

| Sujet | Décision |
|---|---|
| **Conversion vers les clans** | **1 point de Daily Algo gagné dans la semaine = 1 point de clan**, versé **une seule fois à la clôture hebdomadaire**. Pas de versement à la notation. |
| **Indépendance des modules** | Daily Algo et Clans sont **totalement autonomes**. Chacun marche seul, les deux peuvent tourner sans être liés, le lien est un troisième interrupteur. |
| **Toute participation récompensée** | Plancher de points garanti pour toute soumission approuvée, même faible. Le rejet est réservé aux vrais hors-sujet / dérapages. |
| **Bonus rapidité** | On garde **3 / 2 / 1** tel quel. Il compte dans le total hebdo, donc dans les points de clan. |
| **Pas de virgules** | **Tous les points sont des entiers.** Arrondi à l'**unité supérieure** (`Math.ceil`). Jamais « 4,5 pts » affiché nulle part. |
| **Tout configurable au panel** | Chaque réglage listé en section 5 a son champ dans le dashboard. Le pont clans est un panneau **verrouillé si les clans sont inactifs**, calqué sur « Boost de Saison de Clan ». |
| **Correction automatique** | **Pas maintenant.** On ne touche pas aux tests unitaires / à l'exécution de code. |
| **Génération d'énoncés par IA** | **Pas maintenant.** Aucune dépendance LLM ajoutée au projet. |
| **Limite de 1900 caractères du modal** | Non-sujet, on garde. À améliorer plus tard si besoin. |
| **Priorité** | Faire marcher le socle (points, semaine, récompenses, pont clans, sanction, points manuels) et le **vérifier en vrai** avant d'ajouter quoi que ce soit. |

---

## 2. Le modèle de points

### 2.1 Points d'une soumission - **entiers uniquement**

```
points_soumission = ceil( ( plancher_participation   (1 pt, réglable)
                          + moyenne_des_5_critères   (1 à 5, par pas de 0.2)
                          + bonus_rapidité           (3 / 2 / 1 / 0)
                          ) × multiplicateur_du_jour  (1 en semaine, 1.5 le week-end)
                        )
```

*(La moyenne de cinq notes entières est toujours un multiple de 0.2 : 3.4 ou 3.6,
jamais 3.5.)*

**Un seul arrondi, à la toute fin, à l'unité supérieure.** C'est important :
arrondir à chaque étape ferait s'empiler les arrondis et gonflerait les totaux.
La moyenne des 5 critères reste un nombre à virgule *en interne* (c'est déjà le
cas via `scoreFinal`, qui continue de s'afficher en « /5 » dans le détail des
notes), mais **aucun point n'est jamais à virgule** : ni sur le message de défi,
ni au classement, ni dans les points de clan.

Ces points sont **persistés** dans une nouvelle colonne
`DailyAlgoSubmission.pointsAwarded` (**Int**) au moment de la notation. Raison :
dès que les points alimentent des rôles et des points de clan, il ne faut plus
qu'un changement de règles réécrive l'historique.

Le total hebdo est une somme d'entiers, donc entier. La conversion en points de
clan (× `clanPointsFromDailyAlgoRate`) repasse par un `ceil` pour rester entière
même si le taux est réglé à 0.5.

### 2.2 Dosage - pourquoi le 1:1 tombe juste

Repères existants côté clans : **level-up = 50 pts**, **boost serveur = 100 pts**.

Points de Daily Algo sur une journée (après arrondi supérieur) :

| Profil | Calcul | Points |
|---|---|---|
| Participant moyen, hors podium rapidité | ceil(1 + 3.4) | **5** |
| Bon participant, 1er à soumettre | ceil(1 + 4.4 + 3) | **9** |
| Idem un samedi (×1.5) | ceil(8.4 × 1.5) | **13** |

Sur une semaine (5 jours + 2 jours de week-end majorés) :

| Profil | Total hebdo | = points de clan |
|---|---|---|
| Acharné (7/7, bonnes notes, souvent 1er) | 5×9 + 2×13 | **71 pts** ≈ 1,4 level-up |
| Régulier moyen (7/7, jamais dans le top rapidité) | 5×5 + 2×7 | **39 pts** |
| Occasionnel (2 jours) | 2×4 | **8 pts** |

Ces trois totaux sont verrouillés par des tests
([dailyAlgoScoring.test.ts](apps/bot/src/tests/unit/dailyAlgoScoring.test.ts)) :
si un jour le barème dérive, ça casse.

C'est exactement le bon ordre de grandeur : un membre à fond sur le Daily Algo
pèse un peu plus qu'un level-up par semaine, sans jamais approcher les milliards.
Et un occasionnel repart quand même avec quelque chose.

**Filet de sécurité** : le réglage `clanPointsFromDailyAlgoRate` (défaut `1.0`)
permet de passer à 0.5 ou 2 depuis le panel sans toucher au code, si à l'usage ça
déséquilibre.

### 2.3 Qui convertit ses points ?

**Tout le monde**, pas seulement le podium. Chaque membre ayant ≥ 1 soumission
approuvée dans la semaine convertit son total hebdo en points de clan. C'est ce
qui rend le système cohérent avec « toute participation doit être récompensée » :
le 1er gagne le plus parce qu'il a marqué le plus, mécaniquement, sans règle
supplémentaire.

Le podium hebdo (1er / 2e / 3e) reçoit **en plus** : un rôle Discord, de l'XP de
leveling, et un bonus forfaitaire de points de clan (réglable, défaut 30 / 20 / 10).

---

## 3. Indépendance Daily Algo ⇄ Clans (la particularité à ne pas rater)

Trois interrupteurs indépendants :
- `dailyAlgoEnabled` (existe déjà)
- `clansEnabled` (existe déjà)
- `clanPointsFromDailyAlgo` - **nouveau**, le pont, défaut `false`

### Matrice de comportement

| `clansEnabled` | `dailyAlgoEnabled` | Pont | Comportement attendu |
|---|---|---|---|
| ❌ | ✅ | n/a | Daily Algo **complet et autonome** : notation, classement hebdo, podium, rôles, XP de leveling. **Zéro appel au code clan.** |
| ✅ | ❌ | n/a | Clans intacts : level-up, boost, points manuels. Aucune dépendance au Daily Algo. |
| ✅ | ✅ | ❌ | Les deux tournent en parallèle, **aucun lien**. Le Daily Algo ne touche pas aux points de clan. |
| ✅ | ✅ | ✅ | À la clôture hebdo, les points de la semaine sont convertis en points de clan. |

### Garde-fous d'implémentation

1. **Import dynamique** : le service Daily Algo n'importe `clanService` qu'à
   l'intérieur du bloc conditionnel (`await import('../community/clanService.js')`),
   comme le fait déjà `awardClanPointsOnBoost` avec `altAccountService`. Pas de
   couplage dur au chargement.
2. **Une seule fonction de pont**, `awardClanPointsFromDailyAlgoWeek()`, qui
   commence par vérifier `clansEnabled && clanPointsFromDailyAlgo`, et sort
   silencieusement sinon.
3. **Membre sans clan** → aucun point de clan, en silence. Il garde son rôle de
   podium, son XP et sa place au classement.
4. **Aucun clan configuré** → étape sautée, pas d'erreur, la clôture continue.
5. **Le podium et les rôles ne dépendent jamais des clans.**
6. **Côté dashboard** : le toggle du pont apparaît dans les deux panneaux (Daily
   Algo et Clans) avec un état « indisponible - active l'autre module » plutôt
   qu'une case cochable qui ne fait rien.
7. **Saison** : utiliser `guild.currentClanSeason` (comme le boost).
8. **Doubles comptes** : `DailyAlgoSubmission.authorId` est un ID Discord brut,
   alors que les contributions de clan sont indexées sur l'ID canonique. Il faut
   passer par `getAllLinkedUserIds()` puis `sort()[0]`, exactement comme
   `awardClanPointsOnBoost`, sinon un membre avec un double compte se retrouve
   avec deux lignes de contribution.

### Bénéfice inattendu du versement hebdo

En versant à la clôture au lieu de la notation, le **piège de la double
attribution disparaît**. La renotation le jour même est autorisée
(`allowReviewedUpdate`) ; avec un versement immédiat il aurait fallu stocker les
points de clan déjà donnés et calculer un delta à chaque correction. Là, la
clôture lit des notes déjà figées et verse une fois. C'est plus simple **et** plus
robuste. Bon choix.

---

## 4. Ce qui est explicitement hors périmètre pour cette itération

- ❌ Correction automatique / exécution serveur du code / runner Docker.
- ❌ Génération d'énoncés par LLM (aucune clé API, aucune dépendance IA).
- ❌ Second défi quotidien (le week-end majoré passe par un **multiplicateur**, ce
  qui évite de migrer la contrainte `@@unique([guildId, dateKey])`).
- ❌ Refonte de la limite de 1900 caractères.
- ❌ Import en masse d'exercices via API / MCP.

Tout ça reste noté en section 8 pour plus tard.

---

## 5. Schéma de base de données

### `DailyAlgoSubmission` - colonnes ajoutées
- `pointsAwarded` **Int?** - total figé à la notation, déjà arrondi à l'unité
  supérieure. (`scoreFinal` reste Float : c'est la moyenne /5 affichée, pas un
  nombre de points.)
- `abuseFlagged` Boolean @default(false) - signalé comme dérapage.
- `abuseReason` String? - motif détecté ou saisi.

### `DailyAlgoSubmissionStatus` - valeur ajoutée
- `DISMISSED` - hors-sujet, 0 pt, **sans sanction**. Sépare « nul mais sincère »
  (→ `APPROVED` + points plancher) de « troll » (→ `REJECTED`, sanctionnable).

### `DailyAlgoRun` - colonnes ajoutées
- `pointsMultiplier` Float @default(1) - 1.5 le week-end.
- `kind` String @default("DAILY") - `DAILY` | `WEEKEND`.

### Nouveau : `DailyAlgoWeek`
`guildId`, `weekKey` (ISO, ex. `2026-W31`), `startsAt`, `endsAt`, `status`
(`OPEN | CLOSED`), `finalLeaderboard` Json, `closedAt`, `rewardsGrantedAt`.
Unique sur `[guildId, weekKey]`.

### Nouveau : `DailyAlgoWeeklyReward`
`weekId`, `guildId`, `userId`, `rank`, `points`, `xpGranted`, `clanPointsGranted`,
`roleId`, `createdAt`. Sert d'**idempotence** (un cron qui repasse ne redistribue
pas) et de piste d'audit.

### Nouveau : `DailyAlgoBonusPoint`
`guildId`, `userId`, `amount` (peut être négatif), `reason`, `grantedById`,
`weekKey`, `createdAt`. Comptabilisé dans le classement hebdo et all-time.

### Nouveaux réglages sur `Guild`

```
# Points
dailyAlgoParticipationPoints      Int    @default(1)
dailyAlgoWeekendMultiplier        Float  @default(1.5)
dailyAlgoTimezone                 String @default("Europe/Paris")

# Semaine & podium
dailyAlgoWeeklyRewardsEnabled     Boolean @default(false)
dailyAlgoWeekRole1Id              String?
dailyAlgoWeekRole2Id              String?
dailyAlgoWeekRole3Id              String?
dailyAlgoWeekRoleRotate           Boolean @default(true)
dailyAlgoWeekXp1                  Int @default(500)
dailyAlgoWeekXp2                  Int @default(300)
dailyAlgoWeekXp3                  Int @default(150)
dailyAlgoWeekParticipationXp      Int @default(100)
dailyAlgoWeekAnnouncementChannelId String?

# Pont clans (le troisième interrupteur)
clanPointsFromDailyAlgo           Boolean @default(false)
clanPointsFromDailyAlgoRate       Float   @default(1.0)
clanPointsDailyAlgoTop1           Int @default(30)
clanPointsDailyAlgoTop2           Int @default(20)
clanPointsDailyAlgoTop3           Int @default(10)

# Sanction
dailyAlgoSanctionType             String @default("WARN")   # WARN | TIMEOUT
dailyAlgoSanctionWeight           Int    @default(1)
dailyAlgoSanctionDurationMinutes  Int    @default(60)
```

---

## 6. Le panneau de configuration

**Règle absolue : aucune valeur codée en dur.** Tout ce qui est listé en section 5
est réglable depuis le dashboard, y compris le fait de mettre des rôles de podium
*ou pas* (laisser les trois champs vides = pas de rôle attribué, le reste des
récompenses fonctionne quand même).

### 6.1 Passage de `DailyAlgo.svelte` en onglets

La page devient trop dense pour une colonne unique. On reprend **exactement** la
navigation par onglets de `Clans.svelte`
([Clans.svelte:637-661](apps/dashboard/src/pages/Clans.svelte:637)) -
`let activeTab = $state<...>()`, boutons `border-b-2` avec l'état actif en
`border-primary text-primary bg-primary/5 rounded-t-lg`, icône `Papicon` :

| Onglet | Contenu |
|---|---|
| 🧩 **Défis** | CRUD des problèmes, planning, échange du défi du jour (l'existant). |
| 📝 **Notation** | Soumissions du jour, historique, classement (l'existant). |
| ⚙️ **Réglages** | Barème & points, Semaine & podium, Sanctions (voir 6.2), pont Clans (voir 6.3). |
| ✨ **Points** | Points bonus manuels + journal des attributions. |
| 🔧 **Administration** | Voir 6.4. |

### 6.2 Blocs de réglages

| Bloc | Contenu |
|---|---|
| **Barème & points** | Plancher de participation, multiplicateur de week-end, fuseau horaire. Aperçu en direct : « un participant moyen gagne ~5 pts/jour, ~39 pts/semaine ». |
| **Semaine & podium** | Interrupteur maître `dailyAlgoWeeklyRewardsEnabled`. Une fois activé : 3 sélecteurs de rôle (1er/2e/3e, **facultatifs**), interrupteur « rôles tournants », XP par place + XP de participation, salon d'annonce. |
| **Sanctions** | Type (avertissement / timeout), poids, durée. |
| **Points bonus manuels** | Sélecteur de membre avec recherche DB + montant + motif, et journal des attributions (onglet ✨ Points). |
| **Pont Clans** | Voir 6.3. |

Chaque champ suit les conventions déjà en place dans la page : `FormInput`,
`ToggleSwitch`, `SearchableSelect` pour les rôles, révélation des sous-réglages en
`{#if}` avec `animate-in slide-in-from-top-2`, et respect de `canManageSettings`
sur le `disabled`.

### 6.3 Le panneau « Points de clan » - verrouillé si les clans sont inactifs

Copie exacte du pattern de **« Boost de Saison de Clan »**
([Leveling.svelte:792-855](apps/dashboard/src/pages/Leveling.svelte:792)) :

1. Récupérer l'état des clans au montage via `fetchClansData()` → `clansEnabled`.
2. `{#if !clansEnabled}` → carte verrouillée : 🔒 + « Les clans ne sont pas activés
   sur ce serveur. Activez-les dans l'onglet Clans pour configurer ce lien. »
   Aucune case cochable, donc aucun réglage fantôme qui ne fait rien.
3. `{:else}` → `ToggleSwitch` sur `clanPointsFromDailyAlgo`, puis les
   sous-réglages révélés seulement si activé : taux de conversion, bonus de podium
   30/20/10, et un rappel de ce qui sera versé (« à la clôture du lundi, chaque
   participant reçoit ses points de la semaine en points de clan »).

**Le symétrique côté Clans** : le même panneau, en lecture/écriture, dans
`Clans.svelte`, verrouillé si `dailyAlgoEnabled` est faux (« Le Daily Algo n'est
pas activé… »). Les deux vues écrivent le même réglage - un admin qui part des
clans doit tomber sur le lien sans deviner qu'il est planqué ailleurs.

### 6.4 Onglet Administration - clôturer la semaine plus tôt

Bouton **« 🏁 Clôturer la semaine maintenant »** qui déclenche la même routine que
le cron du lundi, sans attendre. Indispensable pour tester le cycle complet sans
laisser passer sept jours.

**Le piège que ça ouvre.** Clôturer le mercredi laisse quatre jours de
participations derrière soi. Si la clôture était un verrou définitif, le cron du
lundi constaterait « déjà clôturée » et les points de tous ces participants
seraient perdus en silence - sans le moindre message d'erreur.

La clôture est donc **rejouable** : le classement est toujours recalculé, et ce qui
empêche de verser deux fois n'est pas un verrou global mais l'état de chaque ligne
`DailyAlgoWeeklyReward` - `xpGranted` marque l'XP déjà versée, `clanPointsGranted`
cumule les points de clan et seul le delta est complété. Le cron du lundi rattrape
donc naturellement une semaine clôturée à la main, et l'onglet Administration
propose « ♻️ Rattraper les points de la semaine » pour le faire tout de suite.

*Limite connue :* si un membre arrivé après la clôture manuelle prend la première
place, il touche l'XP du 1er alors que l'ancien 1er garde la sienne. Les rôles du
podium, eux, sont bien recalculés. Cas de figure uniquement atteignable via une
clôture manuelle en milieu de semaine.

Garde-fous, parce que le geste n'est pas annulable :
- Confirmation explicite avant déclenchement, avec le récapitulatif de ce qui va
  être versé (podium, nombre de participants, total de points de clan si le pont
  est actif).
- Réutilise **la même fonction** que le cron - pas un chemin parallèle qui
  divergerait. L'idempotence par `DailyAlgoWeeklyReward` protège d'un double clic.
- Une semaine déjà clôturée ne peut pas l'être deux fois : le bouton se grise et
  affiche « semaine `2026-W31` déjà clôturée ».
- Après clôture manuelle, la semaine suivante s'ouvre immédiatement.
- Trace d'audit : qui a cliqué, quand, ce qui a été versé.

L'onglet accueillera aussi le journal des clôtures passées.

### 6.5 Page publique des clans - les points Daily Algo visibles

Le flux « derniers scores » de `LevelingClanPublic.svelte`
([LevelingClanPublic.svelte:341](apps/dashboard/src/pages/LevelingClanPublic.svelte:341))
affiche déjà un badge coloré par source : **Admin** en violet, **Boost du serveur**
en rose, **XP** en bleu ciel. On ajoute la quatrième source avec son propre code
couleur :

```
DAILY_ALGO → « Daily Algo » en ambre
bg-amber-500/10 text-amber-500 border-amber-500/20
```

Ambre parce que ni le violet, ni le rose, ni le bleu ciel ne sont pris, et que
l'orange sert déjà aux noms de membres dans ce même tableau. Libellé à traduire
en fr/en comme les autres de cette page.

---

## 7. Lots de travail

Chaque lot est livrable et vérifiable seul. On valide en vrai avant de passer au suivant.

> **État au 25/07/2026 - branche `feat/daily-algo-v2`**
>
> | Lot | État |
> |---|---|
> | 0 - Fondations | ✅ livré |
> | 1 - Toute participation récompensée | ✅ livré |
> | 2 - Semaine, podium, onglet Administration | ✅ livré |
> | 3 - Pont vers les Clans | ✅ livré |
> | 4 - Week-end majoré | 🟡 le multiplicateur est appliqué et figé au tirage (fait en Lot 1). Reste : difficulté préférentielle le week-end et affichage « ×1,5 » sur l'embed du défi. |
> | 5 - Points bonus manuels | ⏸️ reporté. La table existe et le classement hebdomadaire **les lit déjà** ; il manque l'API, l'interface et la commande. |
> | 6 - Sanctions | ⏸️ reporté. Les réglages existent et sont au panel ; il manque le bouton, le câblage `sanctionService` et la pré-détection. |
> | 7 - Finitions | 🟡 i18n non fait (assumé pour livrer testable). Seul le libellé du badge public des clans est traduit fr/en. |
>
> En clair : le cycle complet **soumission → notation → points entiers → semaine →
> podium → points de clan** est fonctionnel et testable de bout en bout.

### Lot 0 - Fondations
- Créer `feat/daily-algo-v2` depuis `origin/main`.
- Migration Prisma : toutes les colonnes/modèles de la section 5.
- Nouveau module **`dailyAlgoScoring.ts`** : calcul pur des points (plancher +
  critères + rapidité + multiplicateur), sans DB → testable unitairement. C'est
  **le seul endroit** qui arrondit, avec un unique `Math.ceil` en sortie.
- Tests unitaires du scoring (`dailyAlgoService` n'en a aucun aujourd'hui), dont
  une batterie spécifique sur l'arrondi : moyennes à .5, multiplicateur de
  week-end, taux de conversion à 0.5 → jamais de virgule en sortie.

### Lot 1 - Toute participation récompensée
- Plancher de participation appliqué à l'approbation.
- Minimum 1/5 par critère côté UI de notation (plus de 0/5).
- Statut `DISMISSED` : bouton « 🚫 Hors-sujet » à côté de « ❌ Rejeter ».
- `pointsAwarded` persisté ; classements lus depuis cette colonne.
- **Perf** : `getGuildDailyAlgoRanking()` charge aujourd'hui *toutes* les
  soumissions approuvées du serveur et agrège en JS, et
  `getDailyAlgoUserProfile()` fait tourner ce calcul complet pour un seul membre.
  Avec `pointsAwarded` persisté, passage sur `groupBy` + filtre de plage de dates.
  Indispensable avant la clôture hebdo qui appellera ça en boucle.
- **Panel** : bloc « Barème & points » (plancher, multiplicateur de week-end,
  fuseau) avec l'aperçu en direct du gain moyen.
- Purge des affichages à virgule : les points passent en entiers partout (embed de
  défi, classement, bilan quotidien, DM de retour). Le détail des notes garde ses
  « /5 ».

### Lot 2 - Semaine compétitive & podium *(cœur du chantier)*
- Modèles `DailyAlgoWeek` / `DailyAlgoWeeklyReward`, helper `weekKey` (ISO, avec
  `dailyAlgoTimezone`).
- Classement hebdomadaire (nouvelle fonction, plage de dates).
- Cron de clôture **lundi 00:05** : fige le classement, calcule le podium, verse
  l'XP (`levelingService.addXp`), pose les rôles, retire ceux du podium précédent
  si `dailyAlgoWeekRoleRotate`, poste l'annonce Discord.
- Récompense de participation pour **tous** les participants de la semaine.
- Idempotence via `DailyAlgoWeeklyReward` + `rewardsGrantedAt`.
- **Panel** : bloc « Semaine & podium » - interrupteur maître, 3 sélecteurs de rôle
  **facultatifs** (vide = pas de rôle, le reste des récompenses marche quand même),
  interrupteur « rôles tournants », XP par place, XP de participation, salon
  d'annonce. Plus l'affichage « Semaine en cours » et l'historique des semaines
  clôturées.
- **Rien de tout ça ne touche aux clans.**

### Lot 3 - Pont vers les Clans
- `awardClanPointsFromDailyAlgoWeek()` appelée en fin de clôture hebdo, avec tous
  les garde-fous de la section 3.
- Conversion 1:1 (× `clanPointsFromDailyAlgoRate`) pour chaque participant +
  bonus forfaitaire au podium.
- `source: 'DAILY_ALGO'` dans `ClanContributionEvent` : étendre l'union TS
  `'XP' | 'ADMIN' | 'BOOST'` et les libellés dans `Clans.svelte` /
  `LevelingClanPublic.svelte`.
- **Panel** : le panneau verrouillé décrit en 6.2, dans `DailyAlgo.svelte`
  (verrou si `!clansEnabled`) **et** dans `Clans.svelte` (verrou si
  `!dailyAlgoEnabled`), calqué sur « Boost de Saison de Clan ».
- Tests : module clan désactivé, aucun clan, membre sans clan, double compte,
  clôture rejouée deux fois.

### Lot 4 - Week-end majoré
- `dailyAlgoWeekendMultiplier` appliqué au tirage du samedi/dimanche, selon
  `dailyAlgoTimezone` (aujourd'hui `dailyAlgoTime` est en UTC pur, donc sans
  fuseau explicite un serveur FR verrait son week-end décalé).
- Préférence pour une difficulté élevée le week-end au tirage du problème.
- Multiplicateur affiché explicitement sur l'embed de défi (« ×1.5 week-end »).

### Lot 5 - Points bonus manuels
- Modèle `DailyAlgoBonusPoint` + API + UI (réutiliser le sélecteur de membres
  avec recherche DB déjà écrit pour les clans, commit `715f694`).
- Commande staff `/dailyalgo bonus`.
- Intégration aux classements hebdo et all-time.

### Lot 6 - Sanction depuis la notation
- Troisième bouton **« 🚨 Sanctionner »** sur le message de validation staff →
  modal avec motifs présélectionnés (contenu injurieux / code malveillant /
  plagiat / troll) → `registerWarnSanction()` ou `registerTimeoutSanction()`
  selon `dailyAlgoSanctionType`.
- Effets : soumission en `REJECTED` + `abuseFlagged`, retirée du classement,
  code censuré dans le salon de validation, DM au membre, log d'audit.
- **Pré-détection** à la soumission : passage du code dans `bannedWordsService` +
  liste de motifs dangereux (`rm -rf`, fork bomb, tokens, insultes) → le message
  staff arrive déjà marqué « ⚠️ Contenu à vérifier ». Sans ça, le bouton reste
  décoratif : personne ne relit 30 soumissions à la recherche d'un dérapage.
- **Panel** : bloc « Sanctions » (type, poids, durée).

### Lot 7 - Finitions & vérification
- i18n complet : `apps/bot/messages/{fr,en}.json` **et**
  `apps/dashboard/messages/{fr,en}.json`.
- `bun run quality:bot`, couverture, `bun deploy-commands`.
- Mise à jour du README et de `PLAN_ARCHITECTURE.md`.
- **Recette manuelle** sur les 4 combinaisons de la matrice de la section 3.
- Relecture ciblée : plus aucun point à virgule visible côté membre, et chaque
  réglage de la section 5 est bien atteignable depuis le panel (rien de codé en dur).

---

## 8. Reporté (à rouvrir plus tard, dans cet ordre)

1. **Anti-triche** : hash normalisé du code pour repérer les soumissions
   quasi-identiques dans un même run. Devient utile dès que les points valent
   quelque chose - donc juste après la mise en service.
2. **Import en masse d'exercices** : les permissions `daily_algo:*` existent déjà
   sur le modèle `APIKey` (le bouton du dashboard crée bien la clé), mais
   `apps/bot/src/api/shared.ts:1160` n'accepte que `recruitment:*` et aucune
   route ne les consomme. Le câblage est à moitié fait, il ne manque que
   l'endpoint batch.
3. **Second défi quotidien** (bonus du samedi *en plus* du quotidien) : nécessite
   `slot Int` et la migration de `@@unique([guildId, dateKey])`.
4. **Correction automatique** : le socle est là (`functionName`, `functionArgs`,
   `unitTests` en base, IDE qui exécute déjà 6 langages côté client). Phase A =
   pré-remplir la note du staff à titre indicatif ; Phase B = service runner
   Docker pour un résultat fiable.
5. **Génération d'énoncés par LLM**.
6. **CDN jsdelivr de l'IDE** (Pyodide / JSCPP / Fengari / sql.js chargés depuis
   un CDN externe) : fragile hors-ligne et vis-à-vis d'une CSP.

---

## 9. Valeurs par défaut retenues

Le podium est validé. Ces valeurs sont les **défauts** posés en base : elles sont
toutes modifiables depuis le panel, sans redéploiement.

1. **Rôles du podium** : *tournants* - retirés à la clôture suivante
   (`dailyAlgoWeekRoleRotate` = `true`). Les trois champs de rôle sont facultatifs.
2. **Statut `DISMISSED`** retenu : 3 issues (approuvé / hors-sujet sans points /
   rejeté-sanctionnable).
3. **XP du podium** : 500 / 300 / 150, + 100 de participation. À recalibrer à
   l'usage (la courbe est `100·niveau² + 200·niveau`).
4. **Bonus de clan du podium** : 30 / 20 / 10, en plus de la conversion 1:1.
5. **Sanction par défaut** : avertissement de poids 1 (`registerWarnSanction`)
   plutôt qu'un timeout - on est là pour apprendre.
6. **Coins d'économie** : non distribués pour l'instant (rôle + XP + points de clan
   suffisent). Facile à brancher plus tard si besoin.
