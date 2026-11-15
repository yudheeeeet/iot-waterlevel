# Task List: MVP Backend (5 Hari)

> Rencana & alasan: [plan.md](plan.md) · Spesifikasi: [PRD.md](../PRD.md) v1.1
> Perintah standar di folder `backend/`: `npm run test` · `npm run lint` · `npm run build` · `npm run dev` (api) · `npm run worker`
> Ukuran: XS (1 file) · S (1–2) · M (3–5) · L (5–8, harus dipecah)
> Setiap task diakhiri commit kecil + ringkasan untuk diaudit.

---

## Hari 1: Fondasi

### Task 1: Scaffold proyek backend
**Description:** Proyek Node.js (≥ 22; laptop memakai v24) + TypeScript (strict) dengan Fastify 5. `app.ts` membangun instance Fastify tanpa listen (dipakai `server.ts` lokal dan entry Vercel `api/index.ts`); `worker.ts` sebagai entry worker (kerangka). Parsing env via Zod (gagal start bila env salah), logger pino, format error `{ error: { code, message, details } }`, `GET /api/health` (status DB dulu).

**Acceptance criteria:**
- [ ] `npm run dev` menjalankan api di `http://localhost:8080`; `npm run worker` start dan berhenti rapi (Ctrl+C)
- [ ] Env wajib yang hilang → proses berhenti dengan pesan yang menyebut nama variabelnya
- [ ] `GET /api/health` → `{ status, db }`; route tidak dikenal → 404 dengan format error seragam

**Verification:**
- [ ] `npm run lint` dan `npm run build` bersih
- [ ] Manual: `curl localhost:8080/api/health`

**Dependencies:** None
**Files likely touched:** `backend/package.json`, `backend/tsconfig.json`, `backend/src/app.ts`, `backend/src/server.ts`, `backend/src/worker.ts`, `backend/src/config/env.ts`, `backend/src/shared/errors.ts`
**Estimated scope:** M (±2 jam; banyak file kecil)

---

### Task 2: Setup lokal (PostgreSQL 18 + Mosquitto for Windows) + checklist akun layanan demo
**Description:** Tanpa Docker.
- **Database:** buat database `baruna_dev` dan `baruna_test` beserta user khusus di PostgreSQL 18 yang sudah berjalan (`postgresql-x64-18`), lewat script SQL `deploy/local/create-db.sql` (dijalankan dengan psql atau pgAdmin).
- **Broker:** Mosquitto for Windows (installer resmi mosquitto.org), dijalankan dengan `deploy/mosquitto/mosquitto.local.conf`: listener 1883 di localhost, `allow_anonymous false`, Dynamic Security, persistence aktif. Script `deploy/local/init-dynsec.ps1` membuat akun `baruna-backend` (subscribe `baruna/devices/#`, akses `$CONTROL/dynamic-security/#`).
- **Env:** `.env.example` lengkap untuk mode lokal (`BROKER_PROVIDER=mosquitto`, `DATABASE_URL=postgres://…@localhost:5432/baruna_dev`) dan demo (`BROKER_PROVIDER=manual`, HiveMQ + Supabase).
- **Checklist** langkah membuat akun Supabase, HiveMQ Cloud, dan Vercel untuk Anda.

**Acceptance criteria:**
- [ ] `npm run db:check` berhasil terhubung ke `baruna_dev` lokal
- [ ] Mosquitto lokal: koneksi anonim ditolak; `baruna-backend` bisa connect dan subscribe; plugin Dynamic Security termuat (bila tidak tersedia di build Windows → pakai fallback di plan.md dan laporkan)
- [ ] `backend/README.md` berisi langkah setup lokal Windows (PostgreSQL, Mosquitto, env) + checklist akun layanan

**Verification:**
- [ ] Manual: `mosquitto_sub` tanpa kredensial → ditolak; dengan `baruna-backend` → berhasil
- [ ] Manual: `psql -U baruna -d baruna_dev -c "select version()"`

