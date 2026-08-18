#!/usr/bin/env bash
# Guarda una copia rotativa de data.json (respaldo aparte, independiente de
# GitHub y del propio servidor) — pensado para correr solo todos los días
# vía cron. Guarda los últimos 30 respaldos y borra los más viejos.
#
# Instalación:
#   chmod +x deploy/backup-data.sh
#   crontab -e
# Y agregar esta línea (ajustando la ruta si hace falta):
#   0 3 * * * /home/TU_USUARIO/calendario-hogar-colonia/deploy/backup-data.sh
set -euo pipefail
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="$APP_DIR/backups"
mkdir -p "$BACKUP_DIR"
DATE=$(date +%Y-%m-%d_%H%M)
cp "$APP_DIR/data.json" "$BACKUP_DIR/data-$DATE.json"
ls -1t "$BACKUP_DIR"/data-*.json 2>/dev/null | tail -n +31 | xargs -r rm --
