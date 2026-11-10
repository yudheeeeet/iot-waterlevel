# PRD / Spec: Backend — Baruna Inotek Water Level Monitoring

> **Status:** v1.0, **cakupan MVP disetujui** (Phase 1 – Specify selesai untuk MVP)
> **Tanggal:** 2026-11-10 · **Penulis:** Gilang Bilhaq (disusun dengan skill `spec-driven-development`)
> **Lingkup:** Backend saja. Frontend (React + Vite) sudah ada di repo ini dan menjadi konsumen utama API.

### Riwayat perubahan
| Versi | Perubahan |
|---|---|
| v0.1 | Draft awal dari 7 request client |
| v0.2 | Q1–Q5: auth token per device, tipe device 1/3/5 disiapkan, Node.js, MQTT QoS 1, NTP, rekomendasi offline 5 menit |
| v0.3 | Q3b kalibrasi kedalaman, Q5 offline 5 menit, Q6 retensi 2 tahun, Q7 cuaca Bogor, Q8 Mosquitto + Dynamic Security, Q11 simpan semua perubahan |
| v0.3.1 | Q10 viewer boleh export, Q12 threshold berbasis jarak, Q8 pembagian dua lapis disetujui |
| **v1.0** | **Cakupan MVP disetujui:** dashboard terintegrasi device IoT; login wajib dengan 2 role (`admin`, `viewer`); WebSocket, kalibrasi, retensi, user management UI, dan pembatasan per lokasi dipindah ke Fase 2. Setiap requirement diberi label fase |
| v1.0.1 | Q13 ditutup: akses mengikuti MVP (semua login, semua user melihat semua alat). Pembatasan per lokasi & akses publik menjadi "Nanti", hanya bila diminta client |
| v1.0.2 | Target MVP 5 hari (rencana di `tasks/`), port backend 8080, strategi test MVP diringankan |
| **v1.1** | **Arsitektur deploy demo vs produksi (§0.1):** demo memakai Vercel (frontend + API) + Supabase + HiveMQ Cloud + ingest worker terpisah; produksi memakai Mosquitto di cloud client. Backend dipecah menjadi `api` dan `worker`. Broker lewat adapter (`mosquitto` otomatis / `manual` untuk HiveMQ). TimescaleDB diganti PostgreSQL biasa (tidak tersedia di Supabase PG17). Online/offline dihitung saat dibaca. Tambah contoh firmware ESP32 + HC-SR04 dan panduan integrasi device client |

**Label fase yang dipakai di seluruh dokumen:**
- **MVP**: dibangun sekarang.
- **F2**: Fase 2, setelah MVP. Desainnya sudah ditetapkan di dokumen ini, dan MVP tidak boleh menutup jalannya.
- **Nanti**: ide pengembangan, belum dirancang detail.

---

## 0. Keputusan & Asumsi

**Sudah diputuskan:**
```
1. Tujuan saat ini: MVP = dashboard yang terintegrasi dengan beberapa device IoT (lihat §1.4).
2. Backend: Node.js (TypeScript).
3. Login wajib untuk semua pengguna. MVP memakai 2 role: admin dan viewer. Akun dibuat lewat script.
4. Sistem menerbitkan AUTH TOKEN per device, di-hardcode manual ke firmware.
   Tipe device (1 / 3 / 5 sensor) ditambahkan nanti.
5. Protokol device: MQTT QoS 1. Produksi: Mosquitto (standar, permintaan client) di cloud client, akun
   device dikelola otomatis lewat Dynamic Security plugin. Demo: HiveMQ Cloud, akun device dibuat manual.
   Kontrak MQTT (topic, payload, QoS, username/password, ACL) sama untuk keduanya (§0.1).
6. Konfigurasi broker dua lapis: secret koneksi backend → broker di `.env`; akun device dari web.
7. Sensor ultrasonik mengukur JARAK sensor → permukaan air (cm). Kedalaman air diukur saat pemasangan
   dan dipakai di F2 (kalibrasi).
8. Penyimpanan: setiap perubahan nilai disimpan; hanya data duplikat yang dibuang.
9. Jam device memakai NTP → timestamp device dipercaya.
10. Offline setelah 5 menit tanpa pesan.
11. Cuaca: satu lokasi (Bogor) seperti frontend saat ini, dari BMKG + Open-Meteo.
12. Threshold status (normal/warning/critical) berbasis JARAK (100 / 200 cm); kedalaman hanya info tambahan.
13. Semua role boleh export data.
14. Retensi (F2): data mentah 2 tahun, agregat per jam & per hari permanen.
15. Akses mengikuti MVP: semua pengguna wajib login dan semua user melihat semua alat.
    Tidak ada pembatasan per lokasi dan tidak ada akses publik; keduanya hanya dibuat bila diminta client.
```

**Asumsi:**
```
A1. Database PostgreSQL biasa (Supabase PG17 tidak menyediakan TimescaleDB). Index (device_id, channel, ts)
    sejak MVP; partisi (pg_partman) & agregat untuk retensi di F2.
A2. Kode backend di folder `backend/` di repo ini.
```

### 0.1 Arsitektur Deploy: Demo vs Produksi

Backend terdiri dari **dua program** dari satu codebase:
- **`api`**: REST untuk dashboard (login, device, histori, summary, export, cuaca). Stateless, jadi bisa berjalan di Vercel Functions maupun server biasa.
- **`worker`**: tersambung terus ke broker MQTT, menyimpan data masuk, dan menulis event online/offline. Harus berjalan terus (tidak bisa di Vercel).

```
DEMO
ESP32 + HC-SR04 ──MQTT TLS 8883──► HiveMQ Cloud (free) ──► worker (laptop saat demo) ──► Supabase (Postgres)
                                                                                              │
                                     Browser ──► Vercel: frontend + api (Vercel Functions) ◄───┘

PRODUKSI (cloud client)
Device ──MQTT──► Mosquitto (Dynamic Security) ──► worker ──► PostgreSQL
                                                                │
                              Browser ──► frontend + api ◄──────┘     (satu server, Docker Compose)
```

| Komponen | Demo | Produksi |
|---|---|---|
| Frontend | Vercel (`app.<domain>`) | Server client / Vercel |
| API | Vercel Functions, diakses lewat rewrite `/api/*` dari domain frontend (same-origin, cookie refresh aman) | Container `api` |
| Worker | Laptop developer saat demo (`npm run worker`); bisa dipindah ke VM tanpa ubah kode | Container `worker` |
| Database | Supabase (PostgreSQL) | PostgreSQL di server client (atau Supabase) |
| Broker | HiveMQ Cloud free, TLS 8883 wajib | Mosquitto 2.x, TLS 8883 disarankan |
| Akun device di broker | **Manual** di console HiveMQ (`BROKER_PROVIDER=manual`) | **Otomatis** via Dynamic Security (`BROKER_PROVIDER=mosquitto`) |
| Keep-alive | Vercel Cron harian → `GET /api/cron/keepalive` (query ringan ke DB) agar project Supabase free tidak di-pause karena tidak aktif | Tidak perlu |

**Kesamaan HiveMQ dan Mosquitto (yang dipakai sistem ini):** protokol MQTT 3.1.1/5, topic `baruna/devices/{deviceId}/readings`, payload JSON, QoS 1, sesi persisten, Last Will, username + password per device, pembatasan topic per device (ACL), dan TLS. Device dan worker tidak membedakan keduanya; yang berubah hanya alamat broker dan kredensial.

**Perbedaannya hanya di sisi administrasi broker:**