**Dependencies:** None (paralel dengan T1)
**Files likely touched:** `backend/deploy/local/create-db.sql`, `backend/deploy/mosquitto/mosquitto.local.conf`, `backend/deploy/local/init-dynsec.ps1`, `backend/.env.example`, `backend/README.md`
**Estimated scope:** M (±1,5 jam)

---

### Task 3: Skema database, migrasi, dan seed
**Description:** Tabel MVP sesuai PRD §4 dengan Drizzle (`users`, `refresh_tokens`, `devices`, `device_tokens`, `readings`, `device_status_events`, `device_time_sync`, `weather_cache`, `worker_status`). PostgreSQL standar, tanpa ekstensi khusus, agar sama di lokal dan Supabase. Seed: 1 admin + 1 viewer + 3 device contoh.

**Acceptance criteria:**
- [ ] `npm run db:migrate` membuat semua tabel di PostgreSQL 18 lokal **dan** di Supabase (PG17), hanya memakai fitur PG17, termasuk kolom persiapan (`sensor_count`, `readings.channel`, `deadband_cm`, `location_source`)
- [ ] Primary key `readings` = `(device_id, channel, ts)`
- [ ] Migrasi bisa dijalankan dua kali tanpa error

**Verification:**
- [ ] Manual: `\d readings` di lokal; Table Editor di dashboard Supabase

**Dependencies:** T1, T2
**Files likely touched:** `backend/src/db/schema.ts`, `backend/src/db/client.ts`, `backend/drizzle.config.ts`, `backend/src/db/migrations/*`, `backend/scripts/seed.ts`
**Estimated scope:** M (±2 jam)

---

### Task 4: Login, refresh, logout, guard role
**Description:** Modul `identity`: `POST /api/auth/login` (argon2id, rate limit 5×/15 menit), `POST /api/auth/refresh` (rotasi, cookie httpOnly `SameSite=Lax`, `Secure` di produksi), `POST /api/auth/logout`, `GET /api/auth/me`. Guard `requireAuth` & `requireRole('admin')`. Script `user:create` & `user:reset-password`.

**Acceptance criteria:**
- [ ] Login benar → access token (15 menit) + cookie refresh (7 hari); salah → 401 dengan pesan sama untuk email maupun password salah
- [ ] Endpoint terlindungi tanpa token → 401; viewer pada endpoint admin → 403
- [ ] `npm run user:create -- --email … --name … --role viewer` membuat user yang bisa login

**Verification:**
- [ ] Tests pass: `npm run test -- identity` (via `fastify.inject` ke DB lokal)
- [ ] Manual: login → `/auth/me` → refresh → logout dengan curl

**Dependencies:** T3
**Files likely touched:** `backend/src/modules/identity/routes.ts`, `.../identity/service.ts`, `backend/src/shared/authGuard.ts`, `backend/scripts/user-create.ts`, `backend/scripts/user-reset-password.ts`
**Estimated scope:** M (±2,5 jam)

### ✅ Checkpoint Hari 1 (audit Gilang)
- [ ] Setup lokal dari nol mengikuti README berhasil
- [ ] Login admin & viewer berhasil; tanpa token → 401
- [ ] Mosquitto lokal menolak koneksi anonim
- [ ] Akun Supabase, HiveMQ Cloud, Vercel sudah dibuat; migrasi berhasil ke Supabase

---

## Hari 2: Device & Broker

### Task 5: Adapter broker ⚠️ risiko tertinggi, kerjakan pertama
**Description:** Interface `BrokerProvisioner` (`createDevice`, `setPassword`, `enable`, `disable`, `delete`, `list`) dengan dua implementasi:
- `mosquittoDynsec.ts`: kirim perintah ke `$CONTROL/dynamic-security/v1`, tunggu balasan di `.../response`. Role device hanya boleh publish ke `baruna/devices/{id}/readings` dan `/status`.
- `manual.ts`: tidak memanggil broker; menghasilkan `brokerSetup` berisi langkah membuat credential HiveMQ (username, password = token, permission publish ke topic device).

