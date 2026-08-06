#!/usr/bin/env bash
# Génère le pack audio du captcha vocal : un clip OGG/Opus par symbole.
#
# À lancer une seule fois, hors production. Le bot ne synthétise rien au
# runtime : il se contente de diffuser ces fichiers, ce qui lui évite toute
# dépendance réseau et toute latence au moment où il en a le moins besoin.
#
# Prérequis (uniquement pour cette génération, pas pour faire tourner le bot) :
#   pipx install edge-tts   # synthèse vocale Microsoft, sans clé d'API
#   apt install ffmpeg      # conversion vers OGG/Opus 48 kHz
#
# Usage : ./scripts/generate-captcha-voice.sh
#
# Pendant vocal anglais : ./scripts/generate-captcha-voice-en.sh

set -euo pipefail

OUT_DIR="$(dirname "$0")/../apps/bot/assets/captcha-voice/fr"

# Filtre optionnel : ne régénérer que ces symboles, par exemple "23456789".
# Les lettres françaises viennent d'une prise humaine (variante -3), la synthèse
# les rendant mal, le N en particulier. Régénérer sans filtre recréerait leurs
# variantes -1 et -2, que le service tirerait ensuite une fois sur trois.
ONLY="${1:-}"

# Deux voix : le pack alterne aléatoirement pour qu'un même code ne produise
# jamais deux fois le même flux audio.
VOICES=("fr-FR-DeniseNeural" "fr-FR-HenriNeural")

# Prononciations françaises de l'alphabet complet. La table reste complète pour
# permettre une régénération intégrale, mais les lettres du pack français
# viennent aujourd'hui d'une prise humaine (variante -3) : la synthèse les rend
# mal, le N en particulier. Voir VOICE_ALPHABETS dans voiceCaptchaService.ts
# pour les symboles réellement tirés, et le filtre ONLY ci-dessus.
declare -A SYMBOLS=(
  [A]="ah"        [B]="bé"      [C]="cé"      [D]="dé"
  [E]="euh"       [F]="effe"    [G]="gé"      [H]="ache"
  [I]="i"         [J]="ji"      [K]="ka"      [L]="elle"
  [M]="aime"      [N]="enne"    [O]="o"       [P]="pé"
  [Q]="ku"        [R]="erre"    [S]="esse"    [T]="té"
  [U]="u"         [V]="vé"      [W]="double vé"
  [X]="ixe"       [Y]="i grec"  [Z]="zède"
  [0]="zéro"      [1]="un"      [2]="deux"    [3]="trois"
  [4]="quatre"    [5]="cinq"    [6]="six"     [7]="sept"
  [8]="huit"      [9]="neuf"
)

mkdir -p "$OUT_DIR"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

for symbol in "${!SYMBOLS[@]}"; do
  if [ -n "$ONLY" ] && [[ "$ONLY" != *"$symbol"* ]]; then
    continue
  fi
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

echo "Pack ${ONLY:-complet} généré dans $OUT_DIR ($(ls -1 "$OUT_DIR"/*.ogg | wc -l) clips au total)."