| | HiveMQ Cloud | Mosquitto |
|---|---|---|
| Cara memasang | Layanan jadi (daftar akun) | Install sendiri di server (`mosquitto.conf`) |
| Membuat akun device | Console web → Access Management | Dynamic Security API (`$CONTROL/dynamic-security/v1`), otomatis dari backend |
| Pembatasan topic | Permission per credential di console | Role + ACL Dynamic Security |
| Shared subscription (`$share/…`) | Didukung | Didukung (Mosquitto 2.x) |

Agar referensi Mosquitto yang diminta client tetap terjamin, **pengembangan dan test otomatis memakai Mosquitto lokal (Mosquitto for Windows) dan PostgreSQL lokal**, tanpa Docker. HiveMQ hanya dipakai untuk demo online. Konfigurasi Mosquitto produksi disediakan di `backend/deploy/mosquitto/`.

---

## 1. Objective

### 1.1 Apa yang dibangun
Backend untuk sistem monitoring tinggi muka air yang:
1. Menerima jarak sensor → air + timestamp dari device lewat MQTT (interval default 1 menit).
2. Menyimpan setiap perubahan nilai (tanpa duplikat), menghitung status, dan menyajikannya ke dashboard lewat REST.
3. Menentukan status **online/offline** device.
4. Menyediakan **login** untuk dashboard dan **auth token** untuk device.
5. Menyediakan data **cuaca** dari sumber terbuka untuk lokasi Bogor.

### 1.2 Pengguna (MVP)
| Persona | Role | Kebutuhan |
|---|---|---|
| Tim Baruna Inotek / operator yang mengelola alat | `admin` | Kelola device, token, lokasi, interval, threshold; lihat & export data |
| Pihak yang memantau (client, instansi) | `viewer` | Lihat dashboard & export data |
| Device sensor (mesin) | token device | Login ke Mosquitto, kirim jarak + timestamp secara periodik |

### 1.3 Pemetaan request client ke requirement

| # | Request client | MVP | F2 |
|---|---|---|---|
| 1 | Cuaca dari open source sesuai koordinat | `/api/weather` Bogor (BMKG + Open-Meteo, cache) | Cuaca per device (Nanti) |
| 2 | Login, sensor A/B/C dibagi role | Login wajib, role `admin`/`viewer`, token per device | User management UI |
| 3 | Status online/offline alat | Offline setelah 5 menit tanpa pesan | Last Will, event realtime |
| 4 | Lokasi device input manual | CRUD koordinat manual | GPS (Nanti) |
| 5 | Koordinat & water level disesuaikan device; sinkronisasi waktu | Device NTP; kolom & tabel disiapkan | Kalibrasi kedalaman; logika sinkronisasi waktu (Nanti) |
| 6 | "Current reading" → "Last reading" | Field `lastReading`, diperbarui lewat polling | Push realtime via WebSocket |
| 7 | Device kirim water level per menit + timestamp | Payload `{ ts, level }`, interval configurable | Multi-sensor 3/5 (Nanti) |

### 1.4 Cakupan MVP

**Tujuan MVP:** dashboard yang sudah ada berjalan dengan data asli dari beberapa device IoT, aman (login + token device), dan bisa didemokan ke client.

| Bagian | Masuk MVP | Ditunda ke F2 / Nanti | Pengganti sementara di MVP |
|---|---|---|---|
| Data dari device | MQTT → broker (HiveMQ demo / Mosquitto produksi) → worker → validasi → buang duplikat → simpan | HTTP ingestion (Nanti) | — |
| Device | CRUD, lokasi manual, token per device, rotasi/nonaktif; sinkron otomatis ke Mosquitto (`BROKER_PROVIDER=mosquitto`) atau instruksi manual (`manual`, HiveMQ) | Kalibrasi kedalaman (F2), tipe 1/3/5 (Nanti) | Hanya jarak yang ditampilkan |
| Online/offline | Aturan 5 menit dihitung saat dibaca (API) + job 30 detik di worker yang mencatat event | Last Will, riwayat uptime | — |
| Data dashboard | Daftar device, summary, histori + downsampling + carry forward, last reading | Agregat per jam (F2) | Downsampling dihitung saat query |
| Export | CSV/XLSX untuk semua role | — | — |
| Cuaca | `/api/weather` Bogor | Per device (Nanti) | — |
| Login | Login/refresh/logout, role `admin`/`viewer`; semua user melihat semua alat | User management UI, audit log (F2); pembatasan per lokasi & akses publik (Nanti, hanya bila diminta) | Akun dibuat dengan `npm run user:create` |
| Realtime | — | WebSocket `/ws/readings` (F2) | **Polling** REST tiap 60 detik |
| Penyimpanan | Tabel PostgreSQL + index `(device_id, channel, ts)` | Partisi, retensi 2 tahun, agregat (F2) | Data MVP masih kecil |
| Broker di web | Mode `mosquitto`: akun device otomatis + rekonsiliasi saat worker start. Mode `manual`: sistem menampilkan langkah membuat credential di console HiveMQ | Edit info firmware dari web, status broker & tombol resync (F2); koneksi penuh lewat web (Nanti) | Info firmware dari `.env` |
| Deploy demo | Vercel (frontend + api), Supabase, HiveMQ Cloud, worker di laptop, keep-alive harian | Deploy produksi di cloud client (F2) | — |
| Device | Contoh firmware ESP32 + HC-SR04 (`firmware/`), panduan integrasi device client (`docs/`) | — | — |

**Ketergantungan frontend untuk MVP** (di luar lingkup backend, tapi wajib agar MVP jalan):
1. Halaman login dan pengiriman header `Authorization: Bearer <accessToken>` di `src/services/apiClient.js`, termasuk refresh token otomatis saat 401.
2. Polling `GET /api/devices` (bukan hanya `/api/summary`) tiap `VITE_POLL_INTERVAL_MS`. Saat ini `useMonitoring.js` hanya mem-polling summary, sedangkan daftar device & last reading diperbarui lewat WebSocket.
3. WebSocket bisa dimatikan lewat env (mis. `VITE_REALTIME=off`) agar tidak terus mencoba reconnect ke `/ws/readings` yang belum ada.
4. Label "Current Reading" diganti "Last Reading".
5. Menu admin minimal: tambah/edit/hapus device yang menampilkan token sekali, dan rotasi token. CRUD device sudah ada di frontend; yang perlu ditambah tampilan token & tombol rotasi.

**Target waktu MVP:** **maksimal 5 hari kerja** (lebih cepat lebih baik) sampai bisa dipakai dan didemokan (1 developer + AI coding agent). Jadwal, asumsi, dan penyesuaian cakupan ada di [tasks/plan.md](tasks/plan.md).

---

## 2. Capability Map

| Module id | Tanggung jawab | Depends on | Fase |
|---|---|---|---|
| `identity` | Login, token sesi, role | — | MVP (UI user management F2) |
| `devices` | Device, token device, adapter broker (Mosquitto otomatis / manual), lokasi, threshold, interval | `identity` | MVP (kalibrasi F2) |
| `ingestion` | (worker) Subscribe MQTT, validasi, dedup, simpan, status | `devices` | MVP |
| `device-presence` | Online/offline | `devices`, `ingestion` | MVP |
| `readings` | Histori, downsampling, summary, export | `ingestion`, `devices` | MVP (retensi & agregat F2) |
| `weather` | Cuaca BMKG + Open-Meteo, cache | — | MVP |
| `realtime` | WebSocket push | `ingestion`, `device-presence`, `identity` | F2 |