Pilihan lewat `BROKER_PROVIDER`.

**Acceptance criteria:**
- [x] Mode `mosquitto`: device yang dibuat bisa connect & publish ke topic miliknya; publish ke topic device lain ditolak; setelah `setPassword`/`disable`/`delete` koneksi lama ditolak
- [x] Broker tidak membalas dalam 5 detik → error `BROKER_TIMEOUT`
- [ ] Mode `manual`: langkah setup yang dihasilkan, bila diikuti di console HiveMQ, membuat device bisa publish (diverifikasi manual sekali; catat apakah permission per topic tersedia di paket free)

**Verification:**
- [x] Tests pass: `npm run test -- broker` (mode `mosquitto` ke Mosquitto lokal)
- [x] Manual: `mosquitto_pub -u <id> -P <token> -t baruna/devices/<id>/readings`

**Fallback bila > 3 jam macet di Dynamic Security:** password file + ACL file Mosquitto yang ditulis backend + reload broker. Dicatat sebagai utang F2.

**Dependencies:** T2
**Files likely touched:** `backend/src/modules/devices/broker/provisioner.ts`, `.../broker/mosquittoDynsec.ts`, `.../broker/manual.ts`, `.../broker/mosquittoDynsec.test.ts`, `backend/src/shared/mqttClient.ts`
**Estimated scope:** M (±3 jam)

---

### Task 6: CRUD device + penerbitan token
**Description:** `GET/POST /api/devices`, `PATCH/DELETE /api/devices/:id`. POST: buat device + token `bwn_…` (disimpan hash SHA-256 + 4 karakter terakhir) + panggil provisioner. Response berisi `token` (sekali tampil), `mqtt: { host, port, tls, topic, username }` dari env `MQTT_PUBLIC_*`, dan `brokerSetup` (mode `manual`). PATCH `brokerSynced: true` untuk menandai setup manual selesai. DELETE = soft delete + hapus di broker. Bentuk Device mengikuti README frontend; `online` dihitung saat dibaca (`now - last_seen_at <= offline_after_sec`).

**Acceptance criteria:**
- [x] Admin membuat device → token + info MQTT; token tidak pernah muncul lagi di `GET /devices` maupun di log
- [x] Validasi: `lat`/`lon` di luar rentang → 400; ID duplikat → 409 (format error seragam)
- [x] Viewer → 403 untuk POST/PATCH/DELETE; gagal sinkron broker (mode `mosquitto`) → `broker_sync_status='error'` + error jelas

**Verification:**
- [x] Tests pass: `npm run test -- devices`
- [x] Manual: buat device dengan curl → publish memakai token dari response berhasil

**Dependencies:** T4, T5
**Files likely touched:** `backend/src/modules/devices/routes.ts`, `.../devices/service.ts`, `.../devices/repo.ts`, `.../devices/deviceToken.ts`, `.../devices/schemas.ts`
**Estimated scope:** M (±3 jam)

---

### Task 7: Rotasi token, aktif/nonaktif, rekonsiliasi
**Description:** `POST /api/devices/:id/token/rotate` (token lama langsung tidak berlaku; mode `manual` mengembalikan langkah update password di HiveMQ). `PATCH isEnabled` → enable/disable di broker. Worker saat start (mode `mosquitto`): samakan akun Mosquitto dengan DB (hapus akun liar; device yang akunnya hilang → `needs_token_rotation`).

**Acceptance criteria:**
- [x] Mode `mosquitto`: setelah rotasi token lama ditolak & baru diterima; `isEnabled=false` → ditolak, `true` → diterima lagi
- [x] Akun liar di Mosquitto terhapus saat worker restart; device yang akunnya hilang ditandai `needs_token_rotation`
- [x] Mode `manual`: rotasi menghasilkan token baru + langkah update credential

