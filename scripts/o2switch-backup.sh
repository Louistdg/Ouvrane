#!/bin/bash
# Sauvegarde quotidienne ; le cron existant appelle ce fichier à 03:30.
set -euo pipefail
umask 077
APP=/home/qita8376/ouvrane.be/app
DEST=/home/qita8376/ouvrane-backups/automatiques
mkdir -p "$DEST"
chmod 700 "$DEST"
exec 9>"$DEST/.backup.lock"
# Un autre passage actif conserve la responsabilité de la copie.
flock -n 9 || exit 0
cd "$APP"
exec /opt/alt/alt-nodejs22/root/usr/bin/node scripts/o2switch-backup-run.mjs "$APP/data/socle.sqlite" "$DEST"