**Build order MVP (5 hari, detail di [tasks/plan.md](tasks/plan.md)):**
1. **Hari 1–2, Fondasi:** proyek, DB & migrasi, `identity`, `devices` + token + Dynamic Security.
2. **Hari 3, Data masuk:** `ingestion` + `device-presence`, diuji dengan simulator device.
3. **Hari 4, Data keluar:** `readings`, `weather`.
4. **Hari 5:** integrasi frontend, deploy, dan uji device fisik.

---

## 3. Functional Requirements

### 3.1 `identity`: Login & Role

**Role MVP**

| Role | Untuk siapa | Ringkasan |
|---|---|---|
| `admin` | Tim Baruna / operator | Kelola device, token, pengaturan; lihat & export |
| `viewer` | Pemantau (client, instansi) | Lihat & export saja |

| Aksi | admin | viewer |
|---|:-:|:-:|
| Lihat dashboard, peta, grafik, cuaca, last reading | ✅ | ✅ |
| Export CSV/XLSX | ✅ | ✅ |
| Tambah/edit device (nama, lokasi, interval, threshold) | ✅ | ❌ |
| Aktif/nonaktifkan device, rotasi token | ✅ | ❌ |
| Hapus device | ✅ | ❌ |
| Kelola user | MVP: lewat script server · F2: lewat web | ❌ |

> Role disimpan sebagai kolom di `users`. Menambah role baru di F2 (misal memisahkan `super_admin` dan `operator`) cukup berupa migrasi kecil dan perubahan guard, tanpa mengubah struktur lain.

| ID | Fase | Requirement | Acceptance criteria |
|---|---|---|---|
| ID-1 | MVP | Login email + password | `POST /api/auth/login` mengembalikan access token (JWT, 15 menit) + refresh token (httpOnly cookie, 7 hari). Password salah → 401 tanpa membedakan "email tidak ada" vs "password salah". |
| ID-2 | MVP | Refresh & logout | `POST /api/auth/refresh` merotasi refresh token; `POST /api/auth/logout` me-revoke. Refresh token lama yang dipakai ulang → semua sesi user di-revoke. |
| ID-3 | MVP | Password aman | Hash argon2id; minimal 8 karakter. Rate limit login: 5 percobaan / 15 menit per IP+email. |
| ID-4 | MVP | Semua endpoint data wajib login | Semua `/api/*` kecuali `/auth/login`, `/auth/refresh`, `/health` → 401 tanpa token valid. Endpoint ubah data → 403 untuk `viewer`. |
| ID-5 | MVP | Profil sendiri | `GET /api/auth/me` → `{ id, name, email, role }`. |
| ID-6 | MVP | Buat akun lewat script | `npm run user:create -- --email a@b.c --name "Nama" --role admin` (password diminta interaktif atau dibuat acak lalu dicetak sekali). `npm run user:reset-password -- --email …`. |
| ID-7 | F2 | User management lewat web | CRUD user, ubah role, nonaktifkan, reset password (khusus admin). |
| ID-8 | F2 | Audit log | Login, perubahan user/device, penerbitan/rotasi token tercatat di `audit_logs`. |
| ID-9 | Nanti (hanya bila diminta client) | Pembatasan per lokasi | Tabel `user_devices`; semua query data difilter oleh assignment, kecuali admin. User tanpa akses ke device X → 404. |
| ID-10 | Nanti (hanya bila diminta client) | Akses publik read-only | Saklar `PUBLIC_DASHBOARD=true` membuka endpoint baca tanpa login, dengan rate limit dan batas export publik. |

### 3.2 `devices`: Device, Token & Lokasi

| ID | Fase | Requirement | Acceptance criteria |
|---|---|---|---|
| DV-1 | MVP | CRUD device | Kontrak sesuai README frontend: `GET/POST /api/devices`, `PATCH/DELETE /api/devices/:id`. `DELETE` = soft delete (reading historis tetap ada) + akun device di broker dihapus. |
| DV-2 | MVP | Auth token device | Saat device dibuat, sistem menerbitkan token acak (`bwn_` + 32 byte base64url). Token **ditampilkan sekali** untuk di-hardcode ke firmware. DB hanya menyimpan hash SHA-256 + 4 karakter terakhir. |
| DV-3 | MVP | Sinkronisasi ke broker (adapter) | `BROKER_PROVIDER=mosquitto`: backend membuat/mengubah/menghapus akun device di Mosquitto lewat **Dynamic Security plugin** (username = deviceId, password = token, hak publish hanya ke topic miliknya), tanpa edit file atau restart broker; gagal sinkron → `broker_sync_status = 'error'` dan error yang jelas. `BROKER_PROVIDER=manual` (HiveMQ Cloud): akun tidak dibuat otomatis; response create/rotate menyertakan `brokerSetup` berisi langkah membuat credential + permission topic di console, dan device berstatus `broker_sync_status = 'pending'` sampai admin menandainya selesai (`PATCH { brokerSynced: true }`). |
| DV-4 | MVP | Rotasi / nonaktifkan token | `POST /api/devices/:id/token/rotate` → token baru; token lama **langsung** tidak berlaku (firmware harus di-flash ulang). `isEnabled=false` → akun device di broker dinonaktifkan dan koneksinya diputus. |
| DV-5 | MVP (mode `mosquitto`) | Rekonsiliasi saat start | Saat worker start, akun device di Mosquitto disamakan dengan DB (DB = sumber kebenaran). Device di broker yang tidak ada di DB dihapus. Device di DB yang hilang dari broker ditandai `needs_token_rotation` (token asli tidak disimpan). |
| DV-6 | F2 | Resync manual & status broker | `POST /api/admin/broker/resync`, `GET /api/admin/broker` (admin). |
| DV-7 | MVP | Lokasi manual | `lat` (-90..90), `lon` (-180..180) wajib saat create. `location_source = 'manual'`; nilai `'gps'` disiapkan untuk nanti. |
| DV-8 | MVP | Interval kirim | `reporting_interval_sec` default 60, rentang 10–3600. Harus sama dengan interval di firmware. |
| DV-9 | MVP | Threshold per device | `threshold_warning_cm` (default 200) & `threshold_critical_cm` (default 100), berbasis jarak. |
| DV-10 | MVP | Info koneksi untuk firmware | Response create/rotate menyertakan `mqtt: { host, port, tls, topic, username }`. MVP: dari env `MQTT_PUBLIC_HOST`, `MQTT_PUBLIC_PORT`, `MQTT_PUBLIC_TLS`. |
| DV-11 | F2 | Info firmware bisa diedit dari web | `GET/PUT /api/admin/settings/mqtt-public` (tabel `app_settings`); nilai awal dari env. |
| DV-12 | F2 | Kalibrasi kedalaman | Teknisi memasukkan kedalaman air terukur (`measuredDepthCm`) + jarak sensor saat itu (`sensorDistanceCm`) → `sensorHeightCm = sensorDistanceCm + measuredDepthCm`. `POST /api/devices/:id/calibrations`. Disimpan sebagai riwayat dengan `effectiveFrom`, tidak menimpa yang lama. |
| DV-13 | MVP (skema saja) | Tipe device & sinkronisasi waktu | Kolom `sensor_count` (default 1), `readings.channel` (default 1), dan tabel `device_time_sync` dibuat tanpa logika. |

### 3.3 `ingestion`: Penerimaan Data Sensor (MVP)

