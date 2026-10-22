#!/bin/bash
# OUVRANE — watchdog : relance l'application si elle ne repond plus.
APP=/home/qita8376/ouvrane.be/app
if curl -s -o /dev/null --max-time 8 "http://127.0.0.1:3100/health"; then
  exit 0
fi
cd "$APP" || exit 1
PID=$(pgrep -f "scripts/o2switch-start.mjs" | head -1)
if [ -n "$PID" ]; then
  AGE=$(( $(date +%s) - $(stat -c %Y /proc/$PID 2>/dev/null || date +%s) ))
  if [ "$AGE" -lt 60 ]; then
    exit 0
  fi
  kill "$PID" 2>/dev/null
  sleep 1
fi
(PORT=3100 nohup /opt/alt/alt-nodejs22/root/usr/bin/node scripts/o2switch-start.mjs >> app.log 2>&1 &)
sleep 2
echo "$(date -Iseconds) watchdog: application relancee" >> watchdog.log
