#!/usr/bin/env bash
# Prepara un servidor Ubuntu (Oracle Cloud Always Free, ARM) para StockSense.
# Se corre una sola vez, conectado por SSH al servidor:
#
#   curl -fsSL https://raw.githubusercontent.com/danrtx/Stocksense/main/deploy/preparar-servidor.sh | bash
#
# Qué hace:
#  1. Actualiza el sistema y activa las actualizaciones de seguridad automáticas.
#  2. Instala Docker y Docker Compose.
#  3. Abre los puertos 80 y 443 en el firewall interno de Ubuntu (las imágenes de Oracle
#     los traen cerrados aunque se abran en la consola de Oracle).
#  4. Pone la hora de Colombia.
#  5. Descarga StockSense en ~/stocksense.
#  6. Programa un respaldo de la base cada noche a las 3:30 a. m. (guarda 14 días).
set -euo pipefail

echo "== 1/6 Actualizando el sistema"
sudo apt-get update -y
sudo DEBIAN_FRONTEND=noninteractive apt-get upgrade -y
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y git curl unattended-upgrades iptables-persistent
sudo dpkg-reconfigure -f noninteractive unattended-upgrades

echo "== 2/6 Instalando Docker"
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sudo sh
fi
sudo usermod -aG docker "$USER"

echo "== 3/6 Abriendo los puertos 80 y 443"
for rule in "tcp 80" "tcp 443" "udp 443"; do
  set -- $rule
  if ! sudo iptables -C INPUT -p "$1" --dport "$2" -m state --state NEW -j ACCEPT 2>/dev/null; then
    # Antes de la regla REJECT que traen las imágenes de Oracle.
    sudo iptables -I INPUT 5 -p "$1" --dport "$2" -m state --state NEW -j ACCEPT
  fi
done
sudo netfilter-persistent save

echo "== 4/6 Hora de Colombia"
sudo timedatectl set-timezone America/Bogota

echo "== 5/6 Descargando StockSense"
if [ ! -d "$HOME/stocksense/.git" ]; then
  git clone https://github.com/danrtx/Stocksense.git "$HOME/stocksense"
else
  git -C "$HOME/stocksense" pull --ff-only
fi
chmod +x "$HOME/stocksense/scripts/"*.sh

echo "== 6/6 Respaldo diario"
CRON="30 3 * * * cd $HOME/stocksense && ./scripts/respaldo.sh >> respaldos/respaldo.log 2>&1 && find respaldos -name '*.dump' -mtime +14 -delete"
( crontab -l 2>/dev/null | grep -v 'scripts/respaldo.sh' ; echo "$CRON" ) | crontab -
mkdir -p "$HOME/stocksense/respaldos"

cat <<MSG

Servidor listo. Sigue con la guía (docs/despliegue-oracle.md, paso 5):
  1. Cierra la sesión SSH y vuelve a entrar (para usar docker sin sudo).
  2. cd ~/stocksense && cp .env.production.example .env && nano .env
  3. docker compose up -d --build
MSG
