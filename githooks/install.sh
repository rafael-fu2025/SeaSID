#!/bin/sh
#
# Installs the SeaSID git hooks into this clone's hooks directory.
#
# Git hooks live under .git/ and are NOT version-controlled, so every clone
# must run this once (and again if the hook script changes). It copies the
# tracked githooks/pre-push into the active hooks path without touching git
# config.
#
#   sh githooks/install.sh
#
set -eu

root="$(git rev-parse --show-toplevel)"
src="$root/githooks/pre-push"
[ -f "$src" ] || { echo "Missing hook source: $src" >&2; exit 1; }

hooks="$(git rev-parse --git-path hooks)"
case "$hooks" in
  /*) : ;;
  *)  hooks="$root/$hooks" ;;
esac
mkdir -p "$hooks"

cp "$src" "$hooks/pre-push"
chmod +x "$hooks/pre-push"
echo "Installed pre-push hook -> $hooks/pre-push"
