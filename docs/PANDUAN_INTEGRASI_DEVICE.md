# Panduan Integrasi Device — Water Level Monitoring Baruna Inotek

Untuk tim yang membuat atau memasang device sensor ketinggian air dan ingin menghubungkannya ke dashboard.
Panduan ini berlaku untuk device apa pun (ESP32, STM32 + modem, PLC, gateway LoRa, dan lain-lain) selama bisa
mengirim pesan MQTT. Contoh firmware lengkap (ESP32 + HC-SR04) ada di `firmware/esp32-hcsr04/`.

---

## 1. Gambaran singkat

```
Sensor ─► Device ──MQTT (QoS 1)──► Broker MQTT ──► Backend ──► Database ──► Dashboard
                    username = ID device
                    password = token device
```

- Device **hanya mengirim** (publish) data. Tidak ada perintah dari server ke device.
- Setiap device punya **ID** dan **token** sendiri. Broker menolak device dengan token salah, device yang
  dinonaktifkan, dan device yang dihapus.
- Device hanya boleh mengirim ke topic miliknya sendiri; kiriman ke topic device lain ditolak broker.

## 2. Syarat device

| Kebutuhan | Keterangan |
|---|---|
| Protokol | MQTT 3.1.1 atau 5.0, **publish QoS 1** |
| Jam | Tersinkron NTP (UTC). Waktu tidak boleh lebih dari 2 menit di depan jam server |
| Jaringan | Bisa menjangkau broker (host + port pada bagian 4). TLS bila brokernya memakai TLS |
| Pengukuran | Jarak **sensor → permukaan air** dalam **cm** (bukan kedalaman air) |
| Interval | Tetap, sama dengan `reportingIntervalSec` device di dashboard (default 60 detik) |

## 3. Mendaftarkan device dan mendapatkan token

1. Login ke dashboard sebagai **admin**.
2. Di kartu peta, klik **Add Device**, isi:
   - **Device ID**: huruf, angka, `-`, `_` (contoh `BWN-021`). ID dipakai sebagai username MQTT dan bagian topic,
     **tidak bisa diubah** dan **tidak bisa dipakai ulang** setelah device dihapus.
   - **Nama lokasi** dan **koordinat** (klik di peta atau isi manual).
3. Setelah disimpan, muncul jendela **Device credentials**: token, username, alamat broker, dan topic.
   **Salin token saat itu juga** — token hanya ditampilkan **sekali**.
4. Bila broker dikelola manual (HiveMQ Cloud), jendela yang sama berisi langkah membuat credential di console
   broker. Setelah dikerjakan, klik **Mark as set up in broker**.

Token hilang atau bocor? Pilih device → **Rotate Token**. Token lama langsung tidak berlaku, jadi firmware harus
diisi token baru.

> Token = password. Jangan dikirim lewat chat/email terbuka, jangan di-commit ke repository, dan jangan dipakai
> bersama oleh dua device.

## 4. Pengaturan koneksi MQTT

| Pengaturan | Nilai |
|---|---|
| Host, port, TLS | dari jendela *Device credentials* (lihat tabel di bawah) |
| Username | ID device, mis. `BWN-021` |
| Password | token device (`bwn_…`, ±47 karakter) |
| Client ID | **ID device** (unik; dua koneksi dengan client ID sama akan saling memutus) |
| Keep alive | 60 detik |
| Clean session | `false` (sesi persisten) |
| Last Will (disarankan) | topic `baruna/devices/{ID}/status`, payload `offline`, QoS 1, retain `false` |

### Mosquitto vs HiveMQ: yang berbeda hanya alamat, kredensial, dan sertifikat

| | Mosquitto (lokal / server client) | HiveMQ Cloud |
|---|---|---|
| Host | IP / domain server, mis. `mqtt.baruna.id` atau `10.26.42.157` (uji lokal) | `xxxxxxxx.s1.eu.hivemq.cloud` |
| Port | `1883` / `1884` tanpa TLS, `8883` dengan TLS | `8883` (wajib TLS) |
| TLS | sesuai konfigurasi server | wajib; root CA **ISRG Root X1** |
| Akun device | dibuat **otomatis** saat device ditambahkan | dibuat **manual** di console (langkah ditampilkan dashboard) |
| Topic, payload, QoS, username, password | **sama** | **sama** |

Firmware yang sama bisa dipindah dari satu broker ke broker lain hanya dengan mengganti host, port, pengaturan
TLS/sertifikat, dan token (bila device didaftarkan ulang). Gunakan **nama domain** di firmware, bukan IP, agar
pindah server cukup mengubah DNS.

## 5. Topic dan payload

**Topic:** `baruna/devices/{ID}/readings` — contoh `baruna/devices/BWN-021/readings`

**Satu pengukuran:**
```json
{ "ts": 1794621600, "level": 285.4 }
```

