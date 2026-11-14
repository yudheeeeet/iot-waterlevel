# Firmware contoh: ESP32 + HC-SR04

Mengukur jarak sensor ke permukaan air (cm) lalu mengirimnya ke broker MQTT setiap `REPORT_INTERVAL_SEC` detik.
Kontrak data sama untuk semua device: lihat `docs/PANDUAN_INTEGRASI_DEVICE.md` (Task 20).

| | |
|---|---|
| Topic | `baruna/devices/{DEVICE_ID}/readings`, QoS 1 |
| Payload | `{"ts": 1794621600, "level": 285.40}` (ts = epoch detik UTC dari NTP, level = cm, 2 desimal) |
| Login MQTT | username = `DEVICE_ID`, password = token `bwn_…`, client id = `DEVICE_ID` |
| Data tertunda | saat broker tidak terjangkau, maksimal 30 reading ditahan lalu dikirim sebagai batch `{"readings":[…]}` |
| Last Will | `baruna/devices/{DEVICE_ID}/status` = `offline` |

## Rangkaian

| HC-SR04 | ESP32 | Keterangan |
|---|---|---|
| VCC | VIN (5 V) | HC-SR04 butuh 5 V |
| GND | GND | |
| TRIG | GPIO 5 | sinyal 3,3 V dari ESP32 cukup |
| ECHO | GPIO 18 **lewat pembagi tegangan** | ECHO mengeluarkan 5 V; GPIO ESP32 maksimal 3,3 V |

Pembagi tegangan ECHO: `ECHO ─ 1 kΩ ─┬─ GPIO 18`, dan `GPIO 18 ─ 2 kΩ ─ GND` (≈ 3,3 V).
Tanpa pembagi, GPIO ESP32 bisa rusak dalam jangka panjang.

Pasang sensor tegak lurus menghadap permukaan air, minimal 2 cm dan maksimal ±400 cm dari air.

## 1. Buat device dan ambil token

Frontend belum punya form device, jadi gunakan API (backend `npm run dev`, broker `npm run broker:lan`, worker `npm run worker`).
PowerShell, dari mana saja:
```powershell
$login = Invoke-RestMethod -Method Post http://localhost:8080/api/auth/login -ContentType 'application/json' `
  -Body '{"email":"admin@baruna.local","password":"<password admin>"}'
$h = @{ Authorization = "Bearer $($login.accessToken)" }
$dev = Invoke-RestMethod -Method Post http://localhost:8080/api/devices -Headers $h -ContentType 'application/json' `
  -Body '{"id":"BWN-001","name":"ESP32 Gilang","lat":-6.6071,"lon":106.8031,"reportingIntervalSec":60}'
$dev | Select-Object id, token, @{n='host';e={$_.mqtt.host}}, @{n='port';e={$_.mqtt.port}}, @{n='topic';e={$_.mqtt.topic}}
```
**Token hanya tampil sekali.** Bila hilang: `POST /api/devices/BWN-001/token/rotate` (token lama langsung tidak berlaku).

## 2. Konfigurasi
1. Salin `config.example.h` menjadi `config.h` (folder yang sama). `config.h` tidak di-commit.
2. Isi `WIFI_SSID`, `WIFI_PASSWORD`, `DEVICE_ID`, `DEVICE_TOKEN`, `MQTT_HOST`, `MQTT_PORT` dari langkah 1.
3. `REPORT_INTERVAL_SEC` harus sama dengan `reportingIntervalSec` device (default 60).

> ESP32 hanya mendukung WiFi **2,4 GHz**. Bila memakai hotspot HP, pastikan band 2,4 GHz aktif.
> ESP32 dan laptop (broker) harus di jaringan yang sama untuk uji lokal.

## 3. Upload
1. Arduino IDE → Boards Manager: **esp32 by Espressif** (diuji compile dengan core 3.3.11).
2. Library Manager: **MQTT by Joel Gaehwiler** (diuji dengan 2.5.3). PubSubClient tidak dipakai karena tidak bisa publish QoS 1.
3. Board: **ESP32 Dev Module**, pilih port COM, Upload.
4. Serial Monitor 115200 baud. Urutan normal:
   ```
   WiFi: menyambung ke Redmi 111..... OK 10.26.42.x
   NTP: menunggu jam.. OK
   MQTT: menyambung ke 10.26.42.157:1884 sebagai BWN-001 ... OK
   Ukur: 23.45 cm
   Terkirim 1 reading: {"ts":1794621600,"level":23.45}
   ```

## 4. Cek di backend
```powershell
Invoke-RestMethod http://localhost:8080/api/devices/BWN-001 -Headers $h   # online, lastReading
```
Bandingkan `lastReading.distanceCm` dengan pengukuran penggaris ke permukaan rata (target ±2 cm pada 10–200 cm).

## Troubleshooting

| Gejala di Serial Monitor | Penyebab | Solusi |
|---|---|---|
| `WiFi ... gagal` | SSID/password salah, WiFi 5 GHz | Cek `config.h`; aktifkan 2,4 GHz |
| `MQTT ... gagal (error -3 ...)` / error negatif lain | Broker tak terjangkau | Broker `npm run broker:lan` jalan? IP benar? Firewall (`deploy\local\open-firewall.ps1`)? Satu jaringan? |
| `MQTT ... gagal (... kode 4)` atau `kode 5` | Token salah, device nonaktif, atau sudah dihapus | Cek token; rotasi token bila ragu; cek `isEnabled` |
| `Lewati: jam belum sinkron` | NTP diblokir / tidak ada internet | Hotspot harus punya internet; data baru dikirim setelah jam valid |
| `Lewati: sensor tidak mendapat pantulan` | Kabel ECHO/TRIG, permukaan miring, terlalu dekat (< 2 cm) | Cek rangkaian dan posisi sensor |
| Terkirim, tapi tidak muncul di dashboard | Worker tidak jalan, atau `ts` jam device > 2 menit di depan | Jalankan `npm run worker`; lihat log worker (`message rejected`) |

Kecepatan suara diasumsikan 343 m/s (±25 °C). Selisih suhu 10 °C menggeser hasil ±1,7 %; kompensasi suhu bisa ditambahkan nanti.

## TLS (HiveMQ Cloud / broker produksi)
Set `MQTT_USE_TLS 1`, `MQTT_PORT 8883`, dan tempel sertifikat root CA broker ke `ROOT_CA`
(HiveMQ Cloud: ISRG Root X1, https://letsencrypt.org/certs/isrgrootx1.pem). Mode ini sudah lulus compile
tetapi belum diuji ke broker sungguhan.
