// Salin file ini menjadi config.h lalu isi nilainya. config.h TIDAK di-commit (berisi password WiFi & token).
#pragma once

// ── WiFi ───────────────────────────────────────────────────────────────
#define WIFI_SSID      "NAMA_WIFI"
#define WIFI_PASSWORD  "PASSWORD_WIFI"

// ── Device (dari dashboard / respons POST /api/devices) ───────────────
// DEVICE_ID   = "username" / id device, mis. BWN-001
// DEVICE_TOKEN= token "bwn_..." yang ditampilkan SEKALI saat device dibuat / token dirotasi
#define DEVICE_ID      "BWN-001"
#define DEVICE_TOKEN   "bwn_GANTI_DENGAN_TOKEN"

// ── Broker MQTT (field "mqtt" pada respons pembuatan device) ──────────
// Uji lokal: Mosquitto di laptop (npm run broker:lan menampilkan IP-nya), port 1884, tanpa TLS.
#define MQTT_HOST      "10.26.42.157"
#define MQTT_PORT      1884
#define MQTT_USE_TLS   0
// TLS (HiveMQ Cloud / broker produksi, port 8883): set MQTT_USE_TLS 1 dan isi ROOT_CA di bawah dengan
// sertifikat root CA broker (HiveMQ Cloud: ISRG Root X1, unduh dari https://letsencrypt.org/certs/isrgrootx1.pem).
// MQTT_TLS_INSECURE 1 melewati verifikasi sertifikat: HANYA untuk uji coba, jangan dipakai di lapangan.
#define MQTT_TLS_INSECURE 0
static const char ROOT_CA[] = R"PEM(
-----BEGIN CERTIFICATE-----
TEMPEL_ISI_SERTIFIKAT_DI_SINI
-----END CERTIFICATE-----
)PEM";

// ── Pengukuran ─────────────────────────────────────────────────────────
// Harus sama dengan "reportingIntervalSec" device di dashboard (default 60).
#define REPORT_INTERVAL_SEC 60
// HC-SR04: TRIG langsung ke GPIO; ECHO (5 V) lewat pembagi tegangan ke GPIO (3,3 V). Lihat README.
#define PIN_TRIG 5
#define PIN_ECHO 18

// Zona waktu tidak dipakai: waktu dikirim dalam UTC (epoch detik) dari NTP.
#define NTP_SERVER_1 "pool.ntp.org"
#define NTP_SERVER_2 "time.google.com"
