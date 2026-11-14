# Membuka port 1884 (Mosquitto proyek) untuk jaringan PRIVATE saja, agar ESP32 di WiFi yang sama bisa terhubung.
# Jalankan SEKALI sebagai Administrator, dari folder backend/:
#   powershell -ExecutionPolicy Bypass -File deploy\local\open-firewall.ps1
#
# Juga menandai jaringan yang sedang tersambung sebagai Private (hanya lakukan untuk jaringan milik sendiri,
# mis. hotspot HP). Di WiFi umum (kafe, kampus) jaringan tetap Public dan port 1884 tetap tertutup.
$ErrorActionPreference = 'Stop'

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
  [Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) { throw 'Jalankan PowerShell sebagai Administrator.' }

$ruleName = 'Baruna Mosquitto 1884 (Private)'
if (-not (Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue)) {
  New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Protocol TCP -LocalPort 1884 -Action Allow -Profile Private | Out-Null
  Write-Host "Firewall: aturan '$ruleName' dibuat (TCP 1884, hanya jaringan Private)."
} else {
  Write-Host "Firewall: aturan '$ruleName' sudah ada."
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
