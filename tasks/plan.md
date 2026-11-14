# Implementation Plan: MVP Backend — Baruna Inotek Water Level Monitoring

> Sumber: [PRD.md](../PRD.md) v1.1, cakupan **MVP** (§0.1, §1.4, §14 "Definition of Done MVP").
> Disusun dengan skill `planning-and-task-breakdown`. Daftar task detail: [todo.md](todo.md).
> **Target: maksimal 5 hari kerja** sampai MVP bisa dipakai dan didemokan. Selesai lebih cepat lebih baik; jadwal per hari di bawah adalah batas, bukan kewajiban. Task berikutnya langsung dimulai begitu checkpoint lolos audit.

## Overview

Membangun backend Node.js dengan dua program dari satu codebase:
- **`api`** di Vercel untuk dashboard (login, device, histori, export, cuaca).
- **`worker`** yang menerima data MQTT dari ESP32 lewat HiveMQ Cloud dan menyimpannya ke Supabase.

Frontend React yang sudah ada disambungkan ke backend dan di-deploy ke Vercel. Hasil akhirnya adalah demo end-to-end dengan ESP32 + HC-SR04, ditambah contoh firmware dan panduan integrasi device milik client.

## Pembagian Peran

| Peran | Siapa | Tanggung jawab |
|---|---|---|
| Programmer | Claude (AI coding agent) | Menulis kode backend & frontend, test, konfigurasi deploy, firmware contoh, dokumentasi |
| Auditor & penguji | Gilang | Review kode di setiap checkpoint, menguji sistem & hardware, menyiapkan akun layanan, memberi keputusan |

Setiap task diakhiri dengan **commit kecil + ringkasan perubahan** agar mudah diaudit. Checkpoint harian adalah **gerbang audit**: task berikutnya dimulai setelah Anda menyetujui hasil checkpoint, atau mencatat temuan untuk diperbaiki.

## Arsitektur Demo

```
ESP32 + HC-SR04 ──MQTT TLS 8883──► HiveMQ Cloud ──► worker (laptop) ──► Supabase
                                                                           │
                      Browser ──► Vercel: frontend ──rewrite /api──► Vercel: api
```

- **Development & test otomatis (lokal, sebelum deploy)** memakai **PostgreSQL 18 yang sudah terpasang di laptop** + **Mosquitto for Windows (Dynamic Security)**, tanpa Docker. Jalur produksi Mosquitto yang diminta client ikut teruji.
- Pindah lokal ↔ Supabase cukup dengan mengganti `DATABASE_URL`, karena Supabase juga PostgreSQL.
- **Demo online** memakai HiveMQ Cloud (`BROKER_PROVIDER=manual`). **Produksi** nanti memakai Mosquitto (`BROKER_PROVIDER=mosquitto`).

## Architecture Decisions

- **`api` dan `worker` dipisah.** Vercel hanya bisa menjalankan api (stateless); worker harus menyala terus. Di produksi keduanya menjadi dua container dari kode yang sama.
- **Online/offline dihitung saat dibaca** (`now - last_seen_at`), sehingga dashboard di Vercel selalu benar walau worker tidak berjalan. Worker hanya mencatat event untuk celah di grafik.
- **Adapter broker** (`BrokerProvisioner`): `mosquitto` membuat akun device otomatis lewat Dynamic Security; `manual` menampilkan langkah membuat credential di console HiveMQ.
- **API same-origin lewat rewrite Vercel** (`app.<domain>/api/*` → project api). Cookie refresh token tidak terkena masalah cross-site, dan CORS tidak diperlukan.
- **PostgreSQL standar** (tanpa TimescaleDB, karena tidak tersedia di Supabase PG17). Downsampling memakai `date_bin`. Lokal memakai PG18, Supabase PG17, jadi **hanya fitur yang ada di PG17** yang dipakai (mis. `gen_random_uuid()`, bukan `uuidv7()` milik PG18). Migrasi dijalankan ke kedua database di setiap checkpoint.
- **Development tidak bergantung pada Docker.** Docker Desktop terpasang di laptop (atas permintaan), tapi hanya dipakai untuk menguji `docker-compose` produksi (F2) bila diperlukan. Alur lokal utama tetap PostgreSQL 18 + Mosquitto for Windows.
- **Koneksi DB:** api (Vercel) memakai pooler Supabase mode transaction; worker memakai koneksi session/direct.
- **Keep-alive Supabase:** Vercel Cron harian memanggil `/api/cron/keepalive`, ditambah data dari worker selama demo. Ping ke Vercel tidak diperlukan karena Vercel tidak "tertidur".
- **Simulator device dibuat sebelum ingestion**, dan **ESP32 diuji di Hari 3** (bukan Hari 5), supaya masalah hardware dan jaringan ketahuan lebih awal.
- **Kontrak response mengikuti `src/mocks/mockBackend.js`.**
- **Port lokal api 8080**, sesuai `.env.example` frontend.

