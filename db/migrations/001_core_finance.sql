-- P1: single-owner catalogs, assets, opening state, activities, and signed movements.
-- Amounts are exact integer minor units. A row never converts between currencies.

CREATE TABLE currencies (
  code text PRIMARY KEY CHECK (code ~ '^[A-Z]{3}$'),
  display_name text NOT NULL CHECK (length(btrim(display_name)) BETWEEN 1 AND 120),
  minor_unit_exponent smallint NOT NULL CHECK (minor_unit_exponent BETWEEN 0 AND 9),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE financial_providers (
  id uuid PRIMARY KEY,
  system_key text UNIQUE,
  display_name text NOT NULL CHECK (length(btrim(display_name)) BETWEEN 1 AND 120),
  classification_name text CHECK (classification_name IS NULL OR length(btrim(classification_name)) BETWEEN 1 AND 120),
  logo_path text,
  brand_color text CHECK (brand_color IS NULL OR brand_color ~ '^#[0-9A-Fa-f]{6}$'),
  is_builtin boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT provider_key_shape CHECK (system_key IS NULL OR (length(system_key) <= 80 AND system_key ~ '^[a-z][a-z0-9_]*$')),
  CONSTRAINT provider_builtin_key CHECK (is_builtin = (system_key IS NOT NULL))
);

CREATE TABLE payment_networks (
  id uuid PRIMARY KEY,
  system_key text UNIQUE,
  display_name text NOT NULL CHECK (length(btrim(display_name)) BETWEEN 1 AND 120),
  is_builtin boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT network_key_shape CHECK (system_key IS NULL OR (length(system_key) <= 80 AND system_key ~ '^[a-z][a-z0-9_]*$')),
  CONSTRAINT network_builtin_key CHECK (is_builtin = (system_key IS NOT NULL))
);

CREATE TABLE asset_types (
  id uuid PRIMARY KEY,
  system_key text UNIQUE,
  display_name text NOT NULL CHECK (length(btrim(display_name)) BETWEEN 1 AND 120),
  is_builtin boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT asset_type_key_shape CHECK (system_key IS NULL OR (length(system_key) <= 80 AND system_key ~ '^[a-z][a-z0-9_]*$')),
  CONSTRAINT asset_type_builtin_key CHECK (is_builtin = (system_key IS NOT NULL))
);

CREATE TABLE asset_groups (
  id uuid PRIMARY KEY,
  system_key text UNIQUE,
  display_name text NOT NULL CHECK (length(btrim(display_name)) BETWEEN 1 AND 120),
  is_builtin boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT asset_group_key_shape CHECK (system_key IS NULL OR (length(system_key) <= 80 AND system_key ~ '^[a-z][a-z0-9_]*$')),
  CONSTRAINT asset_group_builtin_key CHECK (is_builtin = (system_key IS NOT NULL))
);

CREATE TABLE transaction_categories (
  id uuid PRIMARY KEY,
  system_key text UNIQUE,
  display_name text NOT NULL CHECK (length(btrim(display_name)) BETWEEN 1 AND 120),
  applies_to text NOT NULL CHECK (applies_to IN ('income', 'expense')),
  is_builtin boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, applies_to),
  CONSTRAINT category_key_shape CHECK (system_key IS NULL OR (length(system_key) <= 80 AND system_key ~ '^[a-z][a-z0-9_]*$')),
  CONSTRAINT category_builtin_key CHECK (is_builtin = (system_key IS NOT NULL))
);

CREATE TABLE additional_charge_types (
  id uuid PRIMARY KEY,
  system_key text UNIQUE,
  display_name text NOT NULL CHECK (length(btrim(display_name)) BETWEEN 1 AND 120),
  is_builtin boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT charge_type_key_shape CHECK (system_key IS NULL OR (length(system_key) <= 80 AND system_key ~ '^[a-z][a-z0-9_]*$')),
  CONSTRAINT charge_type_builtin_key CHECK (is_builtin = (system_key IS NOT NULL))
);

CREATE TABLE assets (
  id uuid PRIMARY KEY,
  display_name text NOT NULL CHECK (length(btrim(display_name)) BETWEEN 1 AND 120),
  provider_id uuid REFERENCES financial_providers(id) ON DELETE RESTRICT,
  asset_type_id uuid NOT NULL REFERENCES asset_types(id) ON DELETE RESTRICT,
  asset_group_id uuid REFERENCES asset_groups(id) ON DELETE RESTRICT,
  payment_network_id uuid REFERENCES payment_networks(id) ON DELETE RESTRICT,
  currency_code text NOT NULL REFERENCES currencies(code) ON DELETE RESTRICT,
  normally_liquid boolean NOT NULL DEFAULT false,
  normally_spendable boolean NOT NULL DEFAULT false,
  safe_suffix text CHECK (safe_suffix IS NULL OR safe_suffix ~ '^[A-Za-z0-9]{1,4}$'),
  note text CHECK (note IS NULL OR length(note) <= 1000),
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, currency_code),
  CONSTRAINT spendable_implies_liquid CHECK (NOT normally_spendable OR normally_liquid)
);

