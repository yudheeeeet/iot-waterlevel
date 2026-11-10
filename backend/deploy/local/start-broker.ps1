# Menjalankan Mosquitto lokal proyek (port 1884). Dipanggil oleh: npm run broker:local
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..\..')

$mosquitto = 'C:\Program Files\mosquitto\mosquitto.exe'
if (-not (Test-Path $mosquitto)) { throw "Mosquitto tidak ditemukan di $mosquitto" }
if (-not (Test-Path '.mosquitto\dynamic-security.json')) {
  throw 'Dynamic Security belum diinisialisasi. Jalankan dulu: npm run broker:init'
}

& $mosquitto -c 'deploy\mosquitto\mosquitto.local.conf'