## Asumsi Rencana 5 Hari

1. Claude mengerjakan kode; Anda mengaudit di setiap checkpoint dalam hari yang sama, agar tidak menahan hari berikutnya.
2. **Akun layanan disiapkan Anda di Hari 1** (Supabase project, HiveMQ Cloud cluster, Vercel), karena membutuhkan login Anda. Kredensial dimasukkan ke `.env` lokal dan environment variables Vercel, **tidak** dikirim lewat chat.
3. ESP32 + HC-SR04 siap dipakai mulai Hari 3, dengan rangkaian pembagi tegangan pada pin ECHO.
4. Domain `.id` bisa diarahkan ke Vercel (DNS bisa diubah) paling lambat Hari 5.

## Penyesuaian Cakupan agar Muat 5 Hari

| Di PRD | Di rencana 5 hari | Alasan |
|---|---|---|
| Testcontainers, coverage ≥ 80% | Unit test logika murni (100% branch untuk dedup & offline) + test ke Docker lokal + smoke test simulator | Setup Testcontainers ±½ hari |
| Deteksi refresh token yang dipakai ulang | Rotasi refresh token biasa | Fitur keamanan lanjutan, tidak mempengaruhi demo |
| Endpoint metrik | Counter di log worker | Cukup untuk demo |
| TLS di Mosquitto lokal | Lokal tanpa TLS; HiveMQ (demo) sudah TLS | TLS Mosquitto disiapkan saat deploy produksi |

Yang **tidak** dikurangi: token per device, login & role, buang duplikat, aturan offline, kontrak API sesuai frontend, jalur Mosquitto (diuji lokal).

## Dependency Graph

```
T1 Scaffold ─┬─► T3 Schema ─┬─► T4 Auth ──────────────────────────────────────┐
T2 Docker + akun ┘          │                                                  │
             └─► T5 Adapter broker ─┴─► T6 Device CRUD ─► T7 Rotasi/Rekonsiliasi│
                                          │                                    │
                                          ├─► T8 Simulator                     │
                    T9 Logika ingestion ──┴─► T10 Worker ─► T11 Presence       │
                                                   │            │              │
                                                   └─► T12 ESP32 + HiveMQ      │
               ┌───────────────┬───────────────┬──────────┘                    │
               ▼               ▼               ▼          T16 Cuaca            │
          T13 Histori    T14 Summary     T15 Export          │                 │
               └───────────────┴───────────────┴─────────────┴─────────────────┤
                                                                               ▼
                         T17 Frontend auth ─► T18 Frontend MVP ─► T19 Deploy demo ─► T20 Panduan & runbook
```

## Jadwal