**Verification:**
- [x] Tests pass: `npm run test -- devices`
- [x] Manual: hapus akun device langsung di Mosquitto → restart worker → cek status device

**Dependencies:** T6
**Files likely touched:** `backend/src/modules/devices/routes.ts`, `.../devices/service.ts`, `.../devices/reconcile.ts`, `backend/src/worker.ts`
**Estimated scope:** S (±2 jam)

### ✅ Checkpoint Hari 2 (audit Gilang)
- [ ] Mosquitto lokal: alur buat device → token → publish berhasil; token salah/rotasi/nonaktif ditolak
- [ ] Mode `manual`: langkah setup HiveMQ jelas dan berhasil diikuti
- [ ] Viewer → 403 pada semua endpoint ubah device
- [ ] `npm run test`, `npm run lint`, `npm run build` bersih

---

## Hari 3: Data Masuk + Hardware

### Task 8: Simulator device MQTT
**Description:** `npm run simulate -- --devices 3 --interval 60 --noise 0.5`, membaca `deviceId:token` dari file/env, connect ke `MQTT_URL` (lokal atau HiveMQ). Mode: `constant`, `noise` (±cm), `rise` (naik 1 cm/menit), `--duplicate` (tiap pesan 2×), `--batch` (kirim tertunda dalam batch), `--skew 180` (jam maju 3 menit).

**Acceptance criteria:**
- [x] Publish `{ ts, level }` QoS 1 ke topic yang benar memakai token device, ke Mosquitto lokal maupun HiveMQ (TLS)
- [x] Setiap mode bisa dipilih lewat argumen
- [x] Interval bisa dipercepat (`--interval 2`) untuk uji cepat

**Verification:**
- [x] Manual: `mosquitto_sub -t 'baruna/devices/#' -v` dengan akun backend menampilkan pesan simulator

**Dependencies:** T6
**Files likely touched:** `backend/scripts/simulate-device.ts`
**Estimated scope:** S (±1 jam)

---

### Task 9: Logika ingestion murni + unit test
**Description:** Fungsi tanpa I/O:
- `parsePayload`: Zod, tunggal & batch, ISO/epoch → UTC, `level` 0–2000.
- `validateTimestamp`: tolak `ts` > now + 2 menit.
- `shouldStore`: S1 pertama, S2 nilai berubah pada 2 desimal, S3 heartbeat 15 menit, kiriman ulang lebih lama tetap disimpan.
- `computeStatus`: threshold jarak.

**Acceptance criteria:**
- [x] Semua cabang `shouldStore` & `computeStatus` tercakup test (100% branch)
- [x] Payload invalid menghasilkan error terstruktur, bukan exception yang tidak tertangkap
- [x] Nilai sangat kecil (air dekat sensor) diterima, tidak ditolak

**Verification:**
- [x] Tests pass: `npm run test -- ingestion --coverage`

**Dependencies:** T1
**Files likely touched:** `backend/src/modules/ingestion/payload.ts`, `.../ingestion/storagePolicy.ts`, `.../ingestion/status.ts`, `.../ingestion/*.test.ts`
**Estimated scope:** S (±1,5 jam)

---

### Task 10: Worker: consumer MQTT, penyimpanan, heartbeat
**Description:** Worker subscribe `$share/backend/baruna/devices/+/readings` (QoS 1, `clean=false`, client id tetap) ke `MQTT_URL` (lokal/HiveMQ TLS). Ambil deviceId dari topic dan abaikan device yang tidak terdaftar/nonaktif. Jalankan logika T9; `INSERT … ON CONFLICT DO NOTHING` bila `shouldStore`; selalu update `last_seen_at`, `last_reading_*`, `last_status` (bila `ts` lebih baru). Reconnect dengan backoff. Heartbeat ke `worker_status` tiap 30 detik; `/api/health` menampilkan `worker: up/down` dari heartbeat. Counter diterima/disimpan/ditolak di log tiap 5 menit.

