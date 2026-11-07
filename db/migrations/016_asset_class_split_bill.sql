-- 016: audit of asset_class changes and one idempotent record per atomic split bill. Additive only.
-- Both tables are append-only; the application writes them inside the same transaction as the change they describe.

CREATE TABLE IF NOT EXISTS asset_class_changes (
  id uuid PRIMARY KEY,
  idempotency_key uuid NOT NULL UNIQUE,
  asset_id uuid NOT NULL REFERENCES assets(id) ON DELETE RESTRICT,
  previous_class text NOT NULL CHECK (previous_class IN ('asset', 'liability', 'receivable')),
  new_class text NOT NULL CHECK (new_class IN ('asset', 'liability', 'receivable')),
  request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (previous_class <> new_class)
);
CREATE INDEX IF NOT EXISTS asset_class_changes_asset ON asset_class_changes(asset_id, created_at);

CREATE TABLE IF NOT EXISTS split_bill_operations (
  idempotency_key uuid PRIMARY KEY,
  request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  personal_activity_id uuid REFERENCES financial_activities(id) ON DELETE RESTRICT,
  transfer_activity_id uuid NOT NULL REFERENCES financial_activities(id) ON DELETE RESTRICT,
  receivable_asset_id uuid NOT NULL REFERENCES assets(id) ON DELETE RESTRICT,
  receivable_created boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION append_only_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END $$;
DROP TRIGGER IF EXISTS asset_class_changes_guard ON asset_class_changes;
CREATE TRIGGER asset_class_changes_guard BEFORE UPDATE OR DELETE ON asset_class_changes
  FOR EACH ROW EXECUTE FUNCTION append_only_guard();
DROP TRIGGER IF EXISTS split_bill_operations_guard ON split_bill_operations;
CREATE TRIGGER split_bill_operations_guard BEFORE UPDATE OR DELETE ON split_bill_operations
  FOR EACH ROW EXECUTE FUNCTION append_only_guard();
