# Deploy ke VPS (Ubuntu 22.04 / 24.04)

Satu VPS menjalankan semua komponen:

```
ESP32 ──MQTT :1883──► Mosquitto ──► Worker ──► PostgreSQL ◄── API (127.0.0.1:8080) ◄── Nginx :80 ◄── Browser
                                                                                         └─ dashboard (dist/)
```

| Komponen | Cara jalan | Port |
|---|---|---|
| Nginx | service `nginx` | 80 (443 setelah HTTPS) |
| API | service `baruna-api` (`node dist/server.js`) | 127.0.0.1:8080 |
| Worker | service `baruna-worker` (`node dist/worker.js`), **hanya satu** | – |
| Mosquitto 2.x + Dynamic Security | service `mosquitto` | 1883 (8883 setelah TLS) |
| PostgreSQL 17 | service `postgresql` | 127.0.0.1:5432 |

File konfigurasi ada di `backend/deploy/vps/`.

## 1. Persiapan server (sekali)

Login dengan SSH key (user non-root dengan sudo), lalu:

```bash
# paket dasar, firewall, fail2ban, swap 2 GB
sudo apt update && sudo apt -y upgrade
sudo apt -y install ufw fail2ban curl ca-certificates gnupg lsb-release git
sudo ufw allow 22/tcp && sudo ufw allow 80/tcp && sudo ufw allow 1883/tcp
sudo ufw --force enable && sudo systemctl enable ufw   # beberapa image menonaktifkan service ufw saat boot
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# SSH hanya dengan key
printf 'PasswordAuthentication no\nKbdInteractiveAuthentication no\nPermitRootLogin no\n' | sudo tee /etc/ssh/sshd_config.d/10-hardening.conf
sudo sshd -t && sudo systemctl reload ssh
```

Pasang Node.js 22, PostgreSQL 17, Mosquitto 2.x, Nginx:

```bash
sudo install -d -m 0755 /etc/apt/keyrings
curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | sudo gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" | sudo tee /etc/apt/sources.list.d/nodesource.list
curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | sudo gpg --dearmor -o /etc/apt/keyrings/postgresql.gpg
echo "deb [signed-by=/etc/apt/keyrings/postgresql.gpg] https://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" | sudo tee /etc/apt/sources.list.d/pgdg.list
sudo add-apt-repository -y ppa:mosquitto-dev/mosquitto-ppa
sudo apt update
sudo apt -y install nodejs postgresql-17 mosquitto mosquitto-clients nginx build-essential
```

## 2. Kode dan konfigurasi

```bash
cd ~
git clone https://github.com/<akun>/iot-waterlevel.git
cd iot-waterlevel/backend
cp deploy/vps/env.production.example .env
nano .env        # ganti semua GANTI_… ; MQTT_PUBLIC_HOST = IP publik VPS
chmod 600 .env
```

Nilai acak untuk password/secret: `openssl rand -base64 48 | tr -d '/+=' | cut -c1-40`.

## 3. Database, broker, build, service

```bash
sudo bash deploy/vps/setup-db.sh          # role + database dari DATABASE_URL
sudo bash deploy/vps/setup-broker.sh      # Mosquitto + Dynamic Security + akun baruna-backend

npm ci && npm run build && npm run db:migrate
(cd .. && npm ci && npm run build)        # dashboard → ../dist (memakai .env.production)

sudo bash deploy/vps/install-services.sh  # systemd baruna-api + baruna-worker, situs Nginx
sudo systemctl restart baruna-api baruna-worker

npm run user:create -- --email admin@domain.com --name "Admin" --role admin   # password dicetak sekali
```

Cek: `curl http://127.0.0.1:8080/api/health` → `{"status":"ok","db":"up","worker":"up"}`,
lalu buka `http://<IP-VPS>` di browser.

## 4. Update aplikasi

```bash
cd ~/iot-waterlevel/backend && bash deploy/vps/update.sh
```
(git pull → build backend → migrasi → build dashboard → restart service)

## 5. Operasional

| Keperluan | Perintah |
|---|---|
| Status | `systemctl status baruna-api baruna-worker mosquitto postgresql nginx` |
| Log API / worker | `journalctl -u baruna-api -f` · `journalctl -u baruna-worker -f` |
| Log broker | `journalctl -u mosquitto -f` |
| Backup database | `pg_dump -h 127.0.0.1 -U baruna -Fc baruna > baruna-$(date +%F).dump` |

## 6. Setelah ada domain (HTTPS + MQTT TLS)

1. Arahkan A record `app.domain.com` dan `mqtt.domain.com` ke IP VPS.
2. `sudo ufw allow 443/tcp && sudo apt -y install certbot python3-certbot-nginx`
3. Ganti `server_name _;` di `/etc/nginx/sites-available/baruna` menjadi `app.domain.com`, lalu
   `sudo certbot --nginx -d app.domain.com`.
4. Di `backend/.env`: `COOKIE_SECURE=true`, `MQTT_PUBLIC_HOST=mqtt.domain.com`, `MQTT_PUBLIC_PORT=8883`,
   `MQTT_PUBLIC_TLS=true`; restart `baruna-api`.
5. Mosquitto: tambah listener 8883 dengan `certfile`/`keyfile` dari Let's Encrypt, buka port 8883,
   lalu flash firmware dengan `MQTT_USE_TLS 1` (lihat `firmware/esp32-hcsr04/README.md`).
   Setelah semua device pindah, tutup port 1883.
