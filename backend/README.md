# Backend — Baruna Inotek Water Level Monitoring

Spesifikasi: [../PRD.md](../PRD.md) · Rencana: [../tasks/plan.md](../tasks/plan.md)

Dua program dari satu codebase:

| Program | Perintah | Fungsi |
|---|---|---|
| `api` | `npm run dev` → http://localhost:8080 | REST untuk dashboard (login, device, histori, export, cuaca) |
| `worker` | `npm run worker` | Menerima data MQTT, menyimpan reading, status online/offline |

## Setup lokal (Windows, tanpa Docker)

Prasyarat: Node.js ≥ 22, PostgreSQL 18 (service `postgresql-x64-18` berjalan), Mosquitto for Windows.

### 1. Dependency & env
```powershell
cd backend
npm install
copy .env.example .env
```
Isi semua nilai `GANTI_*` di `.env`. Untuk secret acak:
```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

### 2. Database lokal (sekali)
Membuat user `baruna`, database `baruna_dev` (development) dan `baruna_test` (test otomatis):
```powershell
& "C:\Program Files\PostgreSQL\18\bin\psql.exe" -h localhost -U postgres -v pw="PASSWORD_UNTUK_BARUNA" -f deploy/local/create-db.sql
```
Lalu isi password yang sama di `DATABASE_URL` dan `TEST_DATABASE_URL` pada `.env`, kemudian:
```powershell
npm run db:check      # harus: OK baruna@baruna_dev
npm run db:migrate    # membuat tabel (aman dijalankan ulang)
npm run db:seed       # admin@baruna.local + viewer@baruna.local, password dicetak SEKALI
```

> PostgreSQL lokal versi 18, Supabase versi 17. Migrasi hanya memakai fitur PostgreSQL 17.

### 3. Broker Mosquitto lokal (sekali, lalu setiap development)
Broker proyek berjalan di **port 1884**, terpisah dari service Mosquitto bawaan Windows (1883).
Data & akun disimpan di `backend/.mosquitto/` (tidak di-commit).
```powershell
npm run broker:init    # sekali: Dynamic Security + akun baruna-backend (password dari .env)
                       # aman dijalankan ulang; jalankan ulang setelah update (hentikan broker:local dulu)