**Acceptance criteria:**
- [x] Simulator `--duplicate` → jumlah baris sama dengan tanpa duplikat; `constant` → ≤ 5 baris/jam; `noise` → setiap perubahan tersimpan
- [x] Pesan dari deviceId tidak terdaftar atau device nonaktif → diabaikan + log `warn`
- [x] Broker di-restart / jaringan putus → worker reconnect sendiri; `/api/health` menunjukkan `worker: "down"` saat worker dimatikan > 90 detik

**Verification:**
- [x] Tests pass: `npm run test -- ingestion`
- [x] Manual: simulator 3 device → `SELECT device_id, count(*) FROM readings GROUP BY 1`

**Dependencies:** T8, T9
**Files likely touched:** `backend/src/modules/ingestion/mqttConsumer.ts`, `.../ingestion/service.ts`, `.../ingestion/repo.ts`, `backend/src/worker.ts`, `backend/src/modules/health/routes.ts`
**Estimated scope:** M (±2,5 jam)

---

### Task 11: Online/offline
**Description:** Fungsi murni `offlineRule` (`max(300, interval × 3)`, override per device) dipakai di query API (status saat dibaca) dan di job worker tiap 30 detik yang mencatat transisi ke `device_status_events` (`timeout` / `reading`).

**Acceptance criteria:**
- [x] Simulator dihentikan → `GET /api/devices` menampilkan offline tepat setelah 5 menit, **walau worker juga dimatikan**
- [x] Event `timeout` tercatat ≤ 5,5 menit (worker menyala); pesan pertama setelahnya → online + event `reading`
- [x] Device yang belum pernah kirim data = offline

**Verification:**
- [x] Tests pass: `npm run test -- presence`
- [x] Manual: uji dengan override per device `offlineAfterSec: 30` (PATCH) agar cepat — env `OFFLINE_MIN_SEC` tidak dibuat

**Dependencies:** T10
**Files likely touched:** `backend/src/modules/presence/offlineRule.ts`, `.../presence/presenceJob.ts`, `.../presence/offlineRule.test.ts`, `backend/src/modules/devices/repo.ts`
**Estimated scope:** S (±1 jam)

---

### Task 12: Firmware ESP32 + HC-SR04 → HiveMQ
**Description:** Sketch Arduino untuk ESP32:
- Wi-Fi + NTP (tunggu jam valid sebelum kirim).
- `WiFiClientSecure` dengan root CA HiveMQ Cloud (TLS 8883) dan `PubSubClient`: username = deviceId, password = token, client id = deviceId, keepalive 60, Last Will `offline`.
- Baca HC-SR04 sebagai median dari 5 pengukuran (cm, 2 desimal), lalu publish `{ ts, level }` QoS 1 tiap 60 detik.
- Reconnect otomatis.

Konfigurasi dipisah di `config.h` (contoh `config.example.h`, yang asli tidak di-commit). README berisi rangkaian (TRIG GPIO5, ECHO GPIO18 lewat pembagi tegangan 5V → 3,3V), library yang dibutuhkan, dan cara flash.

**Acceptance criteria:**
- [ ] ESP32 Anda terhubung ke HiveMQ dan data tersimpan di DB lewat worker (lokal → Supabase)
- [ ] Nilai jarak di DB cocok dengan pengukuran penggaris (±2 cm pada jarak 10–200 cm)
- [ ] Wi-Fi atau broker diputus lalu dinyalakan lagi → ESP32 tersambung kembali tanpa reset manual

**Verification:**
- [ ] Manual (oleh Gilang): flash, ukur jarak ke permukaan rata, bandingkan dengan `GET /api/devices`

**Dependencies:** T6 (token), T10 (worker)
**Files likely touched:** `firmware/esp32-hcsr04/esp32-hcsr04.ino`, `firmware/esp32-hcsr04/config.example.h`, `firmware/esp32-hcsr04/README.md`, `.gitignore`
**Estimated scope:** M (±2 jam termasuk uji bersama)

