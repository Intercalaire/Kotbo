# Pack audio du captcha vocal

Ce dossier contient un clip audio par symbole du captcha vocal : le bot les
enchaîne pour énoncer un code dans le salon vocal de vérification.

Les clips sont versionnés avec le code, comme les emojis de la carte de rang.
C'est volontaire : l'image Docker est construite depuis un clone propre, et un
pack absent au build donnerait un captcha vocal qui se replie silencieusement
sur l'image en production. Après avoir découpé une prise, commite les `.ogg`
produits.

## Organisation

Un sous-dossier par langue, `fr/` et `en/`, chacun couvrant l'alphabet complet :
26 lettres et 10 chiffres. La langue se choisit par serveur : un code doit être
énoncé entièrement dans une seule langue, sans quoi le membre entend un mélange
inintelligible.

`VOICE_ALPHABETS` dans `voiceCaptchaService.ts` définit les symboles tirables,
et les deux langues couvrent aujourd'hui les mêmes. 0 et 1 en font partie : le
captcha image les écarte parce qu'ils se confondent avec O et I une fois
dessinés, mais rien ne les confond à l'oreille.

## Convention de nommage

`<langue>/<symbole>-<variante>.ogg`, par exemple `fr/K-3.ogg`.

Le service scanne le dossier au démarrage et tire une variante au hasard à
chaque énonciation, pour qu'un même code ne produise jamais deux fois le même
flux. Il ne retient toutefois que les variantes inscrites dans
`ACCEPTED_VARIANTS`, aujourd'hui la seule `-3` : ajouter une voix demande donc
d'y inscrire son numéro.

Cette liste explicite est là pour une raison précise. `clipFor` tire au hasard,
donc un seul clip indésirable remis dans le dossier - par une régénération
distraite, par un `git checkout` d'un vieux commit - suffirait à rendre un code
sur trois inintelligible, sans que rien ne le signale : le membre échoue, le bot
croit avoir bien parlé.

## Origine des clips

Tout vient de prises humaines, découpées par
`scripts/decoupe-captcha-voice.py`, en variante `-3` :

| Pack | Symboles | Voix |
| --- | --- | --- |
| `fr/` | A-Z | Paul K |
| `fr/` | 0-9 | Nicolas |
| `en/` | A-Z, 0-9 | Adam |

Les packs de synthèse edge-tts, en `-1` et `-2`, ont été retirés. Ils rendaient
mal : le N français passait mal, et en anglais « bee », « see », « dee »,
« gee », « pee », « tee » et « vee » étaient quasi indiscernables, au point que
des membres humains y échouaient. Les scripts `generate-captcha-voice.sh` et
`generate-captcha-voice-en.sh` qui les produisaient n'ont plus d'usage ici ;
s'ils sont relancés, leurs clips seront ignorés faute d'être dans
`ACCEPTED_VARIANTS`.

Format attendu : OGG/Opus, 48 kHz, stéréo. C'est ce que Discord consomme
nativement, ce qui évite d'embarquer ffmpeg ou un encodeur Opus dans l'image
de production. C'est déjà ce que produit le script de découpe.

## Changer une voix

Une prise est un enregistrement continu, où la voix enchaîne les symboles séparés
par un silence. Le bot, lui, énonce des codes dans un ordre aléatoire : il lui
faut un fichier par symbole pour les recombiner. Quelque chose doit donc toujours
découper la prise, et c'est le workflow qui s'en charge.

Les prises vivent dans `sources/`, une par pack :

| Fichier | Contenu |
| --- | --- |
| `sources/fr-lettres.mp3` | A à Z, dans l'ordre |
| `sources/fr-chiffres.mp3` | 0 à 9, dans l'ordre |
| `sources/en-lettres.mp3` | A à Z, dans l'ordre |
| `sources/en-chiffres.mp3` | 0 à 9, dans l'ordre |

Pour changer une voix : remplacer le mp3 correspondant, puis lancer
**Prepare Voice Captcha** depuis l'onglet Actions. Il découpe les quatre prises,
vérifie que les 36 symboles sont couverts dans chaque langue, et commite les
`.ogg`. Rien à installer en local.

Les sources sont versionnées avec les clips, et pas seulement ceux-ci : sans
elles, refaire un pack demanderait de retrouver l'enregistrement d'origine, et
un seul symbole à recouper obligerait à tout réenregistrer.

Enregistrer en séparant chaque symbole d'un silence net d'au moins une
demi-seconde, et sans rien dire d'autre : chaque mot prononcé occupe un segment.

Les paramètres de découpe sont inscrits par prise dans le workflow, parce que les
prises actuelles ne sont pas propres :

- `fr-chiffres` s'ouvre sur un « en français », jeté par le `.` en tête de
  `--symboles` ;
- `en-chiffres` glisse un « ready » entre le 8 et le 9, jeté de même ;
- `en-lettres` demande `--silence-min 150`, le V et le W fusionnant au-dessus.

Ce dernier cas mérite d'être retenu, parce qu'il ne ressemble pas à une erreur :
à 250 ms le script trouvait 26 segments pour 26 lettres, donc semblait réussir.
Mais V et W n'en formaient qu'un, et le 26ᵉ segment était un mot de fin - le
compte tombait juste tout en décalant chaque lettre à partir du V. **Un compte
correct ne prouve pas un découpage correct.** Le vrai contrôle est la durée des
segments : un bloc deux à trois fois plus long que ses voisins est une fusion.

Le découpage échoue s'il détecte moins de segments que de symboles attendus,
plutôt que de décaler tout le mapping en silence ; un surplus en fin de prise est
ignoré, et les segments de moins de 120 ms sont tenus pour des clics de montage.

## Licence

Les prises sont produites par ElevenLabs. Vérifie les conditions d'utilisation
de ton offre avant toute distribution commerciale du bot : selon les cas, une
voix clonée ou de synthèse peut être soumise à des restrictions d'usage.
