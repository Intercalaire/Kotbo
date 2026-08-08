# Détection de doubles comptes & Vérification de sécurité

Guide complet du système anti double-compte (DC) de Kotbo : détection automatique,
analyse comportementale « intelligente », vérification OAuth, boucle d'apprentissage,
commandes, dashboard et modèle de données.

> **Vocabulaire** - un « DC » (double compte) désigne un membre qui contrôle
> plusieurs comptes Discord sur le même serveur. Un « alt » est un compte
> secondaire. Le système ne *prouve* jamais un DC : il produit un **score de
> confiance** (0-100) et laisse toujours la décision finale au staff.

---

## 1. Vue d'ensemble

Le dispositif repose sur **trois piliers complémentaires** :

| Pilier | Déclenchement | Nature | Fichier principal |
| --- | --- | --- | --- |
| **Détection heuristique** | À l'arrivée d'un membre + scans manuels/cron | Métadonnées de compte, réseau d'invitations, sanctions | [`dcDetectionService.ts`](../apps/bot/src/services/moderation/dcDetectionService.ts) |
| **Analyse profonde (intelligente)** | En complément, sur les paires suspectées | Stylométrie, heatmap, vocal, technique (IP/device) | [`services/moderation/dc/`](../apps/bot/src/services/moderation/dc/) |
| **Vérification OAuth** | Manuelle, à l'arrivée, ou sur seuil de warns | Preuve technique via Discord OAuth (IP, device, connexions) | [`securityVerificationService.ts`](../apps/bot/src/services/moderation/securityVerificationService.ts) |

Tous les signaux sont ensuite **combinés par un moteur de scoring** commun
([`dc/scoring.ts`](../apps/bot/src/services/moderation/dc/scoring.ts)) qui tient
compte des familles de signaux, de la corroboration croisée et de poids appris.

```
Arrivée membre / scan
        │
        ├─► Heuristiques (métadonnées, invites, pseudos, sanctions…)
        │
        ├─► Analyse profonde ──► comportemental (messages)
        │                        technique (vérifs OAuth)
        │                        vocal (sessions)
        │                        pattern quotidien
        │
        ▼
   Moteur de scoring  ──► score 0-100 + gravité (LOW/MEDIUM/HIGH)
        │
        ├─► Embed dans le salon de logs (boutons Lier / Faux positif)
        ├─► Notification aux managers
        ├─► Flag MemberProfile.isSuspectedDC + dcScore
        └─► Échantillon d'apprentissage (DcDetectionSample)
                    │
             décision staff (lier / rejeter)
                    │
                    ▼
        Recalibrage des poids (DcSignalWeight)
```

---

## 2. Détection heuristique (à l'arrivée)

`analyzeMemberJoin(member)` est appelée quand un membre rejoint. Elle accumule des
**raisons** (`DetectionReason`) puis calcule un score global.

**Garde-fou anti-spam** : une alerte n'est pas renvoyée pour le même membre plus
d'une fois par **24 h** (`MemberProfile.lastDcAlertAt`).

### Critères heuristiques

