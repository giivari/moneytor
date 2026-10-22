-- P3: append-only reversals, correction lineage, and atomic request replay protection.
ALTER TABLE financial_activities
  ADD COLUMN status text NOT NULL DEFAULT 'posted' CHECK (status IN ('posted', 'voided', 'superseded')),
  ADD COLUMN replaces_activity_id uuid UNIQUE REFERENCES financial_activities(id) ON DELETE RESTRICT,
  ADD COLUMN voided_at timestamptz;

ALTER TABLE ledger_movements DROP CONSTRAINT ledger_movements_component_check;
ALTER TABLE ledger_movements ADD CONSTRAINT ledger_movements_component_check
  CHECK (component IN ('principal', 'charge', 'reversal'));
ALTER TABLE ledger_movements
  ADD COLUMN reverses_movement_id uuid UNIQUE REFERENCES ledger_movements(id) ON DELETE RESTRICT;
ALTER TABLE ledger_movements ADD CONSTRAINT movement_reversal_shape
  CHECK ((component = 'reversal') = (reverses_movement_id IS NOT NULL));

CREATE TABLE finance_operations (
  idempotency_key uuid PRIMARY KEY,
  operation text NOT NULL CHECK (operation IN ('post', 'replace', 'void')),
  request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  result_activity_id uuid NOT NULL REFERENCES financial_activities(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX financial_activities_status_occurred_idx
  ON financial_activities(status, occurred_at DESC);

-- Reversal rows must exactly negate a movement of the same activity, asset and currency.
CREATE FUNCTION enforce_ledger_reversal() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE original ledger_movements%ROWTYPE;
BEGIN
  IF NEW.component = 'reversal' THEN
    SELECT * INTO original FROM ledger_movements WHERE id = NEW.reverses_movement_id;
    IF original.id IS NULL OR NEW.activity_id <> original.activity_id
      OR NEW.asset_id <> original.asset_id OR NEW.currency_code <> original.currency_code
      OR NEW.amount_minor <> -original.amount_minor OR NEW.charge_id IS NOT NULL THEN
      RAISE EXCEPTION 'Invalid ledger reversal';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER ledger_reversal_valid BEFORE INSERT ON ledger_movements
  FOR EACH ROW EXECUTE FUNCTION enforce_ledger_reversal();

CREATE FUNCTION reject_posted_finance_rewrite() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Posted finance history is append-only';
END;
$$;
CREATE TRIGGER ledger_no_rewrite BEFORE UPDATE OR DELETE ON ledger_movements
  FOR EACH ROW EXECUTE FUNCTION reject_posted_finance_rewrite();
CREATE TRIGGER charges_no_rewrite BEFORE UPDATE OR DELETE ON activity_charges
  FOR EACH ROW EXECUTE FUNCTION reject_posted_finance_rewrite();