**Beberapa pengukuran sekaligus** (mis. data yang tertahan saat koneksi putus, maks. 500 per pesan):
```json
{ "readings": [ { "ts": 1794621540, "level": 285.6 }, { "ts": 1794621600, "level": 285.4 } ] }
```

| Field | Aturan |
|---|---|
| `ts` | Waktu pengukuran. **Epoch detik UTC** (disarankan) atau ISO-8601 **dengan zona waktu**, mis. `2026-11-15T07:30:00Z` / `2026-11-15T14:30:00+07:00`. Epoch milidetik juga diterima |
| `level` | Jarak sensor ke permukaan air, **cm**, 0–2000. Disimpan 2 desimal. Nilai kecil (air dekat sensor) tetap diterima karena bisa menandakan banjir |

Aturan pengiriman:
- **Kirim setiap interval walaupun nilainya tidak berubah.** Backend yang memutuskan apa yang disimpan
  (nilai sama hanya disimpan ulang tiap 15 menit), tetapi setiap pesan dipakai untuk status online.
- Pesan yang sama boleh terkirim dua kali (sifat QoS 1); backend membuang duplikat berdasarkan `ts`.
- Data lama yang dikirim ulang setelah koneksi pulih **tetap disimpan**, jadi tahan data saat offline lalu kirim
  sebagai batch.
- Pesan **ditolak** bila: bukan JSON, `level` di luar 0–2000, `ts` tidak terbaca, `ts` > 2 menit di depan jam server,
  atau `ts` sebelum tahun 2020 (jam belum tersinkron). Jangan mengirim sebelum NTP berhasil.

## 6. Status online / offline

- Device **online** selama ada pesan valid dalam `max(5 menit, 3 × interval)` terakhir
  (interval 60 detik → offline setelah 5 menit tanpa pesan).
- Pesan valid pertama setelah offline langsung membuat device online kembali.
- Device yang belum pernah mengirim data dianggap offline.

## 7. Checklist uji

Tanpa firmware, kirim satu pesan dengan `mosquitto_pub` (Mosquitto clients) dari komputer yang bisa menjangkau broker:
```bash
# tanpa TLS
mosquitto_pub -h <host> -p <port> -V mqttv311 -q 1 -i BWN-021 -u BWN-021 -P '<token>' \
  -t baruna/devices/BWN-021/readings -m "{\"ts\":$(date +%s),\"level\":123.4}"
# dengan TLS (HiveMQ / server produksi)
mosquitto_pub -h <host> -p 8883 --cafile isrgrootx1.pem -q 1 -i BWN-021 -u BWN-021 -P '<token>' \
  -t baruna/devices/BWN-021/readings -m "{\"ts\":$(date +%s),\"level\":123.4}"
```

- [ ] Device tersambung ke broker (tidak ada error "not authorised")
- [ ] Dalam ≤ 1 menit, dashboard menampilkan device **online** dengan *Last reading* yang sesuai
- [ ] Nilai cocok dengan pengukuran manual (penggaris / meteran) ke permukaan air
- [ ] Grafik *Water Level Chart* menampilkan titik baru
- [ ] Cabut daya / putus jaringan > 5 menit → device **offline**; nyalakan lagi → online tanpa reset manual
- [ ] Rotasi token di dashboard → device ditolak sampai firmware diisi token baru

## 8. Troubleshooting

| Gejala | Kemungkinan penyebab | Solusi |
|---|---|---|
| Koneksi ditolak "not authorised" / kode 4–5 | Token salah, username ≠ ID, device nonaktif/dihapus, token sudah dirotasi | Cek ID dan token; rotasi token bila ragu; pastikan device aktif |
| HiveMQ: ditolak padahal token benar | Credential belum dibuat / belum diberi izin publish | Ikuti langkah di jendela *Device credentials*, lalu *Mark as set up in broker* |
| Timeout / tidak bisa connect | Host/port salah, port diblokir jaringan, TLS tidak sesuai | Cek host & port; jaringan kantor/kampus sering memblokir 1883/8883; TLS wajib di port 8883 |
| Error sertifikat | Root CA tidak cocok / jam device salah | Pasang root CA yang benar (HiveMQ: ISRG Root X1); pastikan NTP berhasil sebelum TLS |
| Tersambung tapi data tidak muncul | Topic salah (huruf besar/kecil), payload tidak valid, `ts` di masa depan | Topic harus persis `baruna/devices/{ID}/readings`; cek JSON; cek NTP |
| Device sering putus–sambung | Client ID dipakai dua koneksi | Client ID harus unik (= ID device) |
| Status offline padahal mengirim | Interval di firmware lebih lama dari pengaturan device | Samakan interval firmware dengan `reportingIntervalSec` |
| Nilai melompat-lompat | Gema / permukaan bergelombang | Ambil median beberapa pengukuran (contoh firmware: median 5) |

Bila masih bermasalah, kirimkan ke tim backend: ID device, waktu kejadian (WIB), dan potongan log device.
**Jangan sertakan token.**
