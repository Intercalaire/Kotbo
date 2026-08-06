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

Les packs couvrent les 36 symboles, mais `VOICE_ALPHABET` dans
`voiceCaptchaService.ts` n'en tire qu'un sous-ensemble. L'alphabet complet
contient en effet des homophones : B/C/D/G/P/T/V se ressemblent beaucoup en
français, M et N aussi, et B/C/D/E/G/P/T/V/Z riment en anglais. Un code qui
tombe dessus fait échouer des membres légitimes, ensuite kick ou ban selon la
configuration.

Générer large coûte peu et rend l'arbitrage réversible : élargir
`VOICE_ALPHABET` suffit à réutiliser des clips déjà présents, sans régénérer
quoi que ce soit. Le service ignore silencieusement ceux qu'il n'utilise pas.

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