-- One immutable opening snapshot per asset. No mutable assets.balance column exists.
CREATE TABLE asset_opening_states (
  asset_id uuid PRIMARY KEY REFERENCES assets(id) ON DELETE RESTRICT,
  amount_minor bigint NOT NULL CHECK (amount_minor >= 0),
  effective_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- The user-visible activity is distinct from the signed movements it creates.
CREATE TABLE financial_activities (
  id uuid PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('income', 'expense', 'transfer')),
  base_amount_minor bigint NOT NULL CHECK (base_amount_minor > 0),
  currency_code text NOT NULL REFERENCES currencies(code) ON DELETE RESTRICT,
  source_asset_id uuid,
  destination_asset_id uuid,
  category_id uuid,
  category_kind text,
  occurred_at timestamptz NOT NULL,
  note text CHECK (note IS NULL OR length(note) <= 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, kind),
  UNIQUE (id, currency_code),
  FOREIGN KEY (source_asset_id, currency_code) REFERENCES assets(id, currency_code) ON DELETE RESTRICT,
  FOREIGN KEY (destination_asset_id, currency_code) REFERENCES assets(id, currency_code) ON DELETE RESTRICT,
  FOREIGN KEY (category_id, category_kind) REFERENCES transaction_categories(id, applies_to) ON DELETE RESTRICT,
  CONSTRAINT activity_assets_by_kind CHECK (
    (kind = 'income' AND source_asset_id IS NULL AND destination_asset_id IS NOT NULL)
    OR (kind = 'expense' AND source_asset_id IS NOT NULL AND destination_asset_id IS NULL)
    OR (kind = 'transfer' AND source_asset_id IS NOT NULL AND destination_asset_id IS NOT NULL AND source_asset_id <> destination_asset_id)
  ),
  CONSTRAINT activity_category_scope CHECK (
    (category_id IS NULL AND category_kind IS NULL)
    OR (category_id IS NOT NULL AND category_kind IS NOT NULL AND category_kind = kind AND kind IN ('income', 'expense'))
  )
);

CREATE TABLE activity_charges (
  id uuid PRIMARY KEY,
  activity_id uuid NOT NULL,
  activity_kind text NOT NULL CHECK (activity_kind IN ('expense', 'transfer')),
  charge_type_id uuid NOT NULL REFERENCES additional_charge_types(id) ON DELETE RESTRICT,
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, activity_id),
  FOREIGN KEY (activity_id, activity_kind) REFERENCES financial_activities(id, kind) ON DELETE RESTRICT
);

-- P1 has one optional fee for a transfer; expense activities can have many charges.
CREATE UNIQUE INDEX one_transfer_charge ON activity_charges(activity_id) WHERE activity_kind = 'transfer';

CREATE TABLE ledger_movements (
  id uuid PRIMARY KEY,
  activity_id uuid NOT NULL,
  asset_id uuid NOT NULL,
  currency_code text NOT NULL,
  component text NOT NULL CHECK (component IN ('principal', 'charge')),
  charge_id uuid,
  amount_minor bigint NOT NULL CHECK (amount_minor <> 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (activity_id, currency_code) REFERENCES financial_activities(id, currency_code) ON DELETE RESTRICT,
  FOREIGN KEY (asset_id, currency_code) REFERENCES assets(id, currency_code) ON DELETE RESTRICT,
  FOREIGN KEY (charge_id, activity_id) REFERENCES activity_charges(id, activity_id) ON DELETE RESTRICT,
  CONSTRAINT charge_movement_reference CHECK ((component = 'charge') = (charge_id IS NOT NULL))
);

CREATE UNIQUE INDEX one_movement_per_charge ON ledger_movements(charge_id) WHERE charge_id IS NOT NULL;
CREATE UNIQUE INDEX one_principal_per_activity_asset ON ledger_movements(activity_id, asset_id) WHERE component = 'principal';
CREATE INDEX ledger_movements_asset_idx ON ledger_movements(asset_id, created_at);
CREATE INDEX financial_activities_occurred_idx ON financial_activities(occurred_at DESC);
CREATE INDEX financial_activities_source_idx ON financial_activities(source_asset_id, occurred_at DESC);
CREATE INDEX financial_activities_destination_idx ON financial_activities(destination_asset_id, occurred_at DESC);
CREATE INDEX activity_charges_type_idx ON activity_charges(charge_type_id);

-- Historical amounts must never be reinterpreted by changing their unit scale.
CREATE FUNCTION reject_currency_exponent_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.minor_unit_exponent <> OLD.minor_unit_exponent THEN
    RAISE EXCEPTION 'Currency exponent change requires an explicit data migration';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER currency_exponent_immutable
  BEFORE UPDATE OF minor_unit_exponent ON currencies
  FOR EACH ROW EXECUTE FUNCTION reject_currency_exponent_change();

CREATE FUNCTION reject_asset_currency_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.currency_code <> OLD.currency_code THEN
    RAISE EXCEPTION 'Asset currency cannot change after creation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER asset_currency_immutable
  BEFORE UPDATE OF currency_code ON assets
  FOR EACH ROW EXECUTE FUNCTION reject_asset_currency_change();

CREATE FUNCTION reject_opening_rewrite() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Opening state is immutable; record a correction in the ledger';
  RETURN OLD;
END;
$$;
CREATE TRIGGER opening_state_immutable
  BEFORE UPDATE OR DELETE ON asset_opening_states
  FOR EACH ROW EXECUTE FUNCTION reject_opening_rewrite();
