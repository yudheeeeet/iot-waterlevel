# Runbook Demo (lokal di laptop)

Demo MVP berjalan sepenuhnya di laptop. Deploy ke Vercel + Supabase **ditunda**; konfigurasinya sudah tersedia
(`vercel.json`, `backend/vercel.json`, `backend/src/vercel.ts`) untuk dipakai nanti.

```
ESP32 + HC-SR04 ──WiFi hotspot──► Mosquitto (laptop :1884) ──► Worker ──► PostgreSQL (laptop)
                                                                              │
Penonton (browser laptop / HP di hotspot yang sama) ◄── Dashboard :5173 ◄── API :8080
```

| Komponen | Perintah | Port |
|---|---|---|
| PostgreSQL 18 | service Windows `postgresql-x64-18` (otomatis) | 5432 |
| Mosquitto proyek | `npm run broker:lan` (folder `backend`) | 1884 |
| API | `npm run dev` (folder `backend`) | 8080 |
| Worker | `npm run worker` (folder `backend`) | – |
| Dashboard | `npm run dev:demo` (folder root) — memakai `.env.demo` (backend asli, tanpa mock) | 5173 |

---

## H-1: persiapan (sekali)

- [ ] `git pull`; `npm install` di root **dan** di `backend/`.
- [ ] `backend/.env` terisi (DB, JWT, MQTT). Cek: `cd backend; npm run db:check` → `OK …`.
- [ ] Migrasi terbaru: `npm run db:migrate`.
- [ ] Akun demo: `admin@baruna.local` (admin) dan `viewer@baruna.local` (viewer). Lupa password:
      `npm run user:reset-password -- --email admin@baruna.local` (password baru dicetak sekali).
- [ ] Firewall (sekali, perlu Administrator): `powershell -ExecutionPolicy Bypass -File deploy\local\open-firewall.ps1`
      → membuka 1884 (ESP32) dan 5173 (dashboard dari HP) **hanya** untuk jaringan Private; jawab `y` untuk hotspot sendiri.
- [ ] Hotspot HP: **2,4 GHz**, ada internet (NTP untuk ESP32, BMKG/Open-Meteo untuk cuaca).
- [ ] ESP32: device terdaftar (mis. `BWN-001`), `config.h` berisi WiFi hotspot, token, dan `MQTT_HOST` = IP laptop
      di hotspot. Lihat `firmware/esp32-hcsr04/README.md`.
- [ ] Gladi: jalankan bagian "Hari H" sekali, pastikan ESP32 tampil online.
- [ ] Data histori untuk grafik: biarkan ESP32 (atau `npm run simulate`) berjalan beberapa jam sebelum demo,
      agar grafik 6/24 jam tidak kosong.

## Hari H: dari laptop mati sampai dashboard menampilkan data (±5 menit)

1. Nyalakan laptop, sambungkan ke **hotspot HP**. Nyalakan ESP32 (boleh belakangan).
2. PowerShell di folder `backend`:
   ```powershell
   npm run demo:local
   ```
   Empat jendela terbuka (Broker, API, Worker, Dashboard). Script mencetak alamat dashboard dan IP untuk ESP32.
3. **Cek IP laptop.** Bila berbeda dari `MQTT_HOST` di firmware (IP hotspot bisa berubah), lihat "Pemulihan → IP berubah".
4. Buka `http://localhost:8080/api/health` → harus `"db":"up","worker":"up"`.
5. Buka dashboard `http://localhost:5173`, login.
6. Dalam ±1 menit ESP32 tampil **online** dengan *Last reading* terbaru (Serial Monitor menampilkan `Terkirim …`).

## Alur demo yang disarankan (±10 menit)

1. **Login wajib** — buka dashboard: hanya halaman login. Login sebagai **viewer**: bisa melihat semua, tidak ada
   tombol Add/Edit/Rotate/Remove.
2. **Data langsung dari sensor** — dekatkan tangan / papan ke sensor; dalam ≤ 30 detik (interval polling demo)
   *Last reading* dan status (Normal → Warning → Critical) berubah. Jarak = sensor ke permukaan air.