### ✅ Checkpoint Hari 3 (audit Gilang)
- [ ] Simulator → data tersimpan, duplikat terbuang, last reading terbaru
- [ ] ESP32 asli → HiveMQ → worker → Supabase berhasil
- [ ] Offline/online sesuai aturan; worker pulih sendiri setelah koneksi putus
- [ ] Semua test lulus, lint & build bersih

---

## Hari 4: Data Keluar

### Task 13: Histori readings
**Description:** `GET /api/devices/:id/readings?from&to` (default 24 jam, maks 90 hari) → `{ deviceId, intervalSec, points: [{ timestamp, distanceCm }] }`. Fungsi murni `downsample` (> 600 titik → rata-rata per bucket, `date_bin` di SQL) dan `carryForward` (isi bucket kosong dengan nilai terakhir selama online; `null` saat offline berdasarkan `device_status_events`).

**Acceptance criteria:**
- [x] Rentang 24 jam data per menit → ≤ 600 titik dengan `intervalSec` benar
- [x] Periode nilai konstan tampil sebagai garis datar, bukan celah; periode offline tampil `null`
- [x] Rentang > 90 hari atau `from > to` → 400

**Verification:**
- [x] Tests pass: `npm run test -- readings`
- [x] Manual: bandingkan bentuk response dengan `mockBackend.js` → `getReadings`

**Dependencies:** T10, T11
**Files likely touched:** `backend/src/modules/readings/routes.ts`, `.../readings/service.ts`, `.../readings/downsample.ts`, `.../readings/carryForward.ts`, `.../readings/*.test.ts`
**Estimated scope:** M (±3 jam)

---

### Task 14: Summary + bentuk daftar device
**Description:** `GET /api/summary` → `{ averageDistanceM, devices: { total, online, offline }, latestReading, rainfallTodayMm, lastUpdate }` sesuai README. Pastikan `GET /api/devices` mengisi `online`, `status`, `lastReading: { distanceCm, timestamp }`.

**Acceptance criteria:**
- [x] Bentuk response summary & devices identik dengan `mockBackend.js`
- [x] `averageDistanceM` hanya dari device online yang punya last reading
- [x] `rainfallTodayMm` dari cache cuaca bila ada, selain itu `null`

**Verification:**
- [x] Tests pass: `npm run test -- summary`
- [ ] Manual: frontend lokal dengan `VITE_USE_MOCK=false` menampilkan kartu summary

**Dependencies:** T11
**Files likely touched:** `backend/src/modules/readings/summary.ts`, `.../readings/routes.ts`, `backend/src/modules/devices/service.ts`
**Estimated scope:** S (±1,5 jam)

---

### Task 15: Export CSV/XLSX
**Description:** `GET /api/devices/:id/readings/export?format=csv|xlsx&from&to`, streaming, maks 90 hari, semua role. Kolom: waktu (WIB), jarak (cm), status. `Content-Disposition` dengan nama file yang jelas. Harus selesai dalam batas durasi Vercel Function.

**Acceptance criteria:**
- [x] Admin & viewer bisa mengunduh CSV dan XLSX yang terbuka benar di Excel
- [ ] Export 30 hari untuk 1 device < 10 detik (diukur di Vercel)
- [x] Format tidak dikenal → 400

**Verification:**
- [ ] Manual: unduh dari tombol export di frontend dan buka di Excel

**Dependencies:** T13
**Files likely touched:** `backend/src/modules/readings/export.ts`, `.../readings/routes.ts`
**Estimated scope:** S (±1,5 jam)

---

### Task 16: Cuaca Bogor
**Description:** Porting `src/services/weather/{bmkg,openMeteo,weatherService}.js` ke backend: BMKG hari 1–3, Open-Meteo hari 4–7 + "feels like" + fallback penuh. Cache 30 menit di `weather_cache` (di DB, karena Vercel Function tidak menyimpan memori antar-request). Keduanya gagal → cache lama + `stale: true`; tanpa cache → 503. Lokasi dari env `WEATHER_*`.

