#!/usr/bin/env bash
# Kotbo - texte formaté pour Conky (stats staff)
#
# Prérequis : curl, jq
# Installation :
#   1. Copie ce fichier (ex: ~/.config/conky/kotbo-conky-fetch.sh)
#   2. chmod +x kotbo-conky-fetch.sh
#   3. Renseigne KOTBO_WIDGET_TOKEN et KOTBO_API_BASE ci-dessous, ou exporte-les
#      comme variables d'environnement
#   4. Référence-le depuis ta config Conky avec ${texeci ...}
#      (voir kotbo-conky-example.conf dans ce même dossier)

set -euo pipefail

TOKEN="${KOTBO_WIDGET_TOKEN:-TON_TOKEN}"
API_BASE="${KOTBO_API_BASE:-https://kotbo.fr}"

data=$(curl -fsS --max-time 5 "${API_BASE%/}/api/public/widget-data?token=${TOKEN}") || {
  echo "Kotbo hors ligne"
  exit 0
}

jq -r '"\(.server.name) - \(.user.staffRank)\nNiveau : \(.user.level)\nMessages : \(.user.messageCount)\nVocal : \(.user.voiceMinutes) min\nStaff score : \(.user.staffScore) pts"' <<< "$data"