npm run broker:local   # menjalankan broker (biarkan terminal ini terbuka)
```
Cek cepat (terminal lain):
```powershell
& "C:\Program Files\mosquitto\mosquitto_sub.exe" -h 127.0.0.1 -p 1884 -t "baruna/devices/#" -W 3
# → "Connection Refused: not authorised" (anonim ditolak, benar)
& "C:\Program Files\mosquitto\mosquitto_sub.exe" -h 127.0.0.1 -p 1884 -u baruna-backend -P "<MQTT_PASSWORD>" -t "baruna/devices/#" -W 3
# → "Timed out" (tersambung, belum ada pesan, benar)
```

### 4. Menjalankan
```powershell
npm run dev            # api
npm run worker         # worker (terminal lain)
```
Worker menyamakan akun device di Mosquitto dengan database setiap kali tersambung ke broker:
akun tanpa device dihapus, device tanpa akun ditandai `needs_token_rotation` (perbaiki dengan rotasi token).

## Device & broker

| Endpoint | Akses | Keterangan |
|---|---|---|
| `GET /api/devices`, `GET /api/devices/:id` | login | `online` dihitung saat dibaca |
| `POST /api/devices` | admin | body `{ id, name, lat, lon, reportingIntervalSec?, thresholdWarningCm?, thresholdCriticalCm?, installedAt? }` → device + `token` (**sekali tampil**) + `mqtt` |
| `PATCH /api/devices/:id` | admin | nama, lokasi, interval, threshold, `isEnabled`, `brokerSynced: true` (mode manual) |
| `POST /api/devices/:id/token/rotate` | admin | token baru, token lama langsung ditolak broker |
| `DELETE /api/devices/:id` | admin | soft delete; histori tetap; ID tidak bisa dipakai ulang |

- `BROKER_PROVIDER=mosquitto`: akun device dibuat/diubah/dihapus otomatis. Device hanya boleh publish ke
  `baruna/devices/{id}/readings` dan `/status`. Gagal sinkron → `brokerSyncStatus: "error"` + `brokerError`; ulangi dengan rotasi token.
- `BROKER_PROVIDER=manual` (HiveMQ Cloud): response berisi `brokerSetup.steps` untuk dikerjakan di console HiveMQ,
  status `pending` sampai admin mengirim `PATCH { "brokerSynced": true }`.
- ID `admin`, `baruna-backend`, dan `MQTT_USERNAME` dicadangkan untuk akun sistem broker.

## Perintah

| Perintah | Keterangan |
|---|---|
| `npm test` | Unit + integration test. Test database memakai `TEST_DATABASE_URL` (dikosongkan & dimigrasi ulang); dilewati bila belum diisi. Test broker memakai Mosquitto lokal (`npm run broker:local`, hanya `127.0.0.1`/`localhost`); dilewati bila tidak berjalan |
| `npm run lint` | ESLint + TypeScript check |
| `npm run build` | Kompilasi ke `dist/` |
| `npm run db:check` / `db:migrate` / `db:seed` | Cek koneksi, migrasi, data awal (memakai `DATABASE_URL`) |
| `npm run user:create -- --email a@b.c --name "Nama" --role admin\|viewer` | Membuat user; password acak dicetak sekali (atau `--password`) |
| `npm run user:reset-password -- --email a@b.c` | Reset password + cabut semua sesi |
| `npm run broker:init` / `broker:local` | Setup & menjalankan Mosquitto lokal |
| `npm run broker:ping` | Uji koneksi broker di `.env` (connect, subscribe, publish → terima, latency) |
| `npm run broker:ping -- --env .env.hivemq` | Sama, untuk broker lain (mis. HiveMQ Cloud) tanpa mengubah `.env` |

## Checklist akun layanan untuk demo (oleh Gilang)

Kredensial **tidak dikirim lewat chat**; isi langsung di `.env` lokal dan environment variables Vercel.

- [ ] **Supabase**: buat project (region Singapore), simpan database password.
  Project Settings → Database → Connection string:
  - pooler **Session** (port 5432) → untuk `npm run db:migrate` dan worker
  - pooler **Transaction** (port 6543) → untuk api di Vercel (Task 19)
- [ ] **HiveMQ Cloud**: buat cluster Serverless (Free). Catat host cluster (`xxxx.s1.eu.hivemq.cloud`), port TLS 8883.
  Access Management → buat credential `baruna-backend` (Publish & Subscribe). Credential device dibuat per device di Task 6.
- [ ] **Vercel**: akun terhubung ke GitHub repo ini (project dibuat di Task 19).
- [ ] Uji migrasi ke Supabase: set sementara `DATABASE_URL` ke URL Session pooler, jalankan `npm run db:check` lalu `npm run db:migrate`, kemudian kembalikan ke URL lokal.

## Variabel environment

Lihat [.env.example](.env.example). Ringkasnya:

| Variabel | Dipakai oleh | Keterangan |
|---|---|---|
| `DATABASE_URL` | api, worker, CLI | PostgreSQL lokal / Supabase |
| `TEST_DATABASE_URL` | test | Harus menunjuk database `*_test` |
| `JWT_SECRET`, `ACCESS_TOKEN_TTL_SEC`, `REFRESH_TOKEN_TTL_DAYS`, `COOKIE_SECURE` | api | Login (access token 15 menit, refresh 7 hari) |
| `BROKER_PROVIDER` | api, worker | `mosquitto` (lokal/produksi) atau `manual` (HiveMQ) |
| `MQTT_URL`, `MQTT_USERNAME`, `MQTT_PASSWORD` | worker, api | Koneksi ke broker |
| `MQTT_DYNSEC_ADMIN_PASSWORD` | `broker:init` saja | Admin Dynamic Security lokal |
| `MQTT_PUBLIC_HOST`, `MQTT_PUBLIC_PORT`, `MQTT_PUBLIC_TLS` | api | Alamat broker yang ditampilkan untuk firmware |