| Type de signal | Ce qui est comparé | Score brut |
| --- | --- | --- |
| `young_account` | Compte créé peu avant l'arrivée (< 30 j) | 15-40 |
| `creation_proximity` | Compte créé à ±15 min d'un autre membre | 35-50 |
| `join_proximity` | Arrivée à ±10 min d'un autre membre | 15 |
| `username_similarity` | Pseudo proche (Levenshtein ≥ 75 %) ou même base | 30-40 |
| `username_numeric_suffix` | Même base + suffixe numérique différent (`pseudo1`, `pseudo2`) | +20 |
| `shared_avatar` | Même hash d'avatar | 25 |
| `no_profile_picture` | Aucun avatar + compte récent | 15 |
| `sequential_ids` | IDs Discord quasi consécutifs (création simultanée) | 40 |
| `invite_link` | Invité par un membre identifié | 20 |
| `invite_loop` | A ↔ B se sont invités mutuellement | 40 |
| `inviter_is_suspected_dc` | L'inviteur est lui-même flaggé DC | 25 |
| `same_inviter_multiple` | L'inviteur a déjà invité ≥ 3 membres suspects | 20 |
| `banned_alt` | Un alt suspecté est actuellement banni | 35 |
| `repeat_rejoiner` | A rejoint le serveur ≥ 2 fois (≥ 4 → renforcé) | 30-40 |
| `shared_sanction_history` | Mêmes types de sanctions par les mêmes modérateurs | 30 |
| `cross_server_alt` | Même IP déjà signalée DC sur un autre serveur Kotbo | 45 |
| `shared_locale` | Locale Discord identique (renfort) | +5 |
| `low_activity_pair` | Alt avec < 5 messages (renfort) | +10 |

> Les seuils de proximité vivent en constantes en tête de
> [`dcDetectionService.ts`](../apps/bot/src/services/moderation/dcDetectionService.ts)
> (`ACCOUNT_CREATION_PROXIMITY_MS`, `JOIN_PROXIMITY_MS`, `DC_ALERT_COOLDOWN_MS`…).

---

## 3. Analyse profonde (« intelligente »)

Orchestrée par `runDeepAnalysis(guildId, userId, altIds)`
([`dc/index.ts`](../apps/bot/src/services/moderation/dc/index.ts)). Toutes les
sources sont **en base de données** (aucune dépendance à un objet Discord live),
donc l'analyse est réutilisable à l'arrivée **et** au recalcul depuis le dashboard.
Au plus **8 alts** sont analysés par paire (`MAX_ALTS_ANALYZED`).

### 3.1 Signaux comportementaux ([`pairwiseSignals.ts`](../apps/bot/src/services/moderation/dc/pairwiseSignals.ts))

Construits à partir du **profil comportemental** ([`behavioralProfile.ts`](../apps/bot/src/services/moderation/dc/behavioralProfile.ts))
extrait des `MessageLog` (nécessite le logging de messages **activé** et
≥ 20 messages - `MIN_MESSAGES_FOR_BEHAVIORAL`).

| Signal | Méthode | Seuil de déclenchement | Score |
| --- | --- | --- | --- |
| `stylometry_match` | Cosinus des fréquences de mots-outils FR | ≥ 0.90 | 0-50 |
| `ngram_match` | Jaccard des trigrammes de caractères | ≥ 0.50 | 0-35 |
| `activity_heatmap` | Pearson des heatmaps 7×24 | ≥ 0.70 | 0-30 |
| `temporal_exclusivity` | Jamais actifs à la même minute (alternance) | < 3 % de collisions | 35-50 |
| `cadence_match` | Longueur, emojis, majuscules, ponctuation | ≥ 0.85 | 0-25 |
| `daily_pattern` | Pearson du volume de messages/jour (45 j) | ≥ 0.80 | 0-20 |
| `mention_network` | Jaccard des personnes mentionnées | ≥ 0.40 & ≥ 3 communs | 0-35 |
| `never_interact` | Salons communs mais aucune interaction mutuelle | ≥ 2 salons | 20 |

> **Pourquoi c'est robuste** : la stylométrie et l'exclusivité temporelle
> résistent au changement de pseudo/avatar. « Un humain ne peut pas parler avec
> ses deux comptes en même temps » est le principe des signaux d'alternance.

### 3.2 Signaux techniques ([`technicalSignals.ts`](../apps/bot/src/services/moderation/dc/technicalSignals.ts))

Issus des **vérifications OAuth** (`SecurityVerification`), en comparant la
dernière vérif de chaque compte.

