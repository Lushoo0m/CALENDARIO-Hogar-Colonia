#!/usr/bin/env bash
# Guarda una copia rotativa de data.json (respaldo aparte, independiente de
# GitHub y del propio servidor) — pensado para correr solo todos los días
# vía cron. Guarda los últimos 30 respaldos con fecha y ADEMÁS "latest.json"
# (nombre fijo), para que sea fácil de bajar desde la PC con
# deploy/pull-backup.bat.
#
# Por defecto guarda en una carpeta común dentro de la propia app. Si
# armaste la carpeta cifrada (ver GUIA-SERVIDOR-PROPIO.md, sección
# "Carpeta cifrada para los respaldos"), definí BACKUP_DIR apuntando a ese
# punto de montaje antes de llamar a este script.
#
# Instalación:
#   chmod +x deploy/backup-data.sh
#   crontab -e
# Y agregar esta línea (ajustando la ruta si hace falta):
#   0 3 * * * /home/TU_USUARIO/calendario-hogar-colonia/deploy/backup-data.sh
# O, con la carpeta cifrada ya montada:
#   0 3 * * * BACKUP_DIR=/home/TU_USUARIO/respaldos-cifrados /home/TU_USUARIO/calendario-hogar-colonia/deploy/backup-data.sh
set -euo pipefail
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="${BACKUP_DIR:-$APP_DIR/backups}"
mkdir -p "$BACKUP_DIR"
DATE=$(date +%Y-%m-%d_%H%M)
cp "$APP_DIR/data.json" "$BACKUP_DIR/data-$DATE.json"
cp "$APP_DIR/data.json" "$BACKUP_DIR/latest.json"
ls -1t "$BACKUP_DIR"/data-*.json 2>/dev/null | tail -n +31 | xargs -r rm --
