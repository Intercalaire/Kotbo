#!/usr/bin/env bash
# Kotbo - module Waybar (stats staff)
#
# Prérequis : curl, jq
# Installation :
#   1. Copie ce fichier (ex: ~/.config/waybar/scripts/kotbo-waybar-module.sh)
#   2. chmod +x kotbo-waybar-module.sh
#   3. Renseigne KOTBO_WIDGET_TOKEN et KOTBO_API_BASE ci-dessous, ou exporte-les
#      comme variables d'environnement dans ta session (ex: dans ~/.bashrc)
#   4. Ajoute un module "custom/kotbo" dans ta config Waybar
#      (voir kotbo-waybar-example.jsonc dans ce même dossier)
#
# Le token se trouve sur la page Widget du dashboard Kotbo, section
# « Widgets téléphone & PC ». C'est une clé en lecture seule.

set -euo pipefail

TOKEN="${KOTBO_WIDGET_TOKEN:-TON_TOKEN}"
API_BASE="${KOTBO_API_BASE:-https://kotbo.fr}"

data=$(curl -fsS --max-time 5 "${API_BASE%/}/api/public/widget-data?token=${TOKEN}") || {
  jq -n '{text: "Kotbo hors ligne", tooltip: "Impossible de joindre l API Kotbo (verifie le token et l URL)", class: "offline"}'
  exit 0
}

level=$(jq -r '.user.level // "?"' <<< "$data")
messages=$(jq -r '.user.messageCount // "?"' <<< "$data")
voice=$(jq -r '.user.voiceMinutes // "?"' <<< "$data")
score=$(jq -r '.user.staffScore // "?"' <<< "$data")
rank=$(jq -r '.user.staffRank // "?"' <<< "$data")
server=$(jq -r '.server.name // "Kotbo"' <<< "$data")

text="${server} · lvl ${level} · ${score} pts"
tooltip=$(printf '%s - %s\nMessages : %s\nVocal : %s min\nStaff score : %s pts' "$server" "$rank" "$messages" "$voice" "$score")

jq -n --arg text "$text" --arg tooltip "$tooltip" '{text: $text, tooltip: $tooltip, class: "kotbo"}'
