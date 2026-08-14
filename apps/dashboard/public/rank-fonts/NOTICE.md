# Polices de la carte de rang

Ces polices ne sont pas produites par Kotbo. Elles sont toutes sous licence
SIL Open Font License 1.1, dont la clause 2 autorise explicitement à les
redistribuer et à les vendre avec un logiciel, à condition que chaque copie
soit accompagnée de sa notice de copyright et de sa licence. C'est le rôle des
fichiers `<police>.OFL.txt` déposés à côté de chaque fonte.

| Fichier | Famille | Détenteur du copyright | Nom réservé |
|---|---|---|---|
| `lato.woff2` | Lato | tyPoland Lukasz Dziedzic | oui |
| `poppins.woff2` | Poppins | The Poppins Project Authors | non |
| `barlow.woff2` | Barlow | The Barlow Project Authors | non |
| `kanit.woff2` | Kanit | The Kanit Project Authors | non |
| `ptserif.woff2` | PT Serif | ParaType Ltd. | oui |
| `arvo.woff2` | Arvo | Anton Koovit | oui |
| `spacemono.woff2` | Space Mono | The Space Mono Project Authors | non |

Deux limites à connaître avant de toucher à ces fichiers :

- les fontes ne peuvent pas être vendues **seules** (clause 1) ; les vendre
  avec le bot ne pose aucun problème ;
- aucune version **modifiée** ne peut conserver un nom réservé (clause 3). Si
  un jour ces fontes sont allégées par sous-ensemble de glyphes, ce qui compte
  comme une modification, Lato, PT Serif et Arvo devront être renommées. Les
  quatre autres n'ont pas de nom réservé et se subsettent sans renommage.

Les mêmes familles et la même graisse sont embarquées en TTF dans
`apps/bot/assets/rank-fonts`, avec les mêmes fichiers de licence.
