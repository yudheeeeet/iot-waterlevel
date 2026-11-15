-- 0001_init: skema MVP (PRD §4). Hanya fitur PostgreSQL 17 agar sama di lokal (PG18) dan Supabase (PG17).

-- ===== identity =====
CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL CHECK (email = lower(email) AND length(email) BETWEEN 3 AND 254),
  name          text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  password_hash text NOT NULL,
  role          text NOT NULL CHECK (role IN ('admin', 'viewer')),
  is_active     boolean NOT NULL DEFAULT true,
  last_login_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_key ON users (email);

CREATE TABLE refresh_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash  text NOT NULL UNIQUE,              -- sha256(token), token asli tidak disimpan
  family_id   uuid NOT NULL,                     -- satu sesi login = satu family (untuk rotasi)
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz,
  replaced_by uuid REFERENCES refresh_tokens (id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX refresh_tokens_user_idx ON refresh_tokens (user_id);
CREATE INDEX refresh_tokens_family_idx ON refresh_tokens (family_id);

-- ===== devices =====
CREATE TABLE devices (
  -- dipakai juga sebagai username MQTT & bagian topic: tanpa '/', '+', '#', spasi
  id                     text PRIMARY KEY CHECK (id ~ '^[A-Za-z0-9_-]{1,64}$'),
  name                   text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  lat                    double precision NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lon                    double precision NOT NULL CHECK (lon BETWEEN -180 AND 180),
  location_source        text NOT NULL DEFAULT 'manual' CHECK (location_source IN ('manual', 'gps')),
  sensor_count           smallint NOT NULL DEFAULT 1 CHECK (sensor_count IN (1, 3, 5)),   -- disiapkan, belum dipakai
  reporting_interval_sec integer NOT NULL DEFAULT 60 CHECK (reporting_interval_sec BETWEEN 10 AND 3600),
  offline_after_sec      integer CHECK (offline_after_sec IS NULL OR offline_after_sec >= 30),  -- NULL = rumus default
  deadband_cm            numeric(5,2) NOT NULL DEFAULT 0 CHECK (deadband_cm >= 0),         -- 0 = simpan semua perubahan
  heartbeat_sec          integer NOT NULL DEFAULT 900 CHECK (heartbeat_sec >= 60),
  threshold_warning_cm   integer NOT NULL DEFAULT 200,
  threshold_critical_cm  integer NOT NULL DEFAULT 100,
  is_enabled             boolean NOT NULL DEFAULT true,
  broker_sync_status     text NOT NULL DEFAULT 'pending'
                           CHECK (broker_sync_status IN ('pending', 'synced', 'needs_token_rotation', 'error')),
  last_seen_at           timestamptz,
  last_reading_cm        numeric(7,2),
  last_reading_at        timestamptz,
  last_status            text CHECK (last_status IN ('normal', 'warning', 'critical')),
  last_stored_cm         numeric(7,2),          -- acuan dedup & heartbeat
  last_stored_at         timestamptz,
  installed_at           timestamptz,
  deleted_at             timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CHECK (threshold_critical_cm < threshold_warning_cm)
);

CREATE TABLE device_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id   text NOT NULL REFERENCES devices (id),
  token_hash  text NOT NULL UNIQUE,              -- sha256(token)
  token_last4 text NOT NULL,
  revoked_at  timestamptz,
  created_by  uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
-- maksimal satu token aktif per device
CREATE UNIQUE INDEX device_tokens_one_active ON device_tokens (device_id) WHERE revoked_at IS NULL;

-- ===== ingestion =====
-- Tabel biasa; primary key = index utama untuk query per device & rentang waktu, sekaligus dedup QoS 1.
-- F2: partisi bulanan (pg_partman) + agregat untuk retensi 2 tahun.
CREATE TABLE readings (
  device_id   text NOT NULL REFERENCES devices (id),
  channel     smallint NOT NULL DEFAULT 1 CHECK (channel BETWEEN 1 AND 5),  -- nomor sensor (device 3/5 sensor nanti)
  ts          timestamptz NOT NULL,
  level_cm    numeric(7,2) NOT NULL CHECK (level_cm >= 0),   -- jarak sensor → air, data mentah
  status      text NOT NULL CHECK (status IN ('normal', 'warning', 'critical')),
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (device_id, channel, ts)
);

-- ===== device-presence =====
CREATE TABLE device_status_events (
  id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  device_id text NOT NULL REFERENCES devices (id),
  online    boolean NOT NULL,
  reason    text NOT NULL CHECK (reason IN ('timeout', 'reading', 'lwt')),
  at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX device_status_events_device_at_idx ON device_status_events (device_id, at);

-- Skema saja (DV-13). Device sudah NTP; nanti untuk memantau drift jam.
CREATE TABLE device_time_sync (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  device_id  text NOT NULL REFERENCES devices (id),
  device_ts  timestamptz,
  server_ts  timestamptz,
  offset_ms  integer,
  method     text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ===== weather =====
CREATE TABLE weather_cache (
  cache_key  text PRIMARY KEY,
  payload    jsonb NOT NULL,
  fetched_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL
);

-- ===== worker =====
-- 1 baris per instance worker; dipakai /api/health karena api & worker terpisah.
CREATE TABLE worker_status (
  worker_id       text PRIMARY KEY,
  heartbeat_at    timestamptz NOT NULL,
  mqtt_connected  boolean NOT NULL,
  broker_url_host text,
  started_at      timestamptz
);
