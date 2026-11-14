# Membuka port 1884 (Mosquitto proyek) dan 5173 (dashboard demo) untuk jaringan PRIVATE saja,
# agar ESP32 dan HP/laptop lain di WiFi yang sama bisa terhubung.
# Jalankan SEKALI sebagai Administrator, dari folder backend/:
#   powershell -ExecutionPolicy Bypass -File deploy\local\open-firewall.ps1
#
# Juga menandai jaringan yang sedang tersambung sebagai Private (hanya lakukan untuk jaringan milik sendiri,
# mis. hotspot HP). Di WiFi umum (kafe, kampus) jaringan tetap Public dan port 1884 tetap tertutup.
$ErrorActionPreference = 'Stop'

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
  [Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
  # Buka ulang script ini sebagai Administrator (muncul jendela izin Windows / UAC → klik Yes).
  Write-Host 'Meminta izin Administrator... klik "Yes" pada jendela Windows yang muncul.'
  try {
    Start-Process powershell -Verb RunAs -ArgumentList @('-NoExit', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"")
  } catch {
    throw 'Izin Administrator ditolak. Jalankan ulang lalu klik "Yes", atau buka PowerShell dengan "Run as administrator".'
  }
  Write-Host 'Lanjutkan di jendela PowerShell Administrator yang baru terbuka.'
  return
}

# 1884 = broker untuk ESP32; 5173 = dashboard demo (npm run dev:demo) untuk dibuka dari HP/laptop lain.
foreach ($r in @(@{ Name = 'Baruna Mosquitto 1884 (Private)'; Port = 1884 }, @{ Name = 'Baruna Dashboard 5173 (Private)'; Port = 5173 })) {
  if (-not (Get-NetFirewallRule -DisplayName $r.Name -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -DisplayName $r.Name -Direction Inbound -Protocol TCP -LocalPort $r.Port -Action Allow -Profile Private | Out-Null
    Write-Host "Firewall: aturan '$($r.Name)' dibuat (TCP $($r.Port), hanya jaringan Private)."
  } else {
    Write-Host "Firewall: aturan '$($r.Name)' sudah ada."
  }
}

foreach ($p in Get-NetConnectionProfile) {
  if ($p.NetworkCategory -eq 'Public') {
    $answer = Read-Host "Jaringan '$($p.Name)' ($($p.InterfaceAlias)) berstatus Public. Jadikan Private? Hanya untuk jaringan milik sendiri [y/N]"
    if ($answer -match '^[yY]') {
      Set-NetConnectionProfile -InterfaceIndex $p.InterfaceIndex -NetworkCategory Private
      Write-Host "Jaringan '$($p.Name)' sekarang Private."
    }
  } else {
    Write-Host "Jaringan '$($p.Name)' sudah $($p.NetworkCategory)."
  }
}
Write-Host 'Selesai. Jalankan broker dengan: npm run broker:lan'
