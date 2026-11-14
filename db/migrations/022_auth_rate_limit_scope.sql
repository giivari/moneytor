-- Rate limit login: bucket per klien (HMAC IP dengan garam harian, IP mentah tidak disimpan) dan hanya kegagalan yang dihitung.
-- Bucket sesi aktif terpisah agar pihak luar tidak bisa menghabiskan jatah pemilik.
DELETE FROM auth_rate_limits;
ALTER TABLE auth_rate_limits DROP CONSTRAINT auth_rate_limits_bucket_check;
ALTER TABLE auth_rate_limits ADD CONSTRAINT auth_rate_limits_bucket_check
  CHECK (bucket ~ '^(bootstrap|login|recovery|security|session):[0-9a-f]{32}$');
CREATE TABLE auth_rate_salts (
  day date PRIMARY KEY,
  salt bytea NOT NULL CHECK (octet_length(salt) = 32)
);
