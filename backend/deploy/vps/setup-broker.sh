#!/usr/bin/env bash
# Menyiapkan Mosquitto + Dynamic Security di VPS (versi Linux dari deploy/local/init-dynsec.ps1).
# Jalankan dari folder backend/ setelah backend/.env diisi:   sudo bash deploy/vps/setup-broker.sh
# Aman dijalankan ulang: file dynsec yang sudah ada tidak ditimpa, perintah "already exists" diabaikan.
#
# Membuat:
#   - admin Dynamic Security (password MQTT_DYNSEC_ADMIN_PASSWORD), hanya untuk script ini
#   - role baruna-backend + akun MQTT_USERNAME / MQTT_PASSWORD yang dipakai API dan worker
set -euo pipefail
cd "$(dirname "$0")/../.."

DYNSEC_FILE=/var/lib/mosquitto/dynamic-security.json
CONF_SRC=deploy/vps/mosquitto/baruna.conf
CONF_DST=/etc/mosquitto/conf.d/baruna.conf
PORT=1883

env_value() {
  local v
  v=$(grep -E "^\s*$1\s*=" .env | head -1 | cut -d= -f2- | sed -e 's/^\s*//' -e 's/\s*$//' -e 's/^"//' -e 's/"$//')
  if [[ -z "$v" || "$v" == GANTI* ]]; then echo "$1 belum diisi di backend/.env" >&2; exit 1; fi
  printf '%s' "$v"
}

[[ -f .env ]] || { echo "backend/.env belum ada (salin dari deploy/vps/env.production.example)" >&2; exit 1; }
ADMIN_PW=$(env_value MQTT_DYNSEC_ADMIN_PASSWORD)
BACKEND_USER=$(env_value MQTT_USERNAME)
BACKEND_PW=$(env_value MQTT_PASSWORD)

if [[ ! -f "$DYNSEC_FILE" ]]; then
  mosquitto_ctrl dynsec init "$DYNSEC_FILE" admin "$ADMIN_PW" >/dev/null
  chown mosquitto:mosquitto "$DYNSEC_FILE"
  chmod 600 "$DYNSEC_FILE"
  echo "dynamic-security.json dibuat (user admin)."
fi

install -m 644 "$CONF_SRC" "$CONF_DST"
systemctl enable mosquitto >/dev/null 2>&1
systemctl restart mosquitto
sleep 2
systemctl is-active --quiet mosquitto || { journalctl -u mosquitto -n 20 --no-pager; exit 1; }

# mosquitto_ctrl warns about running without TLS; harmless here (127.0.0.1 only), so it is filtered out.
dynsec() {
  mosquitto_ctrl -h 127.0.0.1 -p "$PORT" -u admin -P "$ADMIN_PW" dynsec "$@" 2>&1 \
    | grep -v -iE 'without encryption|visible on the network' || true
}

ctrl() {
  local out rc=0
  out=$(mosquitto_ctrl -h 127.0.0.1 -p "$PORT" -u admin -P "$ADMIN_PW" dynsec "$@" 2>&1) || rc=$?
  out=$(grep -v -iE 'without encryption|visible on the network|^\s*$' <<<"$out" || true)
  if [[ "$out" == *"already exists"* ]]; then
    echo "  $1: sudah ada"
  elif (( rc != 0 )); then
    echo "dynsec $1 gagal: $out" >&2; exit 1
  else
    echo "  $1: OK"
  fi
}

ctrl createRole baruna-backend
ctrl addRoleACL baruna-backend subscribePattern 'baruna/devices/#' allow
ctrl addRoleACL baruna-backend subscribePattern '$CONTROL/dynamic-security/#' allow
ctrl addRoleACL baruna-backend publishClientSend '$CONTROL/dynamic-security/#' allow
ctrl addRoleACL baruna-backend publishClientReceive '$CONTROL/dynamic-security/#' allow
ctrl createClient "$BACKEND_USER" -p "$BACKEND_PW"
ctrl setClientPassword "$BACKEND_USER" "$BACKEND_PW"
# Output is captured first: `grep -q` on a pipe would trip pipefail when it exits early.
client_info=$(dynsec getClient "$BACKEND_USER")
if ! grep -qE 'Roles:\s+baruna-backend' <<<"$client_info"; then
  ctrl addClientRole "$BACKEND_USER" baruna-backend
fi
echo "Selesai. Broker aktif di port $PORT, akun '$BACKEND_USER' siap."