**Kontrak MQTT**
- Broker: Mosquitto 2.x dengan Dynamic Security plugin (produksi, development, test) atau HiveMQ Cloud (demo). Kontrak di bawah berlaku sama untuk keduanya.
- Device connect dengan **username = deviceId**, **password = auth token**.
- Topic: `baruna/devices/{deviceId}/readings`
- QoS: 1 (at-least-once: pesan yang sama bisa datang lebih dari sekali)
- Rekomendasi firmware: `keepalive = 60` detik, `clean_session = false`, Last Will ke `baruna/devices/{deviceId}/status` dengan payload `offline` (dipakai di F2).
- Backend subscribe `baruna/devices/+/readings` dengan akun `baruna-backend`. **deviceId diambil dari topic**; ACL broker menjamin device tidak bisa memakai topic device lain.
- Payload:
```json
{ "ts": "2026-11-10T07:30:00Z", "level": 285.4 }
```
  - `ts`: ISO-8601 atau epoch detik dari jam device (NTP), dinormalisasi ke UTC
  - `level`: jarak sensor → permukaan air dalam cm, disimpan 2 desimal
- Batch opsional (device yang sempat putus lalu kirim ulang):
```json
{ "readings": [ { "ts": "...", "level": 285.4 }, { "ts": "...", "level": 284.9 } ] }
```

**Kebijakan penyimpanan**

Setiap pesan valid **selalu** memperbarui status device (`last_seen_at`, `last_reading_*`, online). Pesan disimpan ke tabel `readings` jika:

| # | Syarat simpan | Keterangan |
|---|---|---|
| S1 | Reading pertama dari device | Titik awal grafik |
| S2 | `level` **berbeda** dari nilai terakhir yang disimpan (berapa pun selisihnya, pada presisi 2 desimal) | Semua perubahan tercatat |
| S3 | Nilai sama, tapi sudah lewat `heartbeat_sec` (default 900 = 15 menit) sejak simpan terakhir | Grafik tetap punya titik saat air diam |

Yang **dibuang**:
- **Duplikat kiriman ulang QoS 1**: `(device_id, channel, ts)` sama → `INSERT … ON CONFLICT DO NOTHING`.
- **Duplikat nilai**: nilai sama dengan simpan terakhir dan belum lewat heartbeat.

Reading dengan `ts` lebih tua dari simpan terakhir (kiriman ulang setelah putus koneksi) **tetap disimpan** selama bukan duplikat `ts`.

Kolom `deadband_cm` disiapkan dengan default **0** (= simpan semua perubahan). Bila noise sensor ultrasonik membuat database tumbuh terlalu cepat, nilainya bisa dinaikkan per device tanpa perubahan kode.

| ID | Fase | Requirement | Acceptance criteria |
|---|---|---|---|
| IN-1 | MVP | Autentikasi device | Ditangani broker (DV-3). Token salah / device nonaktif / dihapus → koneksi ditolak. Publish ke topic device lain → ditolak ACL. |
| IN-2 | MVP | Validasi payload | Payload tidak valid (bukan JSON, `level` < 0 atau > 2000 cm, `ts` tidak terbaca) → dibuang + log `warn` + counter; consumer tidak mati. Nilai sangat kecil (air mendekati sensor) **tidak** dibuang karena bisa menandakan banjir. |
| IN-3 | MVP | Deduplikasi | Pesan sama dikirim 2× → 1 baris. Nilai sama berturut-turut → 1 baris per 15 menit. |
| IN-4 | MVP | Validasi timestamp | `ts` > waktu server + 2 menit → ditolak dan dicatat (indikasi NTP gagal). Selisih `received_at - ts` dicatat di log. |
| IN-5 | MVP | Hitung status | `critical` jika `level < threshold_critical_cm`, `warning` jika `< threshold_warning_cm`, selain itu `normal`. |
| IN-6 | MVP | Update device | `last_seen_at`, `last_reading_cm`, `last_reading_at`, `last_status` diperbarui pada setiap pesan valid yang `ts`-nya lebih baru. |
| IN-7 | MVP | Koneksi broker tangguh | Koneksi worker ke broker putus → reconnect dengan exponential backoff; worker menulis heartbeat ke DB (`worker_heartbeat_at`) dan `/api/health` menampilkan `worker: "up"/"down"` berdasarkan heartbeat itu. Sesi persisten (`clean=false`, QoS 1) agar pesan selama backend restart singkat tidak hilang. |
| IN-8 | MVP | Metrik | Counter `readings_received_total`, `readings_stored_total`, `readings_rejected_total` (log berkala / endpoint `/health`). |
| IN-9 | F2 | Fan-out realtime | Setiap pesan valid → event `reading` ke modul `realtime`. |
| IN-10 | Nanti | HTTP ingestion fallback | `POST /api/ingest` dengan `Authorization: Bearer <device token>`. |

### 3.4 `device-presence`: Status Online/Offline

```
offline_after_sec = max(OFFLINE_MIN_SEC, reporting_interval_sec × OFFLINE_MISSED_FACTOR)
default: OFFLINE_MIN_SEC = 300, OFFLINE_MISSED_FACTOR = 3
→ interval 60 s  → offline setelah 300 s (5 menit)
→ interval 300 s → offline setelah 900 s (15 menit)
```

| ID | Fase | Requirement | Acceptance criteria |
|---|---|---|---|
| PR-1 | MVP | Aturan offline (dihitung saat dibaca) | API menghitung `online = now - last_seen_at <= offline_after_sec` langsung di query, sehingga status selalu benar walau worker atau job tidak berjalan (penting di Vercel). Belum pernah kirim data = offline. Bisa di-override per device. |
| PR-2 | MVP | Pencatatan event | Job di worker setiap 30 detik mencatat perubahan status ke `device_status_events` (dipakai untuk celah offline di grafik). Bila worker mati, status di dashboard tetap benar dari PR-1. |
| PR-3 | MVP | Online kembali | Pesan valid pertama setelah offline langsung mengubah status ke online. |
| PR-4 | MVP | Dedup tidak mempengaruhi presence | Pesan yang tidak disimpan tetap memperbarui `last_seen_at`. |
| PR-5 | F2 | Last Will | Pesan LWT `offline` → status langsung offline. Kembali online hanya lewat pesan data. |
| PR-6 | F2 | Event realtime | Setiap perubahan → WS `device_status` `{ deviceId, online, lastSeen }`. |
| PR-7 | Nanti | Riwayat uptime | Endpoint riwayat online/offline per device. |

### 3.5 `readings`: Histori, Summary, Export

| ID | Fase | Requirement | Acceptance criteria |
|---|---|---|---|
| RD-1 | MVP | Histori | `GET /api/devices/:id/readings?from&to` → `{ deviceId, intervalSec, points: [{ timestamp, distanceCm }] }`. Rentang default 24 jam, maksimum 90 hari. |
| RD-2 | MVP | Celah karena dedup | Nilai yang tidak berubah tidak disimpan setiap menit, jadi bucket kosong diisi nilai terakhir sebelumnya (*carry forward*) selama device online. Saat device offline, titik `null` agar terlihat sebagai celah. |
| RD-3 | MVP | Downsampling | Jika jumlah titik > 600, agregasi rata-rata per bucket (`date_bin`, PostgreSQL standar) saat query, dan isi `intervalSec`. |
| RD-4 | MVP | Summary | `GET /api/summary` sesuai kontrak README. `rainfallTodayMm` dari modul weather (estimasi) atau `null`. |
| RD-5 | MVP | Last reading | Field `lastReading` di objek Device (`{ distanceCm, timestamp }`), dari kolom `last_reading_*`. |
| RD-6 | MVP | Export | `GET /api/devices/:id/readings/export?format=csv\|xlsx&from&to`, streaming, maksimum 90 hari / request, semua role. Kolom: waktu (WIB), jarak (cm), status. Berisi titik yang tersimpan (bukan carry forward), dengan catatan di header file. |
| RD-7 | F2 | Kedalaman air | Field tambahan `waterDepthCm = sensorHeightCm(kalibrasi yang berlaku pada ts) − distanceCm` di histori, last reading, export, dan WS. Dihitung saat query; `null` bila belum dikalibrasi; nilai negatif dipotong ke 0. |
| RD-8 | F2 | Retensi & agregat | Data mentah 2 tahun (`RAW_RETENTION_DAYS=730`) dengan partisi bulanan (`pg_partman`, partisi lama di-drop), agregat per jam & per hari (min/max/avg/count) permanen. Rentang > 30 hari memakai agregat per jam. |

