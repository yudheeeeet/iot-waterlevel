-- 0002_device_sensor_height: tinggi sensor dari dasar air (substrate), diisi admin lewat Edit Device.
-- Kedalaman air = sensor_height_cm - jarak sensor ke air; dihitung saat ditampilkan (popup peta), tidak disimpan.
-- NULL = belum diisi (kedalaman tidak ditampilkan). Satuan cm, sama dengan bacaan sensor.

ALTER TABLE devices
  ADD COLUMN sensor_height_cm numeric(7,2)
    CHECK (sensor_height_cm IS NULL OR (sensor_height_cm > 0 AND sensor_height_cm <= 2000));