| Hari | Fokus | Task | Hasil yang bisa diaudit |
|---|---|---|---|
| **1** | Fondasi | T1–T4 | PostgreSQL & Mosquitto lokal jalan, login admin/viewer, akun layanan demo siap |
| **2** | Device & broker | T5–T7 | Device + token; di Mosquitto lokal token benar diterima, salah ditolak; mode HiveMQ menampilkan langkah setup |
| **3** | Data masuk + hardware | T8–T12 | Simulator & **ESP32 asli** → HiveMQ → worker → DB; dedup & offline benar |
| **4** | Data keluar | T13–T16 | Semua endpoint MVP sesuai kontrak frontend |
| **5** | Integrasi, deploy, demo | T17–T20 | Dashboard di Vercel dengan data ESP32, panduan device client, runbook demo |

## Task List

### Hari 1: Fondasi
- [x] T1: Scaffold backend (`app.ts`, `server.ts`, `worker.ts`, env, error format, `/health`)
- [x] T2: Setup lokal (database di PostgreSQL 18 + Mosquitto for Windows dengan Dynamic Security) + checklist akun layanan demo
- [x] T3: Skema database, migrasi, seed
- [x] T4: Login, refresh, logout, guard role, script `user:create`

### Checkpoint Hari 1 (audit)
- [ ] Setup lokal dari nol mengikuti README berhasil
- [ ] Login admin & viewer; tanpa token → 401
- [ ] Mosquitto lokal menolak koneksi anonim
- [ ] Akun Supabase, HiveMQ Cloud, dan Vercel sudah dibuat; migrasi berhasil dijalankan ke Supabase

### Hari 2: Device & Broker
- [x] T5: Adapter broker (`mosquitto` via Dynamic Security, `manual` untuk HiveMQ) — langkah HiveMQ menunggu uji manual Gilang
- [x] T6: CRUD device + penerbitan token
- [x] T7: Rotasi token, aktif/nonaktif, rekonsiliasi (mode `mosquitto`)

### Checkpoint Hari 2 (audit)
- [ ] Mosquitto lokal: buat device → token → publish berhasil; token salah/rotasi/nonaktif ditolak
- [ ] Mode `manual`: response berisi langkah setup HiveMQ; credential yang dibuat sesuai langkah itu bisa publish ke HiveMQ
- [ ] Viewer → 403 pada endpoint ubah device

### Hari 3: Data Masuk + Hardware
- [x] T8: Simulator device MQTT
- [x] T9: Logika ingestion murni + unit test
- [x] T10: Worker: consumer MQTT, penyimpanan, heartbeat
- [x] T11: Online/offline (dihitung saat dibaca + event di worker)
- [ ] T12: Firmware ESP32 + HC-SR04 → Mosquitto laptop (TLS/HiveMQ opsional) — kode selesai & lulus compile, menunggu uji hardware Gilang

### Checkpoint Hari 3 (audit)
- [ ] Simulator → data tersimpan; duplikat QoS 1 tidak menambah baris; nilai konstan ≤ 5 baris/jam
- [ ] ESP32 asli mengirim data lewat HiveMQ dan tersimpan di DB
- [ ] Device offline setelah 5 menit; worker reconnect sendiri setelah koneksi putus

### Hari 4: Data Keluar
- [ ] T13: Histori readings (downsampling + carry forward)
- [ ] T14: Summary + bentuk daftar device
- [ ] T15: Export CSV/XLSX
- [ ] T16: Cuaca Bogor (BMKG + Open-Meteo, cache)

### Checkpoint Hari 4 (audit)
- [ ] Semua endpoint MVP (PRD §5) sesuai bentuk data `src/mocks/mockBackend.js`
- [ ] Unit test lulus, `npm run lint` & `npm run build` bersih
- [ ] DNS domain siap diarahkan ke Vercel

### Hari 5: Integrasi, Deploy, Demo
- [ ] T17: Frontend: login + Authorization + refresh otomatis
- [ ] T18: Frontend: polling devices, matikan WebSocket, "Last Reading", tampilan token, UI sesuai role
- [ ] T19: Deploy demo (Vercel api + frontend, Supabase, HiveMQ, cron keep-alive, domain)
- [ ] T20: Panduan integrasi device client + runbook demo

