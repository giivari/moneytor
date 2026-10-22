-- P4.2: original opening records remain immutable; corrections are append-only.
CREATE TABLE asset_opening_corrections (
  id uuid PRIMARY KEY,
  asset_id uuid NOT NULL REFERENCES asset_opening_states(asset_id) ON DELETE RESTRICT,
  previous_amount_minor bigint NOT NULL CHECK (previous_amount_minor >= 0),
  corrected_amount_minor bigint NOT NULL CHECK (corrected_amount_minor >= 0),
  note text CHECK (length(note) <= 1000),
  idempotency_key uuid NOT NULL UNIQUE,
  request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  correction_order bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (previous_amount_minor <> corrected_amount_minor)
);
CREATE INDEX asset_opening_corrections_latest ON asset_opening_corrections(asset_id, correction_order DESC);
CREATE TRIGGER asset_opening_corrections_no_rewrite BEFORE UPDATE OR DELETE ON asset_opening_corrections
  FOR EACH ROW EXECUTE FUNCTION reject_posted_finance_rewrite();

CREATE TABLE investment_opening_corrections (
  id uuid PRIMARY KEY,
  opening_id uuid NOT NULL REFERENCES investment_opening_positions(id) ON DELETE RESTRICT,
  previous_quantity numeric(48,18) NOT NULL CHECK (previous_quantity > 0 AND previous_quantity <> 'NaN'::numeric),
  corrected_quantity numeric(48,18) NOT NULL CHECK (corrected_quantity > 0 AND corrected_quantity <> 'NaN'::numeric),
  previous_cost_basis_minor bigint NOT NULL CHECK (previous_cost_basis_minor >= 0),
  corrected_cost_basis_minor bigint NOT NULL CHECK (corrected_cost_basis_minor >= 0),
  note text CHECK (length(note) <= 1000),
  idempotency_key uuid NOT NULL UNIQUE,
  request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  correction_order bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (previous_quantity <> corrected_quantity OR previous_cost_basis_minor <> corrected_cost_basis_minor)
);
CREATE INDEX investment_opening_corrections_latest ON investment_opening_corrections(opening_id, correction_order DESC);
CREATE TRIGGER investment_opening_corrections_no_rewrite BEFORE UPDATE OR DELETE ON investment_opening_corrections
  FOR EACH ROW EXECUTE FUNCTION reject_posted_finance_rewrite();
