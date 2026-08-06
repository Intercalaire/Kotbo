# Pack audio du captcha vocal

Ce dossier contient un clip audio par symbole du captcha vocal : le bot les
enchaîne pour énoncer un code dans le salon vocal de vérification.

Les clips sont versionnés avec le code, comme les emojis de la carte de rang.
C'est volontaire : l'image Docker est construite depuis un clone propre, et un
pack absent au build donnerait un captcha vocal qui se replie silencieusement
sur l'image en production. Après avoir lancé le script de génération, commite
les `.ogg` produits.

```bash
./scripts/generate-captcha-voice.sh
./scripts/generate-captcha-voice-en.sh
```

## Organisation

Un sous-dossier par langue, `fr/` et `en/`, chacun couvrant l'alphabet complet
(26 lettres + 10 chiffres). La langue se choisit par serveur : un code doit être
énoncé entièrement dans une seule langue, sans quoi le membre entend un mélange
inintelligible.

## Convention de nommage

`<langue>/<symbole>-<variante>.ogg`, par exemple `fr/K-1.ogg` et `fr/K-2.ogg`.
Le service scanne le dossier au démarrage et tire une variante au hasard à
chaque énonciation, pour qu'un même code ne produise jamais deux fois le même
flux. Ajouter une troisième voix ne demande donc aucune modification de code :
il suffit de déposer les `-3.ogg`.

## Origine des clips, et pourquoi les alphabets diffèrent

`VOICE_ALPHABETS` dans `voiceCaptchaService.ts` définit les symboles tirables
par langue, et ils ne se recouvrent pas.

Les **lettres françaises** viennent d'une prise humaine découpée par
`scripts/decoupe-captcha-voice.py`, en variante `-3`. La synthèse les rendait
mal, le N en particulier. Leurs variantes `-1` et `-2` ont donc été retirées :
`clipFor` tirant au hasard, les laisser aurait fait entendre une mauvaise
prononciation deux fois sur trois. Le français peut ainsi utiliser les 26
lettres.

Tout le reste, chiffres français et pack anglais entier, vient d'edge-tts en
`-1` et `-2`.

Les deux langues couvrent aujourd'hui les mêmes symboles. C'est un choix assumé
côté anglais, en attendant une prise humaine équivalente : « bee », « see »,
« dee », « gee », « pee », « tee » et « vee » y sont quasi indiscernables, et
M et N restent proches. Des membres humains y échoueront donc ; le captcha
image reste leur repli, et monter `captchaMaxAttempts` compense en partie.

**Attention en régénérant** : `generate-captcha-voice.sh` sans argument recrée
les `-1` et `-2` de toutes les lettres et réintroduit le défaut. Lui passer une
liste de symboles, comme le fait le workflow avec `0123456789`.

Format attendu : OGG/Opus, 48 kHz, stéréo. C'est ce que Discord consomme
nativement, ce qui évite d'embarquer ffmpeg ou un encodeur Opus dans l'image
de production.

## Licence

La synthèse est produite par le service Microsoft Edge TTS via `edge-tts`.
Vérifie les conditions d'utilisation de ce service avant toute distribution
commerciale du bot : selon les cas, une voix de synthèse peut être soumise à
des restrictions d'usage. Si c'est un souci, le script se réadapte sans mal à
un moteur entièrement local comme Piper, dont les modèles sont sous licences
permissives.
