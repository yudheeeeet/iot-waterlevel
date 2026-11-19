#!/usr/bin/env bash
# Memasang service systemd (API + worker) dan situs Nginx untuk folder aplikasi ini.
# Jalankan dari folder backend/:   sudo bash deploy/vps/install-services.sh
# APP_DIR = folder repo (induk backend/), USER = pemilik folder tersebut. Aman dijalankan ulang.
set -euo pipefail
cd "$(dirname "$0")/../.."

APP_DIR=$(cd .. && pwd)
APP_USER=$(stat -c %U "$APP_DIR")

render() { sed -e "s#__APP_DIR__#$APP_DIR#g" -e "s#__USER__#$APP_USER#g" "$1"; }

for svc in baruna-api baruna-worker; do
  render "deploy/vps/systemd/$svc.service" > "/etc/systemd/system/$svc.service"
done
systemctl daemon-reload
systemctl enable baruna-api baruna-worker >/dev/null 2>&1

render deploy/vps/nginx/baruna.conf > /etc/nginx/sites-available/baruna
ln -sf /etc/nginx/sites-available/baruna /etc/nginx/sites-enabled/baruna
rm -f /etc/nginx/sites-enabled/default
# Nginx (user www-data) perlu bisa masuk ke folder home untuk membaca dist/
chmod o+x "$(dirname "$APP_DIR")" "$APP_DIR"
nginx -t
systemctl reload nginx

echo "Service terpasang untuk $APP_DIR (user $APP_USER)."
echo "Jalankan / restart:  sudo systemctl restart baruna-api baruna-worker"
