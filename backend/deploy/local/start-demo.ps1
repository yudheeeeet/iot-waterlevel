# Menyalakan seluruh sistem demo lokal, masing-masing di jendela PowerShell sendiri:
#   1) Mosquitto proyek (mode WiFi, port 1884)   2) API (port 8080)   3) Worker   4) Dashboard (port 5173)
# Jalankan dari folder backend/:  npm run demo:local
# Menutup sebuah jendela = menghentikan komponen itu.
$ErrorActionPreference = 'Stop'
$backend = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$root = (Resolve-Path (Join-Path $backend '..')).Path

function Start-Window($title, $dir, $command) {
  $cmd = "`$Host.UI.RawUI.WindowTitle = '$title'; Set-Location '$dir'; $command"
  Start-Process powershell -ArgumentList @('-NoExit', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', $cmd) | Out-Null
  Write-Host "  - $title"
}

$pg = Get-Service 'postgresql-x64-18' -ErrorAction SilentlyContinue
if ($pg -and $pg.Status -ne 'Running') { Write-Host 'PERINGATAN: service PostgreSQL tidak berjalan (postgresql-x64-18).' -ForegroundColor Yellow }

Write-Host 'Menyalakan:'
if (Get-NetTCPConnection -State Listen -LocalPort 1884 -ErrorAction SilentlyContinue) {
  Write-Host '  - Broker sudah berjalan di port 1884 (dilewati)'
} else {
  Start-Window 'Baruna · Broker (1884)' $backend 'npm run broker:lan'
  Start-Sleep -Seconds 2
}
Start-Window 'Baruna · API (8080)' $backend 'npm run dev'
Start-Window 'Baruna · Worker' $backend 'npm run worker'
Start-Window 'Baruna · Dashboard (5173)' $root 'npm run dev:demo'

$ips = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
  Where-Object { $_.IPAddress -notmatch '^(127|169\.254)\.' -and $_.PrefixOrigin -ne 'WellKnown' } |
  Select-Object -ExpandProperty IPAddress)
Write-Host ''
Write-Host 'Tunggu ±10 detik, lalu buka:' -ForegroundColor Cyan
Write-Host '  Dashboard di laptop : http://localhost:5173'
foreach ($ip in $ips) { Write-Host "  Dari HP/laptop lain : http://${ip}:5173   (WiFi yang sama; perlu firewall 5173, lihat RUNBOOK)" }
Write-Host '  Status backend      : http://localhost:8080/api/health  (db: up, worker: up)'
foreach ($ip in $ips) { Write-Host "  ESP32 → broker      : ${ip}:1884" }
