/**
 * Plain-text credentials file offered once, in the token modal after "Add device" / "Rotate token".
 * Built entirely in the browser from the one-time response; nothing is stored or sent anywhere.
 */

const pad = (n) => String(n).padStart(2, '0');

/** Date parts in WIB (Asia/Jakarta, UTC+7, no DST). */
function wibParts(date) {
  const d = new Date(date.getTime() + 7 * 3600 * 1000);
  return { y: d.getUTCFullYear(), mo: pad(d.getUTCMonth() + 1), d: pad(d.getUTCDate()), h: pad(d.getUTCHours()), mi: pad(d.getUTCMinutes()) };
}

export function credentialsFileName(deviceId, date = new Date()) {
  const p = wibParts(date);
  return `baruna-credentials-${deviceId}-${p.y}${p.mo}${p.d}-${p.h}${p.mi}.txt`;
}

export function buildCredentialsText(issued, date = new Date()) {
  const p = wibParts(date);
  const { mqtt } = issued;
  const statusTopic = mqtt?.topic?.replace(/\/readings$/, '/status');
  const lines = [
    'Baruna Water Level - Device Credentials',
    '=======================================',
    `Dibuat       : ${p.y}-${p.mo}-${p.d} ${p.h}:${p.mi} WIB`,
    `Device ID    : ${issued.id}`,
  ];
  if (issued.name) lines.push(`Nama         : ${issued.name}`);
  lines.push('');
  if (mqtt) {
    lines.push(
      `MQTT Host    : ${mqtt.host}`,
      `MQTT Port    : ${mqtt.port}   (TLS: ${mqtt.tls ? 'ya' : 'tidak'})`,
      `Username     : ${mqtt.username}`,
      `Password     : ${issued.token}`,
      `Topic data   : ${mqtt.topic}`,
      `Topic status : ${statusTopic}`,
      '',
      'Untuk firmware ESP32 (firmware/esp32-hcsr04/config.h):',
      `#define DEVICE_ID      "${issued.id}"`,
      `#define DEVICE_TOKEN   "${issued.token}"`,
      `#define MQTT_HOST      "${mqtt.host}"`,
      `#define MQTT_PORT      ${mqtt.port}`,
      `#define MQTT_USE_TLS   ${mqtt.tls ? 1 : 0}`,
    );
  } else {
    lines.push(`Password     : ${issued.token}`);
  }
  lines.push(
    '',
    'PENTING: token ini tidak bisa ditampilkan lagi. Simpan di tempat aman',
    '(password manager / folder serah terima dengan akses terbatas).',
    'Siapa pun yang memegang file ini bisa mengirim data atas nama device ini.',
    'Bila hilang atau bocor: admin -> Rotate Token, lalu flash ulang firmware.',
    '',
  );
  // CRLF so Notepad on older Windows shows the lines correctly.
  return lines.join('\r\n');
}

/** Triggers a browser download of `text` as a UTF-8 .txt file. */
export function downloadTextFile(fileName, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
