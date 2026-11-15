/*
 * Baruna Inotek — contoh firmware ESP32 + HC-SR04 (water level)
 *
 * Kontrak (sama untuk semua device, lihat docs/PANDUAN_INTEGRASI_DEVICE.md):
 *   MQTT username = DEVICE_ID, password = DEVICE_TOKEN, client id = DEVICE_ID
 *   topic   : baruna/devices/{DEVICE_ID}/readings, QoS 1
 *   payload : {"ts":<epoch detik UTC>,"level":<jarak sensor→air, cm, 2 desimal>}
 *             atau {"readings":[{...},{...}]} untuk mengirim data yang tertunda
 *   Last Will: baruna/devices/{DEVICE_ID}/status = "offline"
 *
 * Library (Arduino IDE → Library Manager):
 *   - "MQTT" oleh Joel Gaehwiler (256dpi/arduino-mqtt) — mendukung publish QoS 1
 * Board: esp32 by Espressif (core 3.x)
 */
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <MQTT.h>
#include <time.h>
#include "config.h"

static const uint32_t MIN_VALID_EPOCH = 1700000000;  // jam belum disetel NTP bila lebih kecil
static const int SAMPLES = 5;                        // median dari 5 pengukuran
static const float MIN_CM = 2.0, MAX_CM = 400.0;     // jangkauan HC-SR04
static const int QUEUE_MAX = 30;                     // reading yang ditahan saat broker tak terjangkau
static const int MQTT_BUFFER = 2048;

#if MQTT_USE_TLS
WiFiClientSecure net;
#else
WiFiClient net;
#endif
MQTTClient mqtt(MQTT_BUFFER);

String topicReadings = String("baruna/devices/") + DEVICE_ID + "/readings";
String topicStatus = String("baruna/devices/") + DEVICE_ID + "/status";

struct Reading { uint32_t ts; float level; };
Reading queue[QUEUE_MAX];
int queueLen = 0;
uint32_t lastSample = 0;

// ── Sensor ────────────────────────────────────────────────────────────
float measureOnceCm() {
  digitalWrite(PIN_TRIG, LOW);
  delayMicroseconds(4);
  digitalWrite(PIN_TRIG, HIGH);
  delayMicroseconds(10);
  digitalWrite(PIN_TRIG, LOW);
  unsigned long us = pulseIn(PIN_ECHO, HIGH, 30000);  // ±5 m maksimum
  if (us == 0) return NAN;                              // tidak ada pantulan
  float cm = us * 0.0343f / 2.0f;                       // kecepatan suara ±343 m/s (±25 °C)
  return (cm < MIN_CM || cm > MAX_CM) ? NAN : cm;
}

// Median dari pengukuran yang valid; NAN bila kurang dari 3 yang valid.
float measureCm() {
  float v[SAMPLES];
  int n = 0;
  for (int i = 0; i < SAMPLES; i++) {
    float cm = measureOnceCm();
    if (!isnan(cm)) v[n++] = cm;
    delay(60);  // jeda agar gema sebelumnya hilang
  }
  if (n < 3) return NAN;
  for (int i = 1; i < n; i++)
    for (int j = i; j > 0 && v[j - 1] > v[j]; j--) { float t = v[j]; v[j] = v[j - 1]; v[j - 1] = t; }
  float m = (n % 2) ? v[n / 2] : (v[n / 2 - 1] + v[n / 2]) / 2.0f;
  return roundf(m * 100.0f) / 100.0f;
}

// ── Koneksi ───────────────────────────────────────────────────────────
void connectWiFi() {
  if (WiFi.status() == WL_CONNECTED) return;
  Serial.printf("WiFi: menyambung ke %s", WIFI_SSID);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  for (int i = 0; i < 40 && WiFi.status() != WL_CONNECTED; i++) { delay(500); Serial.print('.'); }
  Serial.println(WiFi.status() == WL_CONNECTED ? " OK " + WiFi.localIP().toString() : " gagal (dicoba lagi)");
}

bool clockValid() { return time(nullptr) > MIN_VALID_EPOCH; }

