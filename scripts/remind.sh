#!/bin/sh
# Напоминалка раз в 25 минут: запусти в отдельной вкладке на весь хакатон.
while true; do
  sleep 1500
  osascript -e 'display notification "Коммить прогресс: bun run progress \"...\"" with title "HackAlem — отчётный час" sound name "Ping"'
done