3. **Grafik & export** — *Water Level Chart* 6 jam, lalu **Export XLSX** dan buka di Excel (sheet *Info*
   menjelaskan isinya).
4. **Cuaca Bogor** — kartu cuaca dari BMKG (hari 1–3) dan Open-Meteo (hari 4–7).
5. **Online / offline** — cabut daya ESP32: setelah 5 menit status **Offline** dan grafik menampilkan celah;
   nyalakan lagi → langsung Online. (Agar tidak menunggu 5 menit, sebelumnya set device dengan
   `offlineAfterSec` lebih pendek, lihat di bawah.)
6. **Admin & keamanan device** — logout, login **admin**: Add Device → jendela token sekali tampil + info MQTT.
   Klik **Download credentials (.txt)**: file berisi token, info MQTT, dan potongan `config.h`.
   Jendela baru bisa ditutup setelah token diunduh, disalin, atau dicentang "sudah disimpan".
   Rotate Token pada device simulator → device lama langsung ditolak broker.

Mempersingkat batas offline untuk demo (contoh 60 detik) lalu mengembalikannya:
```powershell
$login = Invoke-RestMethod -Method Post http://localhost:8080/api/auth/login -ContentType 'application/json' -Body '{"email":"admin@baruna.local","password":"<password>"}'
$h = @{ Authorization = "Bearer $($login.accessToken)" }
Invoke-RestMethod -Method Patch http://localhost:8080/api/devices/BWN-001 -Headers $h -ContentType 'application/json' -Body '{"offlineAfterSec":60}'
# setelah demo:
Invoke-RestMethod -Method Patch http://localhost:8080/api/devices/BWN-001 -Headers $h -ContentType 'application/json' -Body '{"offlineAfterSec":null}'
```

Cadangan bila ESP32 bermasalah: simulator mengirim data seperti device asli.
```powershell
npm run simulate -- --setup 3            # sekali: SIM-001..003
npm run simulate -- --interval 5 --mode rise --base 230
```

## Pemulihan

| Masalah | Tanda | Tindakan |
|---|---|---|
| Worker mati | `/api/health` → `worker: down`; data tidak bertambah | Jendela Worker: `npm run worker`. Dashboard tetap jalan; status online tetap benar. Pesan selama worker mati diterima setelah worker menyala (sesi persisten ±1 jam) |
| Broker mati | ESP32 log `MQTT ... gagal (error -…)`; worker log `mqtt disconnected` | Jendela Broker: `npm run broker:lan`. ESP32 dan worker tersambung kembali sendiri; ESP32 mengirim data yang tertahan (maks. 30) |
| IP laptop berubah | `broker:lan` menampilkan PERHATIAN IP berbeda; ESP32 gagal connect | Ubah `MQTT_HOST` di `config.h`, upload ulang. Perbarui `MQTT_PUBLIC_HOST` di `backend/.env`. Agar stabil: atur IP tetap untuk laptop di pengaturan hotspot bila tersedia |
| WiFi ESP32 putus | Serial: `WiFi ... gagal` | ESP32 mencoba ulang tiap 5 detik; pastikan hotspot 2,4 GHz menyala |
| ESP32: `kode 4/5` | Token ditolak | Token salah atau sudah dirotasi; rotasi lagi dari dashboard (admin) dan upload firmware |
| ESP32: `jam belum sinkron` | Tidak ada internet di hotspot | Aktifkan data seluler HP |
| Dashboard: "Sign in" terus | Sesi kedaluwarsa / API mati | Cek jendela API; login ulang |
| HP penonton tidak bisa membuka dashboard | Timeout di `http://IP:5173` | Jalankan `open-firewall.ps1` (aturan 5173) dan pastikan jaringan Private |
| PostgreSQL mati | `db: down`, API 503 | `Start-Service postgresql-x64-18` (Administrator) |
| Cuaca kosong | Kartu cuaca error | Internet hotspot; data terakhir dipakai (`stale`) bila sumber sempat gagal |

## Selesai demo

Tutup keempat jendela (atau Ctrl+C di masing-masing). Data tetap tersimpan di PostgreSQL laptop.
