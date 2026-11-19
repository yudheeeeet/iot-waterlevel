#!/usr/bin/env bash
# Update aplikasi di VPS: ambil kode terbaru, build, migrasi database, restart service.
# Jalankan sebagai pemilik folder (bukan root), dari folder backend/:   bash deploy/vps/update.sh
set -euo pipefail
cd "$(dirname "$0")/../.."

echo "== git pull"
git -C .. pull --ff-only

echo "== backend: install + build"
npm ci --no-audit --no-fund
npm run build

echo "== database: migrasi"
npm run db:migrate

echo "== frontend: install + build (memakai .env.production)"
(cd .. && npm ci --no-audit --no-fund && npm run build)

echo "== restart service"
sudo systemctl restart baruna-api baruna-worker
sleep 3
systemctl is-active baruna-api baruna-worker
curl -fsS http://127.0.0.1:8080/api/health && echo
