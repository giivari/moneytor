-- Idempotensi pembuatan aset: kunci yang sama mengembalikan aset yang sama, sehingga kirim ganda tidak menggandakan saldo awal.
CREATE TABLE asset_create_requests (
  idempotency_key uuid PRIMARY KEY,
  request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  asset_id uuid NOT NULL REFERENCES assets(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);
