#!/usr/bin/env bash
# Met a jour les deux lockfiles apres une modification de dependances.
#
# Le depot en porte deux : bun.lock pour la racine (dashboard, outillage) et
# bun.bot.lock pour package.bot.json, le jeu reduit qu'installe l'image de
# production du bot. `bun install` ne connait que le premier ; oublier le second
# fait echouer le build Docker du bot sur --frozen-lockfile.
#
# Usage : ./scripts/sync-lockfiles.sh

set -euo pipefail

cd "$(dirname "$0")/.."

restore() {
  [ -f /tmp/kotbo-package.root.json ] && mv /tmp/kotbo-package.root.json package.json
  [ -f /tmp/kotbo-bun.root.lock ] && mv /tmp/kotbo-bun.root.lock bun.lock
}
trap restore EXIT

echo "→ bun.bot.lock (jeu de dependances du bot)"
cp package.json /tmp/kotbo-package.root.json
cp bun.lock /tmp/kotbo-bun.root.lock
cp package.bot.json package.json
cp bun.bot.lock bun.lock
bun install
cp bun.lock bun.bot.lock
restore
trap - EXIT

echo "→ bun.lock (racine)"
bun install

echo
echo "Lockfiles a jour. A commiter :"
git status --short bun.lock bun.bot.lock