**Alasan retensi 2 tahun (untuk F2):**
- Pola banjir mengikuti musim (hujan ±Nov–Apr). Dua tahun data mentah memungkinkan perbandingan musim yang sama tahun ini vs tahun lalu dengan resolusi per menit.
- Data lebih tua cukup dalam bentuk agregat per jam/hari, yang disimpan selamanya.
- Estimasi terburuk (±1 baris/menit): ±60 MB per device per tahun. 20 device × 2 tahun ≈ 2,4 GB. Ini melebihi batas Supabase free (500 MB), jadi produksi memakai PostgreSQL di server client atau paket berbayar. Selama demo (beberapa device, beberapa minggu), data masih jauh di bawah 500 MB.

### 3.6 `realtime`: WebSocket (F2)

MVP memakai polling REST tiap 60 detik (lihat ketergantungan frontend §1.4).

| ID | Fase | Requirement | Acceptance criteria |
|---|---|---|---|
| RT-1 | F2 | Autentikasi WS | `/ws/readings` wajib membawa access token user (query `?token=` atau subprotocol). Token tidak valid → close code 4401. |
| RT-2 | F2 | Tipe pesan | `reading`, `device_status`, `summary` (format seperti README frontend). |
| RT-3 | Nanti | Multi-instance | Fan-out lewat Redis pub/sub atau Postgres `LISTEN/NOTIFY`. |

### 3.7 `weather`: Cuaca dari Sumber Terbuka (MVP)

Satu lokasi untuk seluruh dashboard (Bogor), **sama persis** dengan logika frontend saat ini (`src/services/weather/weatherService.js`), dipindahkan ke backend agar production tidak bergantung pada proxy `/bmkg` milik Vite dev server.

| ID | Fase | Requirement | Acceptance criteria |
|---|---|---|---|
| WX-1 | MVP | Lokasi | Dari env: `WEATHER_LOCATION_NAME=Bogor`, `WEATHER_LAT=-6.595`, `WEATHER_LON=106.797`, `WEATHER_BMKG_ADM4=32.71.03.1002` (sama dengan default frontend). |
| WX-2 | MVP | Sumber | Hari 1–3: BMKG (`api.bmkg.go.id/publik/prakiraan-cuaca?adm4=…`). Hari 4–7, "feels like", dan fallback penuh: Open-Meteo (berdasarkan koordinat). |
| WX-3 | MVP | Endpoint | `GET /api/weather` → `{ location, today, forecast[7], sources, fetchedAt }` persis seperti dokumentasi di `weatherService.js`. Frontend cukup set `VITE_WEATHER_SOURCE=backend`. |
| WX-4 | MVP | Cache | TTL 30 menit (`weather_cache`), sehingga berapa pun jumlah user hanya ±48 request/hari ke tiap sumber. |
| WX-5 | MVP | Fallback | BMKG gagal → Open-Meteo 7 hari. Keduanya gagal → cache terakhir + `stale: true`. Tidak ada cache → 503. |
| WX-6 | MVP | Atribusi | Response menyertakan `sources`; frontend menampilkan atribusi BMKG (wajib) dan Open-Meteo (CC BY 4.0). |
| WX-7 | Nanti | Per device | `?deviceId=` memakai koordinat device. Cache sudah memakai koordinat sebagai key. |

---

## 4. Data Model (PostgreSQL)

```sql
-- ===== MVP =====

users (
  id uuid PK, email citext UNIQUE NOT NULL, name text NOT NULL,
  password_hash text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin','viewer')),   -- F2 bisa menambah role lewat migrasi kecil
  is_active boolean DEFAULT true, last_login_at timestamptz,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
)
refresh_tokens (id uuid PK, user_id uuid FK, token_hash text UNIQUE, family_id uuid,
  expires_at timestamptz, revoked_at timestamptz, created_at timestamptz)

devices (
  id text PK,                      -- contoh 'BWN-003', juga username MQTT
  name text NOT NULL,
  lat double precision NOT NULL, lon double precision NOT NULL,
  location_source text DEFAULT 'manual' CHECK (location_source IN ('manual','gps')),
  sensor_count smallint DEFAULT 1 CHECK (sensor_count IN (1,3,5)),   -- disiapkan, belum dipakai
  reporting_interval_sec int DEFAULT 60,
  offline_after_sec int,           -- NULL = pakai rumus default
  deadband_cm numeric(5,2) DEFAULT 0,   -- 0 = simpan semua perubahan
  heartbeat_sec int DEFAULT 900,
  threshold_warning_cm int DEFAULT 200, threshold_critical_cm int DEFAULT 100,
  is_enabled boolean DEFAULT true,
  broker_sync_status text DEFAULT 'pending'
    CHECK (broker_sync_status IN ('pending','synced','needs_token_rotation','error')),
  is_online boolean DEFAULT false, last_seen_at timestamptz,
  last_reading_cm numeric(7,2), last_reading_at timestamptz, last_status text,
  last_stored_cm numeric(7,2), last_stored_at timestamptz,   -- acuan dedup & heartbeat
  installed_at timestamptz, deleted_at timestamptz,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
)
device_tokens (
  id uuid PK, device_id text FK,
  token_hash text UNIQUE NOT NULL,  -- sha256(token)
  token_last4 text NOT NULL,
  revoked_at timestamptz, created_by uuid, created_at timestamptz DEFAULT now()
)

-- tabel biasa; primary key = index utama untuk query per device & rentang waktu.
-- F2: partisi bulanan (pg_partman) + agregat untuk retensi 2 tahun.
readings (
  device_id text NOT NULL FK,
  channel smallint NOT NULL DEFAULT 1,   -- nomor sensor, untuk device 3/5 sensor nanti
  ts timestamptz NOT NULL,
  level_cm numeric(7,2) NOT NULL,        -- jarak sensor → air (data mentah, tidak pernah diubah)
  status text NOT NULL,
  received_at timestamptz DEFAULT now(),
  PRIMARY KEY (device_id, channel, ts)   -- sekaligus dedup QoS 1
)

device_status_events (id bigserial PK, device_id text FK, online boolean,
  reason text,                     -- 'timeout' | 'reading' | 'lwt'
  at timestamptz DEFAULT now())

-- skema saja (DV-13). Device sudah NTP; nanti untuk memantau drift jam.
device_time_sync (
  id bigserial PK, device_id text FK,
  device_ts timestamptz, server_ts timestamptz,
  offset_ms int, method text, created_at timestamptz DEFAULT now()
)

weather_cache (cache_key text PK, payload jsonb, fetched_at timestamptz, expires_at timestamptz)

-- status worker (1 baris per instance), dipakai /api/health karena api & worker terpisah
worker_status (worker_id text PK, heartbeat_at timestamptz NOT NULL, mqtt_connected boolean NOT NULL,
  broker_url_host text, started_at timestamptz)

-- ===== F2 =====

audit_logs (id bigserial PK, actor_id uuid, action text, entity text, entity_id text,
  meta jsonb, created_at timestamptz DEFAULT now())

device_calibrations (
  id bigserial PK, device_id text FK,
  effective_from timestamptz NOT NULL,
  measured_depth_cm numeric(7,2) NOT NULL,   -- kedalaman air diukur manual saat pemasangan
  sensor_distance_cm numeric(7,2) NOT NULL,  -- jarak sensor → air saat pengukuran
  sensor_height_cm numeric(7,2) GENERATED ALWAYS AS (measured_depth_cm + sensor_distance_cm) STORED,
  note text, created_by uuid, created_at timestamptz DEFAULT now(),
  UNIQUE (device_id, effective_from)
)

-- pengaturan yang bisa diedit dari web (TIDAK untuk secret)
app_settings (key text PK, value jsonb NOT NULL, updated_by uuid, updated_at timestamptz DEFAULT now())

-- continuous aggregate, permanen
readings_hourly (device_id, channel, bucket, min_cm, max_cm, avg_cm, n)
readings_daily  (device_id, channel, bucket, min_cm, max_cm, avg_cm, n)

-- Nanti: hanya bila client meminta pembatasan per lokasi (ID-9)
user_devices (user_id uuid FK, device_id text FK, PRIMARY KEY (user_id, device_id))
```