**Acceptance criteria:**
- [x] `GET /api/weather` mengembalikan `{ location, today, forecast[7], sources, fetchedAt }` sama dengan output frontend mode `direct`
- [x] Dua request dalam 30 menit → hanya 1 panggilan ke BMKG/Open-Meteo
- [x] BMKG gagal (URL salah) → forecast 7 hari dari Open-Meteo

**Verification:**
- [x] Tests pass: `npm run test -- weather` (merge dengan fixture JSON)
- [ ] Manual: frontend dengan `VITE_WEATHER_SOURCE=backend`

**Dependencies:** T3
**Files likely touched:** `backend/src/modules/weather/bmkg.ts`, `.../weather/openMeteo.ts`, `.../weather/merge.ts`, `.../weather/service.ts`, `.../weather/routes.ts`
**Estimated scope:** M (±2 jam)

### ✅ Checkpoint Hari 4 (audit Gilang)
- [ ] Semua endpoint MVP (PRD §5) sesuai bentuk data `mockBackend.js`
- [ ] Unit test lulus, lint & build bersih
- [ ] DNS domain siap diarahkan ke Vercel

---

## Hari 5: Integrasi, Deploy, Demo

### Task 17: Frontend: login + Authorization + refresh otomatis
**Description:** Halaman login; access token di memori; semua request membawa `Authorization: Bearer`; 401 → `/api/auth/refresh` sekali lalu ulangi; gagal → kembali ke login. Tombol logout di header. `ApiError` membaca pesan dari `payload.error.message`.

**Acceptance criteria:**
- [ ] Tanpa login hanya halaman login yang tampil; login benar → dashboard
- [ ] Access token kedaluwarsa → diperbarui otomatis tanpa logout; reload halaman tetap login (lewat cookie refresh)
- [ ] Logout → kembali ke login dan refresh token dicabut

**Verification:**
- [ ] Build succeeds: `npm run build` (root frontend)
- [ ] Manual: login admin & viewer di browser

**Dependencies:** T4
**Files likely touched:** `src/services/apiClient.js`, `src/services/authService.js` (baru), `src/components/Login.jsx` (baru), `src/App.jsx`, `src/components/Header.jsx`
**Estimated scope:** M (±2,5 jam)

---

### Task 18: Frontend: penyesuaian MVP
**Description:**
- (a) Polling `GET /api/devices` tiap `VITE_POLL_INTERVAL_MS` selain summary.
- (b) `VITE_REALTIME=off` mematikan WebSocket.
- (c) Label "Current Reading" → "Last Reading".
- (d) Setelah tambah device / rotasi token: tampilkan token + info MQTT (+ langkah setup HiveMQ) sekali dengan tombol salin, dan tombol "Tandai sudah di-setup di broker".
- (e) Tombol ubah data hanya untuk admin.

**Acceptance criteria:**
- [ ] Last reading di dashboard berubah ≤ 60 detik setelah ESP32/simulator mengirim data, tanpa refresh halaman
- [ ] Tidak ada percobaan koneksi WebSocket saat `VITE_REALTIME=off`
- [ ] Viewer tidak melihat tombol ubah data; admin melihat token sekali setelah membuat device

**Verification:**
- [ ] Build succeeds: `npm run build`
- [ ] Manual: amati dashboard sebagai admin dan viewer sambil ESP32 mengirim data

**Dependencies:** T14, T17
**Files likely touched:** `src/hooks/useMonitoring.js`, `src/services/realtimeService.js`, `src/components/CurrentReading.jsx`, `src/components/map/DevicePanel.jsx`, `src/services/monitoringService.js`
**Estimated scope:** M (±3 jam)

---

