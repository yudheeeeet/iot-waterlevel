-- Membuat user & database lokal untuk development dan test.
-- Jalankan sebagai superuser postgres (PowerShell):
--   & "C:\Program Files\PostgreSQL\18\bin\psql.exe" -U postgres -v pw="PASSWORD_BARU_UNTUK_BARUNA" -f deploy/local/create-db.sql
-- Aman dijalankan ulang (idempotent).

SELECT format('CREATE ROLE baruna LOGIN PASSWORD %L', :'pw')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'baruna')
\gexec

SELECT format('ALTER ROLE baruna PASSWORD %L', :'pw')
\gexec

SELECT 'CREATE DATABASE baruna_dev OWNER baruna'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'baruna_dev')
\gexec

SELECT 'CREATE DATABASE baruna_test OWNER baruna'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'baruna_test')
\gexec