Catatan desain:
- **Data mentah tidak pernah diubah.** Kedalaman air (F2) dihitung dari `level_cm` + kalibrasi, sehingga koreksi kalibrasi tidak menyentuh jutaan baris.
- Kolom yang disiapkan sejak MVP (`sensor_count`, `readings.channel`, `location_source`, `deadband_cm`, `device_time_sync`) membuat fitur F2/Nanti tidak memerlukan perubahan tabel yang sudah berisi data.
- `readings` memakai PostgreSQL standar agar bisa jalan di Supabase maupun server client tanpa ekstensi khusus.

---

## 5. API Contract

Semua endpoint di bawah `/api`, JSON, timestamp ISO-8601 UTC, jarak dalam **cm**. Kontrak device/summary/readings/weather/WS **mengikuti README frontend**; field baru hanya ditambahkan, tidak mengubah yang ada.

| Fase | Method | Path | Akses | Catatan |
|---|---|---|---|---|
| MVP | POST | `/auth/login` | publik | rate-limited |
| MVP | POST | `/auth/refresh` | cookie | rotasi token |
| MVP | POST | `/auth/logout` | login | |
| MVP | GET | `/auth/me` | login | |
| MVP | GET | `/devices` | login | |
| MVP | POST | `/devices` | admin | response berisi `token` (sekali tampil) + info `mqtt` (+ `brokerSetup` di mode `manual`) |
| MVP | PATCH | `/devices/:id` | admin | nama, lokasi, interval, threshold, `isEnabled`, `brokerSynced` (mode `manual`) |
| MVP | DELETE | `/devices/:id` | admin | soft delete + hapus akun broker |
| MVP | POST | `/devices/:id/token/rotate` | admin | token baru (sekali tampil) + info `mqtt` |
| MVP | GET | `/summary` | login | |
| MVP | GET | `/devices/:id/readings` | login | downsampled, carry forward |
| MVP | GET | `/devices/:id/readings/export` | login | csv / xlsx |
| MVP | GET | `/weather` | login | Bogor, BMKG + Open-Meteo, cached |
| MVP | GET | `/health` | publik | `{ db, worker }` (status worker dari `worker_status.heartbeat_at`) tanpa detail sensitif |
| MVP | GET | `/cron/keepalive` | Vercel Cron (header `Authorization: Bearer $CRON_SECRET`) | query ringan ke DB, dijadwalkan harian di `vercel.json` |
| F2 | GET/POST, PATCH/DELETE | `/users`, `/users/:id` | admin | user management web |
| F2 | GET/POST | `/devices/:id/calibrations` | GET login, POST admin | |
| F2 | GET | `/admin/broker` | admin | status broker (tanpa secret) |
| F2 | POST | `/admin/broker/resync` | admin | rekonsiliasi akun device |
| F2 | GET/PUT | `/admin/settings/mqtt-public` | admin | info broker untuk firmware |
| F2 | GET | `/admin/audit-logs` | admin | |
| F2 | WS | `/ws/readings` | token user | `reading`, `device_status`, `summary` |

Format error seragam:
```json
{ "error": { "code": "DEVICE_NOT_FOUND", "message": "Device tidak ditemukan", "details": null } }
```

---

## 6. Konfigurasi Broker

**Keputusan: pembagian dua lapis.** Rahasia koneksi backend ke broker ada di `.env` server; yang sering berubah dan tidak rahasia diatur dari web.

| Konfigurasi | Tempat | Fase |
|---|---|---|
| Koneksi worker → broker: `MQTT_URL` (produksi mis. `mqtt://mosquitto:1883` di jaringan internal Docker; demo `mqtts://<cluster>.hivemq.cloud:8883`), `MQTT_USERNAME=baruna-backend`, `MQTT_PASSWORD`, `MQTT_CA_FILE` (opsional) | `.env` server / env Vercel & worker | MVP |
| Jenis broker: `BROKER_PROVIDER=mosquitto` atau `manual` | `.env` | MVP |
| Akun & ACL setiap device | `mosquitto`: web, otomatis (Dynamic Security) · `manual`: console HiveMQ, mengikuti langkah yang ditampilkan sistem | MVP |
| Info broker untuk firmware (`publicHost`, `publicPort`, `tls`, `topicPrefix`) | MVP: `.env` (`MQTT_PUBLIC_*`) · F2: bisa diedit admin dari web (`app_settings`) | MVP / F2 |
| Status koneksi broker, tombol resync | Web | F2 (MVP: `/health`) |
| Koneksi backend → broker penuh lewat web | Web, dengan pengaman di bawah | Nanti |

Alasan koneksi backend → broker tidak dibuat sebagai input di web:
1. **Keamanan.** Password broker akan tersimpan di database dan bisa diubah lewat web. Akun admin yang bocor bisa mengarahkan backend ke broker palsu, sehingga data asli tidak masuk dan data water level palsu bisa disuntikkan (alarm palsu atau kondisi kritis yang tidak terlihat).
2. **Fleksibilitasnya kecil.** Broker berada di server yang sama dengan backend, jadi alamat internalnya tidak berubah walau pindah cloud. Yang berubah adalah alamat yang dipakai device, dan itu ada di firmware.
3. **Masalah ayam-dan-telur.** Konfigurasi yang salah lewat web bisa memutus koneksi, dan memperbaikinya tetap perlu akses server.

Agar mudah pindah cloud: firmware memakai **nama domain** (mis. `mqtt.baruna.id`), bukan IP. Cukup DNS yang diubah.

Konfigurasi Mosquitto minimal (diberikan dalam `backend/deploy/mosquitto/`):
```
listener 8883
certfile / keyfile          # TLS
allow_anonymous false
plugin /usr/lib/mosquitto_dynamic_security.so
plugin_opt_config_file /mosquitto/config/dynamic-security.json
persistence true
```
Akun `baruna-backend` mendapat hak subscribe `baruna/devices/#` dan akses `$CONTROL/dynamic-security/#`.

**Nanti: koneksi broker penuh lewat web.** Hanya boleh dibangun dengan seluruh pengaman berikut:
1. Password broker disimpan terenkripsi (AES-256-GCM, kunci `SETTINGS_ENCRYPTION_KEY` di env) dan *write-only*: tidak pernah dikirim balik ke UI.
2. Hanya admin tertinggi, wajib memasukkan ulang password (re-auth) sebelum menyimpan.
3. Test koneksi ke broker baru dulu; gagal → otomatis kembali ke konfigurasi lama.
4. Setiap perubahan tercatat di audit log + notifikasi ke admin lain.
5. 2FA wajib sebelum fitur ini aktif.

---