### Task 19: Deploy demo
**Description:**
- **Project Vercel api:** root `backend/`, entry `api/index.ts`, env dari Supabase (pooler transaction) & JWT secret, Vercel Cron harian ke `/api/cron/keepalive` dengan `CRON_SECRET`.
- **Project Vercel frontend:** root repo, `vercel.json` rewrite `/api/*` → project api, env `VITE_USE_MOCK=false`, `VITE_WEATHER_SOURCE=backend`, `VITE_REALTIME=off`.
- **Domain:** `.id` diarahkan ke project frontend.
- **Worker** di laptop terhubung ke HiveMQ + Supabase.
- **Akun demo:** admin & viewer; ESP32 terdaftar.

**Acceptance criteria:**
- [ ] Dashboard terbuka lewat domain (atau `*.vercel.app` bila DNS belum siap), wajib login, menampilkan data ESP32
- [ ] `/api/health` di Vercel menampilkan `db: up` dan `worker: up` saat worker menyala
- [ ] Cron keep-alive terdaftar dan berhasil sekali dijalankan manual dari dashboard Vercel

**Verification:**
- [ ] Manual: jalankan checklist DoD MVP (PRD §14) di URL publik

**Dependencies:** T7, T15, T16, T18, T12
**Files likely touched:** `backend/api/index.ts`, `backend/vercel.json`, `vercel.json` (root frontend), `backend/README.md`
**Estimated scope:** M (±2,5 jam)

---

### Task 20: Panduan integrasi device client + runbook demo
**Description:** `docs/PANDUAN_INTEGRASI_DEVICE.md` untuk device milik client, berisi:
- kontrak MQTT (topic, payload, QoS, interval, NTP),
- cara mendaftarkan device & mendapatkan token,
- konfigurasi untuk HiveMQ **dan** Mosquitto (host, port, TLS, root CA),
- checklist uji,
- troubleshooting (ditolak broker, data tidak muncul, jam salah, offline).

`docs/RUNBOOK_DEMO.md` berisi persiapan H-1, urutan demo, akun, dan langkah pemulihan (worker mati, Wi-Fi ESP32 putus, Supabase ter-pause).

**Acceptance criteria:**
- [ ] Orang yang belum pernah melihat proyek bisa menghubungkan device baru hanya dengan panduan + token (Anda uji sendiri memakai panduan)
- [ ] Bagian Mosquitto & HiveMQ menjelaskan perbedaannya hanya di host, port, kredensial, dan sertifikat
- [ ] Runbook demo bisa diikuti dari laptop mati sampai dashboard menampilkan data

**Verification:**
- [ ] Manual (oleh Gilang): daftarkan device baru (simulator atau ESP32 kedua) hanya dengan mengikuti panduan

**Dependencies:** T12, T19
**Files likely touched:** `docs/PANDUAN_INTEGRASI_DEVICE.md`, `docs/RUNBOOK_DEMO.md`
**Estimated scope:** S (±1,5 jam; bisa dilengkapi setelah demo bila waktu habis)

### ✅ Checkpoint Akhir (audit Gilang = PRD §14 DoD MVP)
- [ ] 1. Login admin & viewer; tanpa token → 401; viewer ubah device → 403
- [ ] 2. Dashboard memakai backend asli (device, summary, histori, last reading, cuaca)
- [ ] 3. Token device: Mosquitto lokal otomatis (benar diterima, salah/rotasi/nonaktif ditolak); HiveMQ lewat langkah manual
- [ ] 4. Last reading terbaru < 2 detik di API; duplikat QoS 1 tidak menambah baris
- [ ] 5. Konstan 1 jam ≤ 5 baris; noise → setiap perubahan tersimpan
- [ ] 6. Offline setelah 5 menit; online kembali pada pesan pertama
- [ ] 7. Broker/worker restart → pulih sendiri; akun Mosquitto sama dengan DB
- [ ] 8. Export 30 hari < 10 detik, admin & viewer
- [ ] 9. Kolom persiapan ada di migrasi
- [ ] 10. ESP32 + HC-SR04 tampil di dashboard Vercel
- [ ] 11. Contoh firmware + panduan integrasi device client tersedia
