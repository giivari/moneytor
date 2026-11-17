-- 024: one idempotent, append-only record per atomic receivable settlement (transfer + optional rounding adjustment). Additive only.

CREATE TABLE IF NOT EXISTS receivable_settlement_operations (
  idempotency_key uuid PRIMARY KEY,
  request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  receivable_asset_id uuid NOT NULL REFERENCES assets(id) ON DELETE RESTRICT,
  destination_asset_id uuid NOT NULL REFERENCES assets(id) ON DELETE RESTRICT,
  settlement_mode text NOT NULL CHECK (settlement_mode IN ('partial', 'close_with_adjustment')),
  transfer_activity_id uuid NOT NULL REFERENCES financial_activities(id) ON DELETE RESTRICT,
  adjustment_activity_id uuid REFERENCES financial_activities(id) ON DELETE RESTRICT,
  adjustment_kind text CHECK (adjustment_kind IN ('income', 'expense')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((adjustment_activity_id IS NULL) = (adjustment_kind IS NULL)),
  CHECK (receivable_asset_id <> destination_asset_id)
);
CREATE INDEX IF NOT EXISTS receivable_settlement_operations_receivable ON receivable_settlement_operations(receivable_asset_id, created_at);

DROP TRIGGER IF EXISTS receivable_settlement_operations_guard ON receivable_settlement_operations;
CREATE TRIGGER receivable_settlement_operations_guard BEFORE UPDATE OR DELETE ON receivable_settlement_operations
  FOR EACH ROW EXECUTE FUNCTION append_only_guard();