## 7. Non-Functional Requirements (MVP)

| Area | Target |
|---|---|
| Kapasitas | 100 device × 1 pesan/menit (≈ 144.000 pesan/hari) tanpa degradasi |
| Latensi ingestion | Pesan diterima broker → tersimpan & terlihat di `GET /devices` < 2 detik (p95) |
| Kesegaran dashboard | Last reading di dashboard tertinggal maksimal 1 interval polling (60 detik) |
| Latensi API | `GET /devices`, `/summary` < 200 ms p95; histori 24 jam < 500 ms p95; histori 90 hari < 1,5 detik |
| Presence | Status offline di dashboard tepat setelah 5 menit (dihitung saat dibaca); event offline tercatat ≤ 5,5 menit |
| Keamanan | OWASP Top 10, HTTPS; MQTT over TLS 8883 (wajib di HiveMQ Cloud, disarankan di Mosquitto produksi), `allow_anonymous false`, API same-origin lewat rewrite Vercel, secret via env, rate limit login |
| Observability | Log JSON terstruktur (pino), `/health` (DB + heartbeat worker), counter pesan diterima/disimpan/ditolak di log worker |
| Batas platform demo | Vercel Hobby (durasi function terbatas, non-komersial), Supabase free (500 MB, pause bila tidak aktif 7 hari → keep-alive harian), HiveMQ Cloud free (100 koneksi) |
| Waktu | Disimpan UTC; konversi ke WIB hanya di export & tampilan |

---

## 8. Tech Stack

| Bagian | Pilihan |
|---|---|
| Runtime | Node.js ≥ 22 LTS (lokal v24), TypeScript 5 (strict) |
| HTTP | Fastify 5; satu instance app dipakai oleh `server.ts` (lokal/produksi) dan entry Vercel Function (`api/index.ts`) (+ `@fastify/websocket` di F2) |
| Validasi | Zod (REST & payload MQTT) |
| DB | PostgreSQL (Supabase untuk demo, PostgreSQL 16+ lokal/produksi), Drizzle ORM, migrasi Drizzle Kit. Koneksi dari Vercel lewat pooler Supabase (transaction mode) |
| MQTT | Client `mqtt` (MQTT.js). Broker: Mosquitto 2.x + Dynamic Security (dev/test/produksi), HiveMQ Cloud (demo) |
| Auth | `jose` (JWT user), `argon2` (password), SHA-256 (token device) |
| Export | `exceljs` (xlsx streaming), CSV native stream |
| Lokal (sebelum deploy) | PostgreSQL 18 terpasang di laptop (hanya fitur PG17 agar kompatibel dengan Supabase) + Mosquitto for Windows; tanpa Docker |
| Test | Vitest; database `baruna_test` di PostgreSQL lokal & Mosquitto lokal (Testcontainers di F2) |
| Deploy demo | Vercel (frontend + api + cron), Supabase, HiveMQ Cloud, worker di laptop |
| Deploy produksi | Docker Compose: `api`, `worker`, `db`, `mosquitto` |
| Firmware contoh | ESP32 (Arduino), `PubSubClient`, `WiFiClientSecure`, `ArduinoJson`, NTP; sensor HC-SR04 |

---

## 9. Commands

```bash
cd backend
npm install
# prasyarat lokal: PostgreSQL 18 (service berjalan) + Mosquitto for Windows, lihat backend/README.md
npm run db:check                          # cek koneksi DATABASE_URL
npm run db:migrate                        # drizzle-kit migrate (lokal atau Supabase, tergantung DATABASE_URL)
npm run db:seed                           # 1 admin + 1 viewer + 3 device contoh, token dicetak ke console
npm run user:create -- --email admin@baruna.id --name "Admin" --role admin
npm run user:reset-password -- --email admin@baruna.id
npm run dev                               # api: tsx watch src/server.ts  → http://localhost:8080
npm run worker                            # worker: tsx src/worker.ts (MQTT consumer + job presence)
npm run test                              # vitest run
npm run test -- --coverage
npm run lint                              # eslint . && tsc --noEmit
npm run build                             # tsc -p tsconfig.build.json → dist/
npm run simulate -- --devices 3 --interval 60 --noise 0.5   # simulator device MQTT untuk dev
```

Frontend dihubungkan dengan `VITE_USE_MOCK=false`, `VITE_WEATHER_SOURCE=backend`, dan `VITE_BACKEND_PROXY_TARGET=http://localhost:8080` (default di `.env.example` frontend).

---

## 10. Project Structure

```
backend/
  src/
    app.ts                  membangun instance Fastify (routes, plugin) tanpa listen
    server.ts               entry api lokal/produksi (listen :8080)
    worker.ts               entry worker (MQTT consumer, job presence, heartbeat, rekonsiliasi broker)
    config/env.ts           parsing env dengan Zod (gagal start jika env salah)
    db/schema.ts            definisi tabel Drizzle
    db/migrations/
    modules/
      identity/             routes.ts, service.ts, repo.ts, schemas.ts, *.test.ts
      devices/              deviceToken.ts, broker/ (provisioner.ts interface, mosquittoDynsec.ts, manual.ts)
      ingestion/            mqttConsumer.ts, payload.ts, storagePolicy.ts, service.ts
      presence/             presenceJob.ts, offlineRule.ts
      readings/             downsample.ts, carryForward.ts, export.ts
      weather/              bmkg.ts, openMeteo.ts, merge.ts, cache.ts
    shared/                 errors.ts, auth guard, logger, time utils
  scripts/                  simulate-device.ts, user-create.ts, user-reset-password.ts, seed.ts
  tests/integration/
  api/index.ts              entry Vercel Function (memakai app.ts)
  vercel.json               rewrite & cron keep-alive
  deploy/mosquitto/         mosquitto.conf, contoh dynamic-security.json (produksi)
  docker-compose.yml
  .env.example
firmware/esp32-hcsr04/      contoh firmware ESP32 + HC-SR04 untuk demo
docs/PANDUAN_INTEGRASI_DEVICE.md   panduan menghubungkan device milik client
PRD.md                      dokumen ini
```

Modul F2 ditambahkan di tempat yang sama: `modules/realtime/`, `devices/calibration.ts`, `readings/waterDepth.ts`, `modules/admin/`.

Aturan: modul hanya saling memanggil lewat `service.ts`. Logika murni (`storagePolicy`, `offlineRule`, `downsample`, `carryForward`, `weather/merge`) tidak menyentuh I/O agar mudah di-unit-test. `weather/merge.ts` adalah porting dari logika frontend `weatherService.js`.

---

## 11. Code Style

```ts
// modules/ingestion/storagePolicy.ts — fungsi murni, tanpa I/O
export interface StoragePolicy { deadbandCm: number; heartbeatSec: number }
export interface LastStored { levelCm: number; ts: Date }

const round2 = (n: number) => Math.round(n * 100) / 100;

export function shouldStore(
  next: { levelCm: number; ts: Date },
  last: LastStored | null,
  policy: StoragePolicy,
): boolean {
  if (!last) return true;                                                       // S1
  const delta = Math.abs(round2(next.levelCm) - round2(last.levelCm));
  if (delta > 0 && delta >= policy.deadbandCm) return true;                     // S2
  if (next.ts < last.ts) return true;                                           // kiriman ulang
  return (next.ts.getTime() - last.ts.getTime()) / 1000 >= policy.heartbeatSec; // S3
}
```

- File `camelCase.ts`, tipe `PascalCase`, kolom DB `snake_case`, JSON API `camelCase`.
- Tidak ada `any`; error bisnis memakai `AppError(code, httpStatus)` dari `shared/errors.ts`.
- Token (user maupun device) dan password broker tidak pernah ditulis ke log.

