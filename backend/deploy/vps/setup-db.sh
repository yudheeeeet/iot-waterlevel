#!/usr/bin/env bash
# Membuat role + database PostgreSQL untuk aplikasi (versi VPS dari deploy/local/create-db.sql).
# User, password, dan nama database diambil dari DATABASE_URL di backend/.env.
# Jalankan dari folder backend/:   sudo bash deploy/vps/setup-db.sh
# Aman dijalankan ulang (password role disamakan dengan .env).
set -euo pipefail
cd "$(dirname "$0")/../.."

[[ -f .env ]] || { echo "backend/.env belum ada" >&2; exit 1; }
URL=$(grep -E '^\s*DATABASE_URL\s*=' .env | head -1 | cut -d= -f2- | tr -d '"' | xargs)
# postgres://USER:PASSWORD@HOST:PORT/DB  (password tanpa karakter @ : / agar tidak perlu URL-encoding)
if [[ ! "$URL" =~ ^postgres(ql)?://([^:]+):([^@]+)@[^/]+/([A-Za-z0-9_]+)$ ]]; then
  echo "DATABASE_URL tidak sesuai format postgres://user:password@host:port/db" >&2; exit 1
fi
DB_USER=${BASH_REMATCH[2]}; DB_PW=${BASH_REMATCH[3]}; DB_NAME=${BASH_REMATCH[4]}
[[ "$DB_PW" == GANTI* ]] && { echo "Password di DATABASE_URL masih nilai contoh" >&2; exit 1; }

sudo -u postgres psql -v ON_ERROR_STOP=1 -q -v user="$DB_USER" -v pw="$DB_PW" -v db="$DB_NAME" <<'SQL'
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', :'user', :'pw')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'user')
\gexec
SELECT format('ALTER ROLE %I PASSWORD %L', :'user', :'pw')
\gexec
SELECT format('CREATE DATABASE %I OWNER %I', :'db', :'user')
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'db')
\gexec
SQL
echo "Database '$DB_NAME' dan role '$DB_USER' siap."
