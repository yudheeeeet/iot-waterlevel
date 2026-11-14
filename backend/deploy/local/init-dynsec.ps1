# Inisialisasi Dynamic Security untuk Mosquitto lokal. Dipanggil oleh: npm run broker:init
#
# Langkah:
#   1. Membuat .mosquitto/dynamic-security.json dengan user admin (bila belum ada).
#   2. Menyalakan broker sementara, lalu membuat role & akun `baruna-backend`
#      (subscribe baruna/devices/#, akses $CONTROL/dynamic-security/#).
#   3. Mematikan broker sementara.
# Password diambil dari backend/.env: MQTT_DYNSEC_ADMIN_PASSWORD dan MQTT_PASSWORD.
# Aman dijalankan ulang.
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..\..')

$bin = 'C:\Program Files\mosquitto'
$ctrl = Join-Path $bin 'mosquitto_ctrl.exe'
$port = 1884

function Get-EnvValue([string]$name) {
  if (-not (Test-Path '.env')) { throw 'File backend/.env belum ada. Salin dari .env.example lalu isi.' }
  $line = Get-Content '.env' | Where-Object { $_ -match "^\s*$name\s*=" } | Select-Object -First 1
  if (-not $line) { throw "$name belum diisi di backend/.env" }
  $value = ($line -split '=', 2)[1].Trim().Trim('"')
  if (-not $value -or $value -like 'GANTI*') { throw "$name belum diisi di backend/.env" }
  return $value
}

$adminPw = Get-EnvValue 'MQTT_DYNSEC_ADMIN_PASSWORD'
$backendUser = Get-EnvValue 'MQTT_USERNAME'
$backendPw = Get-EnvValue 'MQTT_PASSWORD'

New-Item -ItemType Directory -Force '.mosquitto' | Out-Null
if (-not (Test-Path '.mosquitto\dynamic-security.json')) {
  & $ctrl dynsec init '.mosquitto\dynamic-security.json' admin $adminPw
  if ($LASTEXITCODE -ne 0) { throw 'Gagal membuat dynamic-security.json' }
  Write-Host 'dynamic-security.json dibuat (user admin).'
}

$broker = Start-Process -FilePath (Join-Path $bin 'mosquitto.exe') `
  -ArgumentList '-c', 'deploy\mosquitto\mosquitto.local.conf' -PassThru -WindowStyle Hidden
Start-Sleep -Seconds 2

function Ctrl([string[]]$cmd) {
  # mosquitto_ctrl menulis peringatan "without encryption" ke stderr; wajar untuk broker localhost.
  $ErrorActionPreference = 'Continue'
  $out = & $ctrl -h 127.0.0.1 -p $port -u admin -P $adminPw dynsec @cmd 2>&1 |
    ForEach-Object { "$_" } |
    Where-Object { $_ -notmatch 'encryption|visible on the network|RemoteException|^\s*$' }
  $text = ($out | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -and $text -notmatch 'already exists') { throw "dynsec $($cmd -join ' ') gagal: $text" }
  if ($text) { Write-Host "  $($cmd[0]): $text" }
}

try {
  Ctrl @('createRole', 'baruna-backend')
  Ctrl @('addRoleACL', 'baruna-backend', 'subscribePattern', 'baruna/devices/#', 'allow')
  Ctrl @('addRoleACL', 'baruna-backend', 'subscribePattern', '$CONTROL/dynamic-security/#', 'allow')
  Ctrl @('addRoleACL', 'baruna-backend', 'publishClientSend', '$CONTROL/dynamic-security/#', 'allow')
  # Balasan Dynamic Security: topic '$...' tidak tercakup default ACL, jadi harus diizinkan eksplisit.
  Ctrl @('addRoleACL', 'baruna-backend', 'publishClientReceive', '$CONTROL/dynamic-security/#', 'allow')
  Ctrl @('createClient', $backendUser, '-p', $backendPw)
  # Pastikan password sesuai .env walau akun sudah ada sebelumnya.
  Ctrl @('setClientPassword', $backendUser, $backendPw)
  $ErrorActionPreference = 'Continue'
  $info = (& $ctrl -h 127.0.0.1 -p $port -u admin -P $adminPw dynsec getClient $backendUser 2>&1 | Out-String)
  $ErrorActionPreference = 'Stop'
  if ($info -notmatch 'Roles:\s+baruna-backend') { Ctrl @('addClientRole', $backendUser, 'baruna-backend') }
  Write-Host "Selesai. Akun '$backendUser' siap. Jalankan broker dengan: npm run broker:local"
}
finally {
  Stop-Process -Id $broker.Id -Force -ErrorAction SilentlyContinue
}
