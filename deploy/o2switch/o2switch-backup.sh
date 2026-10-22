#!/bin/bash
# OUVRANE — sauvegarde SQLite datee, conserve les 14 dernieres copies.
APP=/home/qita8376/ouvrane.be/app
DEST=/home/qita8376/ouvrane-backups
mkdir -p "$DEST"
STAMP=$(date +%Y%m%d-%H%M%S)
if [ -f "$APP/data/socle.sqlite" ]; then
  sqlite3 "$APP/data/socle.sqlite" ".backup '$DEST/socle-$STAMP.sqlite'" 2>/dev/null || cp "$APP/data/socle.sqlite" "$DEST/socle-$STAMP.sqlite"
  echo "$(date -Iseconds) backup: socle-$STAMP.sqlite ($(du -h "$DEST/socle-$STAMP.sqlite" 2>/dev/null | cut -f1))" >> "$APP/backup.log"
  ls -t "$DEST"/socle-*.sqlite 2>/dev/null | tail -n +15 | xargs -r rm -f
fi
