#!/usr/bin/env bash
# Restaura un respaldo de StockSense (HU-29, T-29.3).
#   ./scripts/restaurar.sh respaldos/stocksense-20261107-212700.dump
#
# 1. Detiene la API y el servicio de pronóstico (nadie escribe mientras se restaura).
# 2. Guarda primero un respaldo del estado actual, por si hay que volver atrás.
# 3. Borra la base, la crea de nuevo y carga el respaldo.
# 4. Arranca todo y muestra cuántos productos, ventas y usuarios quedaron.
set -euo pipefail
cd "$(dirname "$0")/.."
DUMP=${1:?Indica el archivo, por ejemplo: ./scripts/restaurar.sh respaldos/stocksense-20261107-212700.dump}
[ -f "$DUMP" ] || { echo "No existe $DUMP"; exit 1; }
DB_USER=${POSTGRES_USER:-stocksense}
DB_NAME=${POSTGRES_DB:-stocksense}

read -r -p "Esto reemplaza TODOS los datos actuales por los de $DUMP. Escribe RESTAURAR para seguir: " OK
[ "$OK" = "RESTAURAR" ] || { echo "Cancelado."; exit 1; }

docker compose cp "$DUMP" db:/tmp/restaurar.dump
./scripts/respaldo.sh antes-de-restaurar
docker compose stop backend forecast
docker compose exec -T db dropdb -U "$DB_USER" --if-exists --force "$DB_NAME"
docker compose exec -T db createdb -U "$DB_USER" "$DB_NAME"
docker compose exec -T db pg_restore -U "$DB_USER" -d "$DB_NAME" --no-owner /tmp/restaurar.dump
docker compose exec -T db rm -f /tmp/restaurar.dump
docker compose start backend forecast
docker compose exec -T db psql -U "$DB_USER" -d "$DB_NAME" -c \
  "SELECT (SELECT count(*) FROM products) AS productos, (SELECT count(*) FROM sales) AS ventas, (SELECT count(*) FROM users) AS usuarios"
echo "Restauración terminada. Entra a la aplicación y revisa el panel."
