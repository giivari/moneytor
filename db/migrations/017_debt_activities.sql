-- 017: activity kinds borrow, repay, refund, adjustment. Additive: every old row still satisfies the widened checks.
--   borrow     liability (source) funds another account (destination). Not income.
--   repay      principal moves to a liability account (not an expense); interest is a 'loan_interest' charge (an expense).
--   refund     money back for an earlier expense (refund_of_activity_id); reduces that expense's category, not income.
--   adjustment one side only (destination = increase, source = decrease); reason reconciliation | opening_debt.

ALTER TABLE financial_activities
  ADD COLUMN IF NOT EXISTS refund_of_activity_id uuid REFERENCES financial_activities(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS adjustment_reason text CHECK (adjustment_reason IN ('reconciliation', 'opening_debt'));

ALTER TABLE financial_activities DROP CONSTRAINT financial_activities_kind_check;
ALTER TABLE financial_activities ADD CONSTRAINT financial_activities_kind_check
  CHECK (kind IN ('income', 'expense', 'transfer', 'borrow', 'repay', 'refund', 'adjustment'));

ALTER TABLE financial_activities DROP CONSTRAINT activity_assets_by_kind;
ALTER TABLE financial_activities ADD CONSTRAINT activity_assets_by_kind CHECK (
  (kind = 'income' AND source_asset_id IS NULL AND destination_asset_id IS NOT NULL)
  OR (kind = 'expense' AND source_asset_id IS NOT NULL AND destination_asset_id IS NULL)
  OR (kind IN ('transfer', 'borrow', 'repay') AND source_asset_id IS NOT NULL AND destination_asset_id IS NOT NULL AND source_asset_id <> destination_asset_id)
  OR (kind = 'refund' AND source_asset_id IS NULL AND destination_asset_id IS NOT NULL)
  OR (kind = 'adjustment' AND (source_asset_id IS NULL) <> (destination_asset_id IS NULL))
);
ALTER TABLE financial_activities DROP CONSTRAINT activity_category_scope;
ALTER TABLE financial_activities ADD CONSTRAINT activity_category_scope CHECK (
  (category_id IS NULL AND category_kind IS NULL)
  OR (category_id IS NOT NULL AND category_kind IS NOT NULL AND category_kind = kind AND kind IN ('income', 'expense'))
  OR (category_id IS NOT NULL AND kind = 'refund' AND category_kind = 'expense')
);
ALTER TABLE financial_activities ADD CONSTRAINT activity_debt_shape CHECK (
  ((kind = 'refund') = (refund_of_activity_id IS NOT NULL))
  AND ((kind = 'adjustment') = (adjustment_reason IS NOT NULL))
  AND (adjustment_reason IS DISTINCT FROM 'opening_debt' OR source_asset_id IS NOT NULL)
);

ALTER TABLE activity_charges DROP CONSTRAINT activity_charges_activity_kind_check;
ALTER TABLE activity_charges ADD CONSTRAINT activity_charges_activity_kind_check CHECK (activity_kind IN ('expense', 'transfer', 'repay'));
CREATE UNIQUE INDEX IF NOT EXISTS one_repay_charge ON activity_charges(activity_id) WHERE activity_kind = 'repay';

INSERT INTO additional_charge_types (id, system_key, display_name, is_builtin)
VALUES ('60000000-0000-4000-8000-000000000007', 'loan_interest', 'Bunga pinjaman', true)
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION validate_debt_activity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  origin financial_activities%ROWTYPE;
  cap numeric; refunded numeric;
BEGIN
  IF NEW.kind = 'borrow' AND (SELECT asset_class FROM assets WHERE id = NEW.source_asset_id) IS DISTINCT FROM 'liability' THEN
    RAISE EXCEPTION 'borrow requires a liability source account';
  ELSIF NEW.kind = 'repay' AND (SELECT asset_class FROM assets WHERE id = NEW.destination_asset_id) IS DISTINCT FROM 'liability' THEN
    RAISE EXCEPTION 'repay requires a liability destination account';
  ELSIF NEW.kind = 'adjustment' AND NEW.adjustment_reason = 'opening_debt'
    AND (SELECT asset_class FROM assets WHERE id = NEW.source_asset_id) IS DISTINCT FROM 'liability' THEN
    RAISE EXCEPTION 'opening_debt requires a liability source account';
  ELSIF NEW.kind = 'refund' THEN
    SELECT * INTO origin FROM financial_activities WHERE id = NEW.refund_of_activity_id FOR UPDATE;
    IF NOT FOUND OR origin.kind <> 'expense' OR origin.status <> 'posted' THEN
      RAISE EXCEPTION 'refund must refer to a posted expense';
    END IF;
    IF origin.currency_code <> NEW.currency_code THEN RAISE EXCEPTION 'refund currency differs from the expense'; END IF;
    IF NEW.category_id IS DISTINCT FROM origin.category_id THEN RAISE EXCEPTION 'refund must use the category of the expense'; END IF;
    cap := origin.base_amount_minor + COALESCE((SELECT sum(amount_minor) FROM activity_charges WHERE activity_id = origin.id), 0);
    SELECT COALESCE(sum(base_amount_minor), 0) INTO refunded FROM financial_activities
      WHERE kind = 'refund' AND refund_of_activity_id = origin.id AND status = 'posted';
    IF refunded + NEW.base_amount_minor > cap THEN
      RAISE EXCEPTION 'refund exceeds the original expense (% already refunded of %)', refunded, cap;
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS validate_debt_activity ON financial_activities;
CREATE TRIGGER validate_debt_activity BEFORE INSERT ON financial_activities
  FOR EACH ROW EXECUTE FUNCTION validate_debt_activity();

-- An expense with live refunds cannot be voided or corrected; void the refunds first.
CREATE OR REPLACE FUNCTION guard_refunded_expense() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.kind = 'expense' AND OLD.status = 'posted' AND NEW.status <> 'posted'
    AND EXISTS (SELECT 1 FROM financial_activities WHERE kind = 'refund' AND refund_of_activity_id = OLD.id AND status = 'posted') THEN
    RAISE EXCEPTION 'expense still has refunds; void the refunds first';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS guard_refunded_expense ON financial_activities;
CREATE TRIGGER guard_refunded_expense BEFORE UPDATE OF status ON financial_activities
  FOR EACH ROW EXECUTE FUNCTION guard_refunded_expense();

-- Automation, recurring and imports still know only income/expense/transfer: the new kinds are not trigger sources.
CREATE OR REPLACE FUNCTION record_general_automation_source() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.replaces_activity_id IS NULL AND NEW.kind IN ('income', 'expense', 'transfer') THEN
    PERFORM pg_advisory_xact_lock(hashtext('moneytor_general_automation_order'));
    INSERT INTO automation_source_receipts(root_activity_id,eligible_at) VALUES(NEW.id,clock_timestamp());
  END IF;
  RETURN NEW;
END;
$$;
