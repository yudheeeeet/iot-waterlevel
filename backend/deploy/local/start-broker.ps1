# Menjalankan Mosquitto lokal proyek (port 1884).
#   npm run broker:local  → hanya dari laptop ini (127.0.0.1)
#   npm run broker:lan    → juga dari perangkat lain di WiFi yang sama (uji ESP32)
param([switch]$Lan)
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..\..')

$mosquitto = 'C:\Program Files\mosquitto\mosquitto.exe'
if (-not (Test-Path $mosquitto)) { throw "Mosquitto tidak ditemukan di $mosquitto" }
if (-not (Test-Path '.mosquitto\dynamic-security.json')) {
  throw 'Dynamic Security belum diinisialisasi. Jalankan dulu: npm run broker:init'
}

$conf = 'deploy\mosquitto\mosquitto.local.conf'
if ($Lan) {
  $conf = 'deploy\mosquitto\mosquitto.lan.conf'
  $ips = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -notmatch '^(127|169\.254)\.' -and $_.PrefixOrigin -ne 'WellKnown' } |
    Select-Object -ExpandProperty IPAddress)
  $publicHost = (Get-Content .env -ErrorAction SilentlyContinue | Where-Object { $_ -match '^MQTT_PUBLIC_HOST=' }) -replace '^MQTT_PUBLIC_HOST=', ''

  Write-Host ''
  Write-Host '=== Broker dapat diakses dari WiFi ===' -ForegroundColor Cyan
  foreach ($ip in $ips) { Write-Host "  ESP32 -> host $ip  port 1884" }
  if ($publicHost -and ($ips -notcontains $publicHost)) {
    Write-Host "  PERHATIAN: MQTT_PUBLIC_HOST di .env = $publicHost, tidak sama dengan IP laptop saat ini." -ForegroundColor Yellow
    Write-Host '  IP berubah bila pindah WiFi / hotspot menyala ulang. Perbarui .env dan firmware bila perlu.' -ForegroundColor Yellow
  }
  $profiles = Get-NetConnectionProfile -ErrorAction SilentlyContinue
  if ($profiles | Where-Object { $_.NetworkCategory -eq 'Public' }) {
    Write-Host '  PERHATIAN: jaringan saat ini berstatus Public; firewall memblokir port 1884.' -ForegroundColor Yellow
    Write-Host '  Jalankan sekali (sebagai Administrator): deploy\local\open-firewall.ps1' -ForegroundColor Yellow
  }
  Write-Host ''
}

& $mosquitto -c $conf