void waitForClock() {
  configTime(0, 0, NTP_SERVER_1, NTP_SERVER_2);  // UTC
  Serial.print("NTP: menunggu jam");
  for (int i = 0; i < 60 && !clockValid(); i++) { delay(500); Serial.print('.'); }
  Serial.println(clockValid() ? " OK" : " belum (data tidak dikirim sampai jam valid)");
}

void connectMqtt() {
  if (mqtt.connected() || WiFi.status() != WL_CONNECTED) return;
  Serial.printf("MQTT: menyambung ke %s:%d sebagai %s ... ", MQTT_HOST, MQTT_PORT, DEVICE_ID);
  if (mqtt.connect(DEVICE_ID, DEVICE_ID, DEVICE_TOKEN)) {
    Serial.println("OK");
    mqtt.publish(topicStatus, "online", false, 1);
  } else {
    // lastError -2/-3 = jaringan; returnCode 4/5 = token salah / device nonaktif / dihapus
    Serial.printf("gagal (error %d, kode %d)\n", (int)mqtt.lastError(), (int)mqtt.returnCode());
  }
}

// ── Kirim ─────────────────────────────────────────────────────────────
void enqueue(uint32_t ts, float level) {
  if (queueLen == QUEUE_MAX) {  // penuh: buang yang paling lama
    memmove(queue, queue + 1, sizeof(Reading) * (QUEUE_MAX - 1));
    queueLen--;
  }
  queue[queueLen++] = {ts, level};
}

// Mengirim antrean: 1 reading → payload tunggal, lebih → batch. Dihapus hanya setelah PUBACK (QoS 1).
void flushQueue() {
  if (queueLen == 0 || !mqtt.connected()) return;
  String payload;
  if (queueLen == 1) {
    payload = "{\"ts\":" + String(queue[0].ts) + ",\"level\":" + String(queue[0].level, 2) + "}";
  } else {
    payload = "{\"readings\":[";
    for (int i = 0; i < queueLen; i++) {
      if (i) payload += ',';
      payload += "{\"ts\":" + String(queue[i].ts) + ",\"level\":" + String(queue[i].level, 2) + "}";
    }
    payload += "]}";
  }
  if (mqtt.publish(topicReadings, payload, false, 1)) {
    Serial.printf("Terkirim %d reading: %s\n", queueLen, payload.c_str());
    queueLen = 0;
  } else {
    Serial.printf("Kirim gagal (error %d); %d reading ditahan\n", (int)mqtt.lastError(), queueLen);
  }
}

void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.printf("\nBaruna water level — device %s, interval %d s\n", DEVICE_ID, REPORT_INTERVAL_SEC);
  pinMode(PIN_TRIG, OUTPUT);
  pinMode(PIN_ECHO, INPUT);

  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  connectWiFi();
  waitForClock();

#if MQTT_USE_TLS
#if MQTT_TLS_INSECURE
  net.setInsecure();
#else
  net.setCACert(ROOT_CA);
#endif
#endif
  mqtt.begin(MQTT_HOST, MQTT_PORT, net);
  mqtt.setOptions(60 /* keepalive s */, false /* clean session */, 5000 /* timeout ms */);
  mqtt.setWill(topicStatus.c_str(), "offline", false, 1);
  connectMqtt();
  lastSample = millis() - REPORT_INTERVAL_SEC * 1000UL;  // ukur segera
}

void loop() {
  mqtt.loop();
  delay(10);

  static uint32_t lastRetry = 0;
  if (millis() - lastRetry > 5000) {  // coba sambung ulang tiap 5 detik bila putus
    lastRetry = millis();
    connectWiFi();
    if (!clockValid()) waitForClock();
    connectMqtt();
    flushQueue();  // kirim data tertunda setelah tersambung kembali
  }

  if (millis() - lastSample >= REPORT_INTERVAL_SEC * 1000UL) {
    lastSample = millis();
    if (!clockValid()) {
      Serial.println("Lewati: jam belum sinkron (NTP)");
      return;
    }
    float cm = measureCm();
    if (isnan(cm)) {
      Serial.println("Lewati: sensor tidak mendapat pantulan yang valid (cek kabel / jarak 2–400 cm)");
      return;
    }
    enqueue((uint32_t)time(nullptr), cm);
    Serial.printf("Ukur: %.2f cm\n", cm);
    flushQueue();
  }
}