---

## 12. Testing Strategy (MVP)

| Level | Cakupan | Tools |
|---|---|---|
| Unit | `shouldStore` (S1–S3, kiriman ulang), aturan offline, status, downsampling, carry forward, merge cuaca BMKG + Open-Meteo, parsing payload | Vitest |
| Integration | REST + DB nyata; login/refresh/logout; role (viewer → 403 pada endpoint ubah data, tanpa token → 401); sinkronisasi Dynamic Security (create/rotate/disable/delete → device benar-benar bisa/tidak bisa connect ke Mosquitto); rekonsiliasi saat start | Vitest + Testcontainers |
| Contract | Response `/devices`, `/summary`, `/readings`, `/weather` cocok dengan kontrak frontend | Zod schema |
| E2E | Simulator MQTT → Mosquitto → DB → `GET /devices` & `/readings` | script `simulate` + test |

Target: coverage ≥ 80% untuk `modules/*/service.ts` dan 100% branch untuk `storagePolicy` & `offlineRule`. Setiap bug diperbaiki dengan regression test terlebih dahulu.

> **Penyesuaian untuk target 5 hari:** MVP memakai unit test untuk logika murni (100% branch untuk `storagePolicy` & `offlineRule`) + test ke stack Docker lokal + smoke test dengan simulator. Testcontainers dan target coverage 80% dipindah ke awal F2. Detail di [tasks/plan.md](tasks/plan.md).

---

## 13. Boundaries

- **Always:** jalankan `npm run lint && npm run test` sebelum commit; validasi semua input (REST & MQTT) dengan Zod; simpan waktu dalam UTC; simpan token hanya dalam bentuk hash; jangan mengubah data mentah `readings`; beri label fase pada requirement baru dan update PRD bila keputusan berubah.
- **Ask first:** menarik fitur F2 ke MVP; perubahan skema DB setelah migrasi pertama dirilis; menambah dependency baru; mengubah kontrak API yang dipakai frontend; mengubah default heartbeat/deadband/offline; mengganti broker atau sumber cuaca.
- **Never:** commit secret/`.env`; menyimpan password atau token device dalam plaintext; menulis token ke log; menyimpan kredensial broker di database; hard-delete reading di luar job retensi; mematikan test yang gagal tanpa persetujuan; memanggil API cuaca tanpa cache.

---

## 14. Success Criteria

### Definition of Done MVP
1. Admin & viewer bisa login; tanpa token → 401; viewer mencoba tambah/edit/hapus device → 403.
2. Dashboard frontend (`VITE_USE_MOCK=false`, `VITE_WEATHER_SOURCE=backend`, polling aktif) menampilkan device, summary, histori, last reading, dan cuaca Bogor dari backend.
3. Admin membuat device → mendapat token sekali tampil + info MQTT → device dengan token itu bisa publish. Di Mosquitto lokal (mode `mosquitto`): token salah, token yang sudah dirotasi, atau device nonaktif ditolak otomatis. Di HiveMQ (mode `manual`): langkah setup credential ditampilkan dan token salah ditolak broker.
4. Simulator mengirim reading tiap 60 detik → `GET /devices` menampilkan last reading terbaru < 2 detik setelah dikirim; pesan duplikat QoS 1 tidak menambah baris.
5. Simulator dengan nilai konstan 1 jam → ≤ 5 baris tersimpan (1 awal + heartbeat per 15 menit); simulator dengan noise ±0,5 cm → setiap perubahan tersimpan.
6. Simulator dihentikan → dashboard menampilkan device offline setelah 5 menit (event tercatat ≤ 5,5 menit); dijalankan lagi → online pada pesan pertama.
7. Broker di-restart / koneksi putus → worker reconnect otomatis dan `/health` kembali `worker: "up"`; worker di-restart (mode `mosquitto`) → akun device di broker sama dengan DB.
8. Export CSV/XLSX 30 hari untuk 1 device berhasil < 10 detik, oleh admin maupun viewer.
9. Kolom `sensor_count`, `readings.channel`, `deadband_cm`, `location_source`, dan tabel `device_time_sync` ada di migrasi.
10. ESP32 + HC-SR04 (device fisik) terhubung ke HiveMQ Cloud dan datanya tampil di dashboard yang di-deploy di Vercel.
11. Contoh firmware (`firmware/esp32-hcsr04/`) dan panduan integrasi device client (`docs/PANDUAN_INTEGRASI_DEVICE.md`) tersedia, termasuk konfigurasi untuk HiveMQ maupun Mosquitto.

### Definition of Done F2 (ringkas)
WebSocket realtime berjalan; kalibrasi kedalaman menghasilkan `waterDepthCm` yang benar (mis. kedalaman 120 cm saat jarak 280 cm → jarak 250 cm = kedalaman 150 cm); retensi, partisi & agregat aktif; deploy produksi di cloud client (Mosquitto + api + worker + PostgreSQL); user management & audit log di web; status broker & resync di web.

---

## 15. Out of Scope

**Tidak termasuk MVP** (masuk F2): WebSocket realtime, kalibrasi kedalaman, retensi/partisi/agregat, deploy produksi di cloud client, user management lewat web, audit log, Last Will, status broker & resync di web, info firmware bisa diedit dari web.

**Belum direncanakan (Nanti):** pembatasan alat per lokasi/user dan akses publik tanpa login (hanya bila diminta client), tipe device 1/3/5 sensor & payload multi-sensor, koordinat GPS otomatis, logika sinkronisasi waktu, cuaca per device, data cuaca dari sensor fisik, notifikasi (WhatsApp/email/push) saat critical, konfigurasi device jarak jauh (OTA), koneksi broker penuh lewat web, HTTP ingestion.

---

## 16. Open Questions

| # | Pertanyaan | Status |
|---|---|---|
| Q1 | Pembagian role sensor | ✅ Token per device; tipe device 1/3/5 nanti |
| Q2 | Stack backend | ✅ Node.js |
| Q3 | Protokol & data device | ✅ MQTT QoS 1; jarak sensor ultrasonik → air (cm); kedalaman diukur saat pemasangan |
| Q4 | Sinkronisasi waktu | ✅ NTP |
| Q5 | Batas offline | ✅ 5 menit |
| Q6 | Retensi | ✅ Mentah 2 tahun, agregat permanen (F2) |
| Q7 | Cuaca | ✅ Satu lokasi (Bogor) |
| Q8 | Broker | ✅ Produksi Mosquitto (permintaan client), demo HiveMQ Cloud; pembagian dua lapis (§6); arsitektur deploy §0.1 |
| Q14 | Hosting demo | ✅ Vercel (frontend + api) + Supabase + HiveMQ Cloud; worker di laptop saat demo |
| Q9 | Role & login | ✅ MVP: login wajib, role `admin` & `viewer`, akun dibuat lewat script |
| Q10 | Viewer boleh export | ✅ Ya |
| Q11 | Kebijakan simpan | ✅ Semua perubahan disimpan, hanya duplikat dibuang |
| Q12 | Dasar threshold | ✅ Jarak; kedalaman sebagai info tambahan |
| Q13 | Pembatasan alat per lokasi & akses publik | ✅ Mengikuti MVP: semua login, semua user melihat semua alat; ID-9/ID-10 hanya bila diminta client |

---

## 17. Langkah Berikutnya

1. Implementasi mengikuti [tasks/plan.md](tasks/plan.md) dan [tasks/todo.md](tasks/todo.md).
2. Sebelum implementasi login, token device, dan Dynamic Security: tinjau dengan `doubt-driven-development` + `security-and-hardening`.