| Signal | Comparaison | Score |
| --- | --- | --- |
| `device_fingerprint` | Empreinte d'appareil identique (hash stable de `deviceInfo`) | 55 |
| `shared_ip` | Adresse IP exacte partagée | 45 |
| `ip_subnet` | Même sous-réseau (/24 IPv4, /64 IPv6) sans IP exacte | 18 |
| `oauth_connections` | Comptes tiers liés en commun (Steam, Spotify…) | 25-50 |

### 3.3 Signaux vocaux ([`voiceSignals.ts`](../apps/bot/src/services/moderation/dc/voiceSignals.ts))

| Signal | Logique | Score |
| --- | --- | --- |
| `voice_alternation` | Salons vocaux communs, **jamais** présents en même temps, avec passages de relais (l'un quitte, l'autre rejoint < 2 min après) | 30-50 |

La timeline vocale est enregistrée par [`voiceTracking.ts`](../apps/bot/src/services/moderation/dc/voiceTracking.ts)
(`DcVoiceSession`), alimentée par les events du bus (`voice:join/leave/move`).
Rétention 60 jours, purge opportuniste.

---

## 4. Moteur de scoring ([`dc/scoring.ts`](../apps/bot/src/services/moderation/dc/scoring.ts))

Le score final n'est **pas** une simple somme. `computeWeightedScore()` applique
quatre mécanismes :

1. **Poids appris** - chaque type de signal a un poids (défaut `1.0`), recalibré
   par la boucle d'apprentissage (`DcSignalWeight`, global + surcharge par guilde).
2. **Redondance intra-famille** - deux signaux de la même famille (ex. `shared_ip`
   + `ip_subnet`) sont largement redondants → rendements décroissants (le plus
   fort à 100 %, les suivants à 30 %).
3. **Corroboration inter-familles** - des signaux de familles *différentes* qui
   concordent sont bien plus probants → bonus multiplicatif :

   | Familles distinctes | Multiplicateur |
   | --- | --- |
   | 2 | ×1.05 |
   | 3 | ×1.15 |
   | ≥ 4 | ×1.25 |

4. **Seuil de classification adaptatif** (`classify()`) selon la taille du serveur :

   | Taille serveur | Seuil MEDIUM | Seuil HIGH |
   | --- | --- | --- |
   | < 100 membres | 40 | 70 |
   | 100 – 5000 | 30 | 60 |
   | > 5000 membres | 25 | 55 |

### Les 7 familles de signaux

`IDENTITY`, `TEMPORAL`, `NETWORK`, `BEHAVIORAL`, `TECHNICAL`, `MODERATION`, `VOICE`
(mapping complet dans [`dc/types.ts`](../apps/bot/src/services/moderation/dc/types.ts),
constante `SIGNAL_FAMILY`). La **fiabilité** affichée dans l'embed correspond au
nombre de familles distinctes ayant contribué au score.

---

## 5. Boucle d'apprentissage ([`dc/learning.ts`](../apps/bot/src/services/moderation/dc/learning.ts))

Le système s'auto-améliore à partir des décisions du staff :

1. Chaque détection enregistre son **vecteur de features** (`DcDetectionSample`,
   `label = null`).
2. La décision staff fournit le **label** :
   - **Lier les comptes** → `TRUE_POSITIVE`
   - **Faux positif** → `FALSE_POSITIVE`
