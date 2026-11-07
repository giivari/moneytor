-- 020: one definition of spending for every report, refunds that follow an edited expense, and removal of the demo catalog
-- entries from 002 that nothing references (replaces the DML that listCatalog used to run on every read).
--
-- Spending = principal of an expense + every charge (expense charges, transfer fees, loan interest) - refunds.
-- A credit-card or installment purchase is a full expense on the purchase date; paying the card bill is a transfer (not spending);
-- installment interest is a charge. Borrowed principal, repaid principal, transfers and adjustments are never spending.
-- A refund counts on its own date, against the account and category of the CURRENT posted version of the expense it refunds.

-- Demo providers/networks nobody references (idempotent; referenced ones stay).
DELETE FROM financial_providers fp
WHERE fp.system_key IN ('demo_bank', 'demo_wallet', 'demo_investment')
  AND NOT EXISTS (SELECT 1 FROM assets a WHERE a.provider_id = fp.id)
  AND NOT EXISTS (SELECT 1 FROM investment_portfolios ip WHERE ip.provider_id = fp.id);
DELETE FROM payment_networks pn
WHERE pn.system_key = 'demo_network'
  AND NOT EXISTS (SELECT 1 FROM assets a WHERE a.payment_network_id = pn.id);

-- Every version of an expense (via replaces_activity_id) mapped to the version that is posted now.
CREATE OR REPLACE VIEW expense_versions AS
WITH RECURSIVE v(version_id, current_id) AS (
  SELECT id, id FROM financial_activities WHERE kind = 'expense' AND status = 'posted'
  UNION ALL
  SELECT f.replaces_activity_id, v.current_id
  FROM v JOIN financial_activities f ON f.id = v.version_id
  WHERE f.replaces_activity_id IS NOT NULL
)
SELECT version_id, current_id FROM v;

-- Same rows as financial_activities, but a refund shows the paying account and category of the current expense version.
CREATE OR REPLACE VIEW financial_activities_effective AS
SELECT f.id, f.kind, f.base_amount_minor, f.currency_code,
  CASE WHEN f.kind = 'refund' THEN o.source_asset_id ELSE f.source_asset_id END AS source_asset_id,
  f.destination_asset_id,
  CASE WHEN f.kind = 'refund' THEN o.category_id ELSE f.category_id END AS category_id,
  f.category_kind, f.occurred_at, f.note, f.created_at, f.status, f.replaces_activity_id, f.voided_at,
  f.refund_of_activity_id, f.adjustment_reason
FROM financial_activities f
LEFT JOIN expense_versions ev ON f.kind = 'refund' AND ev.version_id = f.refund_of_activity_id
LEFT JOIN financial_activities o ON o.id = ev.current_id;

CREATE OR REPLACE VIEW spending_effects AS
SELECT f.id AS activity_id, f.kind, 'principal'::text AS effect, f.source_asset_id AS asset_id, f.category_id,
  f.occurred_at, f.currency_code, f.base_amount_minor::numeric AS amount_minor
FROM financial_activities f WHERE f.status = 'posted' AND f.kind = 'expense'
UNION ALL
SELECT f.id, f.kind, 'charge', f.source_asset_id, CASE WHEN f.kind = 'expense' THEN f.category_id END,
  f.occurred_at, f.currency_code, ac.amount_minor::numeric
FROM activity_charges ac JOIN financial_activities f ON f.id = ac.activity_id WHERE f.status = 'posted'
UNION ALL
SELECT e.id, e.kind, 'refund', e.source_asset_id, e.category_id, e.occurred_at, e.currency_code, -e.base_amount_minor::numeric
FROM financial_activities_effective e WHERE e.kind = 'refund' AND e.status = 'posted';

-- Refunds follow the edit chain: validation resolves the refunded expense to its current version, and an edit or void of an
-- expense is checked against everything already refunded anywhere in its chain.
CREATE OR REPLACE FUNCTION refunded_in_chain(from_id uuid) RETURNS numeric LANGUAGE sql STABLE AS $$
  WITH RECURSIVE up(id) AS (
    SELECT from_id
    UNION ALL
    SELECT f.replaces_activity_id FROM up JOIN financial_activities f ON f.id = up.id WHERE f.replaces_activity_id IS NOT NULL
  )
  SELECT COALESCE(sum(r.base_amount_minor), 0)
  FROM financial_activities r
  WHERE r.kind = 'refund' AND r.status = 'posted' AND r.refund_of_activity_id IN (SELECT id FROM up);
$$;

CREATE OR REPLACE FUNCTION validate_debt_activity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  origin financial_activities%ROWTYPE;
  current_id uuid;
  cap numeric;
BEGIN
  IF NEW.kind = 'borrow' AND (SELECT asset_class FROM assets WHERE id = NEW.source_asset_id) IS DISTINCT FROM 'liability' THEN
    RAISE EXCEPTION 'borrow requires a liability source account';
  ELSIF NEW.kind = 'repay' AND (SELECT asset_class FROM assets WHERE id = NEW.destination_asset_id) IS DISTINCT FROM 'liability' THEN
    RAISE EXCEPTION 'repay requires a liability destination account';
  ELSIF NEW.kind = 'adjustment' AND NEW.adjustment_reason = 'opening_debt'
    AND (SELECT asset_class FROM assets WHERE id = NEW.source_asset_id) IS DISTINCT FROM 'liability' THEN
    RAISE EXCEPTION 'opening_debt requires a liability source account';
  ELSIF NEW.kind = 'refund' THEN
    SELECT ev.current_id INTO current_id FROM expense_versions ev WHERE ev.version_id = NEW.refund_of_activity_id;
    IF current_id IS NULL THEN RAISE EXCEPTION 'refund must refer to a posted expense'; END IF;
    SELECT * INTO origin FROM financial_activities WHERE id = current_id FOR UPDATE;
    IF origin.currency_code <> NEW.currency_code THEN RAISE EXCEPTION 'refund currency differs from the expense'; END IF;
    IF NEW.category_id IS DISTINCT FROM origin.category_id THEN RAISE EXCEPTION 'refund must use the category of the expense'; END IF;
    cap := origin.base_amount_minor + COALESCE((SELECT sum(amount_minor) FROM activity_charges WHERE activity_id = origin.id), 0);
    IF refunded_in_chain(origin.id) + NEW.base_amount_minor > cap THEN
      RAISE EXCEPTION 'refund exceeds the original expense (% already refunded of %)', refunded_in_chain(origin.id), cap;
    END IF;
  ELSIF NEW.kind = 'expense' AND NEW.replaces_activity_id IS NOT NULL THEN
    -- Charges are inserted after the row, so an edit is checked against the principal only (conservative).
    IF refunded_in_chain(NEW.replaces_activity_id) > NEW.base_amount_minor THEN
      RAISE EXCEPTION 'expense edit is below what was already refunded (refund) %', refunded_in_chain(NEW.replaces_activity_id);
    END IF;
  END IF;
  RETURN NEW;
END $$;

-- Editing (superseding) an expense with refunds is allowed; voiding it is not until the refunds are voided.
CREATE OR REPLACE FUNCTION guard_refunded_expense() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.kind = 'expense' AND OLD.status = 'posted' AND NEW.status = 'voided' AND refunded_in_chain(OLD.id) > 0 THEN
    RAISE EXCEPTION 'expense still has refunds; void the refunds first';
  END IF;
  RETURN NEW;
END $$;
