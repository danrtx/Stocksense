#!/usr/bin/env bash
# Respaldo de la base de StockSense (HU-29, T-29.3).
#   ./scripts/respaldo.sh                 crea respaldos/stocksense-AAAAMMDD-HHMMSS.dump
#   ./scripts/respaldo.sh antes-de-algo   crea respaldos/antes-de-algo-AAAAMMDD-HHMMSS.dump
# Funciona igual en Git Bash (Windows), macOS y Linux. Usa el formato propio de PostgreSQL
# (comprimido, se restaura tabla por tabla) y no pasa el archivo por la terminal, para que
# PowerShell no lo dañe.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p respaldos
STAMP=$(date +%Y%m%d-%H%M%S)
FILE="${1:-stocksense}-$STAMP.dump"
DB_USER=${POSTGRES_USER:-stocksense}
DB_NAME=${POSTGRES_DB:-stocksense}

docker compose exec -T db pg_dump -U "$DB_USER" -d "$DB_NAME" -Fc -f "/tmp/$FILE"
docker compose cp "db:/tmp/$FILE" "respaldos/$FILE"
docker compose exec -T db rm -f "/tmp/$FILE"
echo "Respaldo listo: respaldos/$FILE ($(du -h "respaldos/$FILE" | cut -f1))"
