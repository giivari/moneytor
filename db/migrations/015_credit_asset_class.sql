-- 015: explicit asset class (asset | liability | receivable) instead of name regexes, a credit installment
-- schedule table, and the "Bunga cicilan" charge type. Additive only: older application code ignores all of it.

ALTER TABLE assets ADD COLUMN IF NOT EXISTS asset_class text NOT NULL DEFAULT 'asset';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'assets_asset_class_check' AND conrelid = 'assets'::regclass) THEN
    ALTER TABLE assets ADD CONSTRAINT assets_asset_class_check CHECK (asset_class IN ('asset', 'liability', 'receivable'));
  END IF;
END $$;

-- Backfill from existing data, conservatively:
--   1. note starts with a [CREDIT...] tag (set by the credit toggle in the asset form)        -> liability
--   2. old credit name pattern AND negative balance AND at least one ledger movement          -> liability
--   3. old receivable name pattern                                                            -> receivable
--   4. everything else (including credit-like names with zero/positive balance or no movement) -> asset
-- Balance = latest opening correction (or opening) + all ledger movements, as the application computes it.
-- Every classification is reported with RAISE NOTICE so the owner can review it before deploying.
DO $$
DECLARE
  r record;
  v_class text;
  v_rule text;
  credit_re constant text := '(spaylater|shopee\s*pay\s*later|gopay\s*later|pay\s*later|paylater|\y(kredivo|akulaku|indodana|atome|home\s*credit|kartu\s+kredit|credit\s+card|fasilitas\s+kredit|pinjaman|cicilan|kta|kredit)\y)';
  receivable_re constant text := '\y(piutang|talangan|reimburse|split\s*bill)\y';
BEGIN
  FOR r IN
    SELECT a.id, a.display_name, a.note,
      concat_ws(' ', a.display_name, p.display_name, t.display_name, g.display_name) AS names,
      COALESCE((SELECT c.corrected_amount_minor FROM asset_opening_corrections c WHERE c.asset_id = a.id ORDER BY c.correction_order DESC LIMIT 1),
        o.amount_minor, 0)::numeric + COALESCE((SELECT sum(m.amount_minor) FROM ledger_movements m WHERE m.asset_id = a.id), 0) AS balance,
      EXISTS (SELECT 1 FROM ledger_movements m WHERE m.asset_id = a.id) AS has_movement
    FROM assets a
    LEFT JOIN asset_opening_states o ON o.asset_id = a.id
    JOIN asset_types t ON t.id = a.asset_type_id
    LEFT JOIN asset_groups g ON g.id = a.asset_group_id
    LEFT JOIN financial_providers p ON p.id = a.provider_id
    ORDER BY a.created_at, a.id
  LOOP
    IF regexp_replace(COALESCE(r.note, ''), '^\s+', '') ~* '^\[CREDIT(:[^\]]*)?\]' THEN
      v_class := 'liability'; v_rule := 'tag [CREDIT]';
    ELSIF r.names ~* credit_re AND r.balance < 0 AND r.has_movement THEN
      v_class := 'liability'; v_rule := 'nama kredit, saldo negatif, ada movement';
    ELSIF (r.display_name || ' ' || COALESCE(r.note, '')) ~* receivable_re THEN
      v_class := 'receivable'; v_rule := 'nama piutang';
    ELSIF r.names ~* credit_re THEN
      v_class := 'asset'; v_rule := 'nama kredit, saldo >= 0 atau tanpa movement';
    ELSE
      v_class := 'asset'; v_rule := 'bawaan';
    END IF;
    UPDATE assets SET asset_class = v_class WHERE id = r.id;
    RAISE NOTICE 'asset_class % "%" -> % (%; saldo %)', r.id, r.display_name, v_class, v_rule, r.balance;
  END LOOP;
END $$;

-- One row per month of an installment purchase. The purchase itself (principal + interest) is in the ledger;
-- these rows only say which due month each part is billed in. Paid/overdue state is derived from the balance.
CREATE TABLE IF NOT EXISTS credit_installments (
  id uuid PRIMARY KEY,
  asset_id uuid NOT NULL,
  currency_code text NOT NULL,
  activity_id uuid NOT NULL REFERENCES financial_activities(id) ON DELETE RESTRICT,
  seq integer NOT NULL CHECK (seq BETWEEN 1 AND 360),
  due_period date NOT NULL CHECK (extract(day FROM due_period) = 1),
  principal_minor bigint NOT NULL CHECK (principal_minor >= 0),
  interest_minor bigint NOT NULL CHECK (interest_minor >= 0),
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'cancelled')),
  cancelled_by_activity_id uuid REFERENCES financial_activities(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (activity_id, seq),
  FOREIGN KEY (asset_id, currency_code) REFERENCES assets(id, currency_code) ON DELETE RESTRICT,
  CHECK (principal_minor + interest_minor > 0),
  CHECK ((status = 'cancelled') = (cancelled_by_activity_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS credit_installments_open ON credit_installments(asset_id, due_period) WHERE status = 'scheduled';

-- Rows are never deleted or rewritten; the only change allowed is scheduled -> cancelled.
CREATE OR REPLACE FUNCTION credit_installments_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'credit_installments is append-only';
  END IF;
  IF OLD.status <> 'scheduled' OR NEW.status <> 'cancelled'
    OR (NEW.id, NEW.asset_id, NEW.currency_code, NEW.activity_id, NEW.seq, NEW.due_period, NEW.principal_minor, NEW.interest_minor, NEW.created_at)
      IS DISTINCT FROM (OLD.id, OLD.asset_id, OLD.currency_code, OLD.activity_id, OLD.seq, OLD.due_period, OLD.principal_minor, OLD.interest_minor, OLD.created_at) THEN
    RAISE EXCEPTION 'credit_installments only allows scheduled -> cancelled';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS credit_installments_guard ON credit_installments;
CREATE TRIGGER credit_installments_guard BEFORE UPDATE OR DELETE ON credit_installments
  FOR EACH ROW EXECUTE FUNCTION credit_installments_guard();

INSERT INTO additional_charge_types (id, system_key, display_name, is_builtin)
VALUES ('60000000-0000-4000-8000-000000000006', 'installment_interest', 'Bunga cicilan', true)
ON CONFLICT DO NOTHING;
