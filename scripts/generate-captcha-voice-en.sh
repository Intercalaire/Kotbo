#!/usr/bin/env bash
# Génère le pack audio anglais du captcha vocal : un clip OGG/Opus par symbole.
#
# Pendant de generate-captcha-voice.sh, qui produit le pack français. Les deux
# packs vivent dans des sous-dossiers distincts : la langue se choisit par
# serveur, un code ne doit jamais mélanger les deux.
#
# À lancer une seule fois, hors production. Le bot ne synthétise rien au
# runtime : il se contente de diffuser ces fichiers, ce qui lui évite toute
# dépendance réseau et toute latence au moment où il en a le moins besoin.
#
# Prérequis (uniquement pour cette génération, pas pour faire tourner le bot) :
#   pipx install edge-tts   # synthèse vocale Microsoft, sans clé d'API
#   apt install ffmpeg      # conversion vers OGG/Opus 48 kHz
#
# Usage : ./scripts/generate-captcha-voice-en.sh

set -euo pipefail

OUT_DIR="$(dirname "$0")/../apps/bot/assets/captcha-voice/en"

# Deux voix : le pack alterne aléatoirement pour qu'un même code ne produise
# jamais deux fois le même flux audio.
VOICES=("en-US-AriaNeural" "en-US-GuyNeural")

# Prononciations anglaises de l'alphabet complet. Attention : B/C/D/E/G/P/T/V/Z
# riment tous en anglais américain ("bee", "see", "dee", "zee"…), et M/N restent
# proches. Les codes tirés dans ces symboles font échouer des membres
# légitimes ; prévoir un captchaMaxAttempts en conséquence.
# VOICE_ALPHABET dans voiceCaptchaService.ts doit être élargi à cette liste,
# sinon le service ignore les clips dont le symbole ne lui est pas connu.
declare -A SYMBOLS=(
  [A]="ay"        [B]="bee"     [C]="see"     [D]="dee"
  [E]="ee"        [F]="eff"     [G]="jee"     [H]="aitch"
  [I]="eye"       [J]="jay"     [K]="kay"     [L]="el"
  [M]="em"        [N]="en"      [O]="oh"      [P]="pee"
  [Q]="cue"       [R]="ar"      [S]="ess"     [T]="tee"
  [U]="you"       [V]="vee"     [W]="double you"
  [X]="ex"        [Y]="why"     [Z]="zee"
  [0]="zero"      [1]="one"     [2]="two"     [3]="three"
  [4]="four"      [5]="five"    [6]="six"     [7]="seven"
  [8]="eight"     [9]="nine"
)

mkdir -p "$OUT_DIR"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

for symbol in "${!SYMBOLS[@]}"; do
  spoken="${SYMBOLS[$symbol]}"
  variant=1
  for voice in "${VOICES[@]}"; do
    echo "  $symbol (\"$spoken\") — $voice"
    edge-tts --voice "$voice" --rate=-10% --text "$spoken" --write-media "$tmp/clip.mp3"
    ffmpeg -loglevel error -y -i "$tmp/clip.mp3" \
      -c:a libopus -b:a 48k -ar 48000 -ac 2 \
      "$OUT_DIR/${symbol}-${variant}.ogg"
    variant=$((variant + 1))
  done
done

echo "Pack généré dans $OUT_DIR ($(ls -1 "$OUT_DIR"/*.ogg | wc -l) clips)."