### Checkpoint Akhir (audit = PRD §14 DoD MVP)
- [ ] Kriteria DoD MVP 1–11 terpenuhi
- [ ] Demo end-to-end dengan ESP32 di domain publik berhasil
- [ ] Temuan audit sudah ditutup atau dicatat sebagai F2

## Kalau Terlambat: Urutan yang Dipotong

1. XLSX → hanya CSV dulu (T15).
2. Panduan integrasi device client (T20) dilengkapi setelah demo; runbook demo tetap dibuat.
3. Menyembunyikan tombol sesuai role di UI (T18). Backend tetap menolak viewer dengan 403.
4. Domain custom (T19). Demo memakai URL `*.vercel.app`.

Yang **tidak boleh** dipotong: token device, login, dedup, aturan offline, jalur Mosquitto yang teruji lokal.

## Risks and Mitigations

| Risiko | Dampak | Mitigasi |
|---|---|---|
| Protokol Dynamic Security lebih rumit dari perkiraan | Tinggi | Dikerjakan pertama di Hari 2. Bila > 3 jam macet: fallback password file + ACL file Mosquitto + reload, dicatat sebagai utang F2. Demo tidak terdampak karena memakai HiveMQ |
| Permission topic per credential di HiveMQ Cloud free terbatas | Sedang | Diverifikasi saat T5. Bila tidak bisa per topic, credential device tetap terpisah, dan worker hanya menerima data dari topic yang deviceId-nya terdaftar & aktif |
| Fastify di Vercel Functions (cold start, batas durasi) | Sedang | Satu entry function untuk semua route; export dibatasi 90 hari dan di-stream; bila bermasalah, api dipindah ke host lain tanpa ubah kode (`server.ts`) |
| Koneksi Vercel ke Supabase kehabisan koneksi | Sedang | Pakai pooler Supabase mode transaction (port 6543) dan pool kecil per function |
| ESP32: TLS ke HiveMQ gagal (sertifikat, memori, jam NTP) | Sedang | Diuji di Hari 3, bukan Hari 5. Firmware memuat root CA dan menunggu NTP sebelum connect |
| HC-SR04: pin ECHO 5V ke ESP32 3,3V | Sedang (hardware rusak) | Pembagi tegangan ditulis jelas di panduan firmware |
| Laptop (worker) mati saat demo | Sedang | Runbook: jalankan worker sebelum demo; `/health` menunjukkan `worker: down`; data tersimpan lagi begitu worker menyala (sesi persisten QoS 1) |
| Supabase free di-pause karena tidak aktif | Rendah | Vercel Cron keep-alive harian |
| Perbedaan PostgreSQL 18 (lokal) vs 17 (Supabase) | Rendah | Hanya fitur PG17; migrasi dijalankan ke kedua DB di setiap checkpoint |
| ~~Mosquitto for Windows tidak memuat plugin Dynamic Security~~ | Gugur | Sudah dicek: `mosquitto_dynamic_security.dll` ada di instalasi Windows |
| Tidak ada buffer di jadwal 5 hari | Sedang | Urutan potongan di atas; audit harian untuk deteksi molor sejak awal |

## Open Questions

Tidak ada yang menghalangi untuk mulai. Yang dibutuhkan dari Anda selama pengerjaan:
1. **Hari 1:** membuat akun/project Supabase, cluster HiveMQ Cloud, dan Vercel, lalu memasukkan kredensial ke `.env` lokal (template disediakan di T2).
2. **Hari 3:** ESP32 + HC-SR04 siap di-flash, dan info pin yang dipakai (default di contoh: TRIG GPIO5, ECHO GPIO18).
3. **Hari 5:** akses DNS domain `.id` untuk diarahkan ke Vercel.
