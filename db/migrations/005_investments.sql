-- P4. Portfolios contain positions, never a second cash balance.
CREATE TABLE investment_instrument_types (
  id uuid PRIMARY KEY, system_key text UNIQUE,
  display_name text NOT NULL CHECK (length(btrim(display_name)) BETWEEN 1 AND 120),
  is_builtin boolean NOT NULL DEFAULT false, is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (is_builtin = (system_key IS NOT NULL))
);
INSERT INTO investment_instrument_types (id,system_key,display_name,is_builtin) VALUES
 ('70000000-0000-4000-8000-000000000001','stock','Saham',true),
 ('70000000-0000-4000-8000-000000000002','etf','ETF',true),
 ('70000000-0000-4000-8000-000000000003','fund','Reksa dana',true),
 ('70000000-0000-4000-8000-000000000004','bond','Obligasi',true),
 ('70000000-0000-4000-8000-000000000005','crypto','Kripto',true);
CREATE TABLE investment_portfolios (
  id uuid PRIMARY KEY, display_name text NOT NULL CHECK (length(btrim(display_name)) BETWEEN 1 AND 120),
  provider_id uuid REFERENCES financial_providers(id),
  currency_code text NOT NULL REFERENCES currencies(code),
  note text CHECK (length(note) <= 1000), is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (id,currency_code)
);
CREATE TABLE investment_instruments (
  id uuid PRIMARY KEY, display_name text NOT NULL CHECK (length(btrim(display_name)) BETWEEN 1 AND 120),
  symbol text CHECK (length(symbol) BETWEEN 1 AND 80), market text CHECK (length(market) BETWEEN 1 AND 80),
  instrument_type_id uuid NOT NULL REFERENCES investment_instrument_types(id),
  currency_code text NOT NULL REFERENCES currencies(code),
  price_symbol text CHECK (length(price_symbol) BETWEEN 1 AND 120),
  is_active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (id,currency_code)
);
CREATE TABLE investment_opening_positions (
  id uuid PRIMARY KEY, portfolio_id uuid NOT NULL, instrument_id uuid NOT NULL, currency_code text NOT NULL,
  quantity numeric(48,18) NOT NULL CHECK (quantity > 0 AND quantity <> 'NaN'::numeric),
  cost_basis_minor bigint NOT NULL CHECK (cost_basis_minor >= 0), occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (portfolio_id,instrument_id),
  FOREIGN KEY (portfolio_id,currency_code) REFERENCES investment_portfolios(id,currency_code),
  FOREIGN KEY (instrument_id,currency_code) REFERENCES investment_instruments(id,currency_code)
);
CREATE TABLE investment_transactions (
  id uuid PRIMARY KEY, portfolio_id uuid NOT NULL, instrument_id uuid NOT NULL, currency_code text NOT NULL,
  cash_asset_id uuid NOT NULL, kind text NOT NULL CHECK (kind IN ('buy','sell')),
  quantity numeric(48,18) NOT NULL CHECK (quantity > 0 AND quantity <> 'NaN'::numeric),
  unit_price numeric(48,18) NOT NULL CHECK (unit_price > 0 AND unit_price <> 'NaN'::numeric),
  gross_minor bigint NOT NULL CHECK (gross_minor > 0), occurred_at timestamptz NOT NULL,
  event_order bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
  chronology_order bigint, status text NOT NULL DEFAULT 'posted' CHECK (status IN ('posted','voided','superseded')),
  replaces_id uuid UNIQUE REFERENCES investment_transactions(id), voided_at timestamptz,
  note text CHECK (length(note) <= 1000), created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id,currency_code),
  FOREIGN KEY (portfolio_id,currency_code) REFERENCES investment_portfolios(id,currency_code),
  FOREIGN KEY (instrument_id,currency_code) REFERENCES investment_instruments(id,currency_code),
  FOREIGN KEY (cash_asset_id,currency_code) REFERENCES assets(id,currency_code),
  CHECK ((replaces_id IS NOT NULL) = (chronology_order IS NOT NULL))
);
CREATE INDEX investment_chronology_idx ON investment_transactions(portfolio_id,instrument_id,occurred_at,event_order);
CREATE TABLE investment_trade_fees (
  id uuid PRIMARY KEY, transaction_id uuid NOT NULL UNIQUE REFERENCES investment_transactions(id),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0), UNIQUE (id,transaction_id)
);
CREATE TABLE investment_price_points (
  id uuid PRIMARY KEY, instrument_id uuid NOT NULL, currency_code text NOT NULL,
  price numeric(48,18) NOT NULL CHECK (price > 0 AND price <> 'NaN'::numeric),
  as_of timestamptz NOT NULL, source_type text NOT NULL CHECK (source_type IN ('manual','provider')),
  source_id text CHECK (length(source_id) BETWEEN 1 AND 120), inserted_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (instrument_id,currency_code) REFERENCES investment_instruments(id,currency_code),
  CHECK ((source_type='provider') = (source_id IS NOT NULL))
);
CREATE INDEX investment_price_latest_idx ON investment_price_points(instrument_id,as_of DESC,inserted_at DESC,id);
CREATE TABLE investment_operations (
  idempotency_key uuid PRIMARY KEY, operation text NOT NULL CHECK (operation IN ('opening','trade','replace','void','price')),
  request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  opening_id uuid REFERENCES investment_opening_positions(id), transaction_id uuid REFERENCES investment_transactions(id),
  price_id uuid REFERENCES investment_price_points(id), created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(opening_id,transaction_id,price_id)=1),
  CHECK ((operation='opening' AND opening_id IS NOT NULL) OR (operation='price' AND price_id IS NOT NULL)
    OR (operation IN ('trade','replace','void') AND transaction_id IS NOT NULL))
);
-- Exactly one supported owner of each cash movement. Historical P3 rows remain valid.
ALTER TABLE ledger_movements ALTER COLUMN activity_id DROP NOT NULL;
ALTER TABLE ledger_movements ADD COLUMN investment_transaction_id uuid, ADD COLUMN investment_fee_id uuid;
ALTER TABLE ledger_movements ADD FOREIGN KEY (investment_transaction_id,currency_code) REFERENCES investment_transactions(id,currency_code);
ALTER TABLE ledger_movements ADD FOREIGN KEY (investment_fee_id,investment_transaction_id) REFERENCES investment_trade_fees(id,transaction_id);
ALTER TABLE ledger_movements DROP CONSTRAINT ledger_movements_component_check;
ALTER TABLE ledger_movements ADD CONSTRAINT ledger_movements_component_check
 CHECK (component IN ('principal','charge','investment_principal','investment_fee','reversal'));