3. À partir de **20 échantillons labellisés** (`MIN_LABELED_FOR_CALIBRATION`),
   `recalibrateWeights()` recalcule les poids : un signal fréquent chez les vrais
   positifs voit son poids monter (jusqu'à `2.0`), un signal fréquent chez les
   faux positifs voit le sien baisser (jusqu'à `0.2`).

Le recalibrage est **asynchrone** et **best-effort** (ne bloque jamais la décision).
Les poids sont mis en cache 15 min (`WEIGHTS_TTL_MS`).

---

## 6. Vérification de sécurité (OAuth)

Fournit une **preuve technique** via Discord OAuth : le membre s'authentifie sur
le dashboard, ce qui capture (selon la config) son **IP**, son **empreinte
d'appareil** et ses **connexions tierces**.

### 6.1 Cycle de vie ([`securityVerificationService.ts`](../apps/bot/src/services/moderation/securityVerificationService.ts))

```
createVerificationSession()  ──►  token (valable 24h, PENDING)
        │
   DM / embed avec bouton  ──►  /verify/{guildId}/{token} (dashboard)
        │
   OAuth Discord + collecte IP/device/connexions
        │
   completeVerification()
        ├─ mismatch d'identité  ──► FLAGGED + duplicateDetected
        ├─ même IP / même device qu'un autre membre  ──► duplicate
        └─ OK  ──► VERIFIED (+ rôle de vérif, retrait timeout)
```

Statuts : `PENDING`, `VERIFIED`, `FLAGGED`, `EXPIRED`. Les vérifs expirées sont
nettoyées par `cleanupExpiredVerifications()` (cron).

### 6.2 Modes de déclenchement

| Déclencheur | Comment | Niveau |
| --- | --- | --- |
| **Manuel** | Commande `/request-verification` ou menu contextuel *« Demander vérification »* | `verificationLevelCommand` |
| **À l'arrivée** | `verificationOnJoin` activé | `verificationLevelJoin` |
| **Seuil de warns** | `verificationWarnThreshold` atteint | via [`verificationWarnThresholdService.ts`](../apps/bot/src/services/moderation/verificationWarnThresholdService.ts) |

### 6.3 Action en cas de doublon détecté (`verificationAction`)

- `AUTO_LINK` - lie automatiquement les deux comptes + notifie le staff.
- `NOTIFY_STAFF` - notifie seulement le staff (décision manuelle).

### 6.4 Vérification automatique sur seuil de warns

Après chaque warn, `checkAndTriggerVerificationThreshold()` compte les warns. Si le
seuil (`verificationWarnThreshold`) est atteint et qu'aucune vérif `PENDING` n'existe :

- **`FULL_AUTO`** - timeout 28 j (max Discord) + DM de vérification immédiat.
- **`NOTIFY_STAFF`** - embed dans le salon de log avec bouton *« Lancer la
  vérification maintenant »*.

---

## 7. Commandes

### `/dc` ([`commands/moderation/dc.ts`](../apps/bot/src/commands/moderation/dc.ts))

| Sous-commande | Rôle | Permission |
| --- | --- | --- |
| `/dc link <compte1> <compte2> [raison]` | Lier deux comptes | Staff (raison obligatoire) - non-staff : uniquement son propre compte, en attente de validation |
| `/dc list <cible>` | Lister les comptes liés à un membre | `ModerateMembers` |
| `/dc report <principal>` | Déclarer de bonne foi son compte principal | Tout membre |
| `/dc unlink <compte1> <compte2>` | Supprimer un lien | `ModerateMembers` |
| `/dc scan [seuil_jours]` | Signaler les comptes trop récents à l'arrivée | Staff / `ModerateMembers` |
| `/dc rescan [seuil_jours]` | Relancer le scan de détection | Staff / `ModerateMembers` |

### `/request-verification` ([`commands/moderation/request-verification.ts`](../apps/bot/src/commands/moderation/request-verification.ts))

`/request-verification <membre> [raison]` - met le membre en **timeout 28 j**,
crée une session de vérification et lui envoie le DM. Existe aussi en **menu
contextuel utilisateur** : *« Demander vérification »*. Permission : `ModerateMembers`.

### Interactions boutons (salon de logs)

| `customId` | Effet |
| --- | --- |
| `dc_validate_<user>_<alt>` / `dc_validate_link:<u1>:<u2>` | Lie les comptes → `TRUE_POSITIVE`, DM aux membres, reset des flags |
| `dc_reject_<user>` / `dc_reject_link:<u1>:<u2>` | Faux positif → `FALSE_POSITIVE`, reset du profil |
| `verif_threshold_trigger:<user>` | Lance la vérification depuis la notif staff |

---

## 8. Dashboard - page « Doubles comptes »

[`apps/dashboard/src/pages/DoubleAccounts.svelte`](../apps/dashboard/src/pages/DoubleAccounts.svelte),
route `/double-accounts`, quatre onglets :

| Onglet | Contenu |
| --- | --- |
| **Liens** (`links`) | Comptes liés, validation/rejet des déclarations en attente, suppression |
| **Détections** (`detections`) | Membres flaggés, détail des heuristiques par score, bouton *Lier* / *Ignorer*, scan manuel |
| **Vérification** (`verification`) | Config du système OAuth (mode, action, rôle, embed, IP/device, seuil warns) |
| **Config** (`config`) | Réglages généraux + activation du logging de messages (analyse comportementale) |

> **Détection intelligente = opt-in** : l'analyse comportementale nécessite
> d'activer le **logging des messages** (télémétrie). Une modale le propose depuis
> l'onglet Config si ce n'est pas encore fait.

---

## 9. Modèle de données

### Détection intelligente ([`dc-detection.prisma`](../packages/database/prisma/dc-detection.prisma))

| Modèle | Rôle |
| --- | --- |
| `DcVoiceSession` | Timeline vocale (join/leave) pour l'alternance de présence |
| `DcDetectionSample` | Dataset labellisé de la boucle d'apprentissage |
| `DcSignalWeight` | Poids appris par type de signal (`guildId = null` → global) |

### Profil membre ([`guild.prisma`](../packages/database/prisma/guild.prisma))

| Champ `MemberProfile` | Rôle |
| --- | --- |
| `isSuspectedDC` | Flag de suspicion courant |
| `dcScore` | Dernier score calculé (0-100) |
| `lastDcAlertAt` | Horodatage de la dernière alerte (cooldown 24 h) |

### Configuration guilde (`Guild`)

Champs `verification*` : `verificationEnabled`, `verificationMode`,
`verificationAction`, `verificationRoleId`, `verificationOnJoin`,
`verificationSaveIp`, `verificationSaveDevice`, `verificationLevelJoin/Command`,
`verificationWarnThreshold`, `verificationWarnAutoMode`, `verificationWarnReason`,
`verificationEmbed*`, `verificationLogChannelId`. Relation `securityVerifications`.

### Migrations associées

- `20260710120000_add_verification_warn_threshold`
- `20260710120100_add_dc_score_tracking`
- `20260710130000_add_dc_intelligence`

---

## 10. Vie privée & RGPD

Ce système traite des données sensibles - à garder à l'esprit :

- **IP & empreinte d'appareil** : capturées uniquement à la vérification OAuth et
  **seulement** si `verificationSaveIp` / `verificationSaveDevice` sont activés.
  Les appels de ban (ban appeals) ont leurs propres toggles (`appealSaveIp`,
  `appealSaveDevice`).
- **Analyse comportementale** : nécessite le logging de messages **opt-in**. Sans
  lui, aucun profil stylométrique n'est calculé.
- **Finalité** : lutte contre les doubles comptes / contournements de sanction
  uniquement. Voir le dossier de gouvernance [`docs/privacy/`](./privacy/).
- **Rétention** : sessions vocales 60 j, fenêtres d'analyse comportementale 45 j.

---

## 11. Points d'extension

- **Ajouter un signal** : étendre `DcSignalType` + `SIGNAL_FAMILY` dans
  [`dc/types.ts`](../apps/bot/src/services/moderation/dc/types.ts), produire le
  signal dans l'analyseur adéquat, il sera automatiquement pondéré et appris.
- **Ajuster les seuils** : constantes en tête de chaque analyseur.
- **Surcharger un poids par guilde** : insérer une ligne `DcSignalWeight` avec le
  `guildId` (prioritaire sur le poids global `null`).