ALTER TABLE ledger_movements ADD CONSTRAINT ledger_exactly_one_source CHECK (num_nonnulls(activity_id,investment_transaction_id)=1);
ALTER TABLE ledger_movements ADD CONSTRAINT investment_fee_reference CHECK ((component='investment_fee')=(investment_fee_id IS NOT NULL));
ALTER TABLE ledger_movements ADD CONSTRAINT ledger_source_component CHECK (
 (activity_id IS NOT NULL AND component IN ('principal','charge','reversal') AND investment_fee_id IS NULL)
 OR (investment_transaction_id IS NOT NULL AND component IN ('investment_principal','investment_fee','reversal') AND charge_id IS NULL)
);
CREATE UNIQUE INDEX one_investment_principal ON ledger_movements(investment_transaction_id) WHERE component='investment_principal';
CREATE UNIQUE INDEX one_investment_fee_movement ON ledger_movements(investment_fee_id) WHERE investment_fee_id IS NOT NULL;
CREATE INDEX investment_cash_source_idx ON ledger_movements(investment_transaction_id);
CREATE OR REPLACE FUNCTION enforce_ledger_reversal() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE original ledger_movements%ROWTYPE;
BEGIN
 IF NEW.component='reversal' THEN
  SELECT * INTO original FROM ledger_movements WHERE id=NEW.reverses_movement_id;
  IF original.id IS NULL OR original.component='reversal'
   OR NEW.activity_id IS DISTINCT FROM original.activity_id
   OR NEW.investment_transaction_id IS DISTINCT FROM original.investment_transaction_id
   OR NEW.asset_id <> original.asset_id OR NEW.currency_code <> original.currency_code
   OR NEW.amount_minor::numeric <> -original.amount_minor::numeric
   OR NEW.charge_id IS NOT NULL OR NEW.investment_fee_id IS NOT NULL THEN
   RAISE EXCEPTION 'Invalid ledger reversal';
  END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER investment_opening_no_rewrite BEFORE UPDATE OR DELETE ON investment_opening_positions FOR EACH ROW EXECUTE FUNCTION reject_posted_finance_rewrite();
CREATE TRIGGER investment_fees_no_rewrite BEFORE UPDATE OR DELETE ON investment_trade_fees FOR EACH ROW EXECUTE FUNCTION reject_posted_finance_rewrite();
CREATE TRIGGER investment_prices_no_rewrite BEFORE UPDATE OR DELETE ON investment_price_points FOR EACH ROW EXECUTE FUNCTION reject_posted_finance_rewrite();
CREATE FUNCTION protect_investment_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Investment history is append-only'; END IF;
 IF (to_jsonb(NEW)-'status'-'voided_at') IS DISTINCT FROM (to_jsonb(OLD)-'status'-'voided_at')
  OR OLD.status <> 'posted' OR NEW.status NOT IN ('voided','superseded') OR NEW.voided_at IS NULL THEN
  RAISE EXCEPTION 'Investment history is append-only';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER investment_history_protected BEFORE UPDATE OR DELETE ON investment_transactions FOR EACH ROW EXECUTE FUNCTION protect_investment_history();
CREATE TRIGGER portfolio_currency_immutable BEFORE UPDATE OF currency_code ON investment_portfolios FOR EACH ROW EXECUTE FUNCTION reject_asset_currency_change();
CREATE TRIGGER instrument_currency_immutable BEFORE UPDATE OF currency_code ON investment_instruments FOR EACH ROW EXECUTE FUNCTION reject_asset_currency_change();
