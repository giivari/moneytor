-- P5.1A: owner-managed templates, bounded schedule materialization, and auditable occurrences.
CREATE TABLE recurring_transaction_rules (
  id uuid PRIMARY KEY,
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 120),
  kind text NOT NULL CHECK (kind IN ('income','expense','transfer')),
  amount_mode text NOT NULL CHECK (amount_mode IN ('fixed','confirm_amount')),
  amount_minor bigint CHECK (amount_minor > 0),
  execution_mode text NOT NULL CHECK (execution_mode IN ('auto_post','confirm_before_post')),
  source_asset_id uuid REFERENCES assets(id) ON DELETE RESTRICT,
  destination_asset_id uuid REFERENCES assets(id) ON DELETE RESTRICT,
  category_id uuid REFERENCES transaction_categories(id) ON DELETE RESTRICT,
  transfer_fee_minor bigint CHECK (transfer_fee_minor > 0),
  note text CHECK (note IS NULL OR length(note) <= 1000),
  frequency text NOT NULL CHECK (frequency IN ('daily','weekdays','weekly','monthly_day','monthly_last_day')),
  weekday integer CHECK (weekday BETWEEN 1 AND 7),
  month_day integer CHECK (month_day BETWEEN 1 AND 28),
  local_time time without time zone NOT NULL,
  start_on date NOT NULL,
  end_on date,
  materialized_through date NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','archived')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((amount_mode='fixed' AND amount_minor IS NOT NULL) OR (amount_mode='confirm_amount' AND amount_minor IS NULL)),
  CHECK (amount_mode='fixed' OR execution_mode='confirm_before_post'),
  CHECK ((frequency='weekly') = (weekday IS NOT NULL)),
  CHECK ((frequency='monthly_day') = (month_day IS NOT NULL)),
  CHECK (end_on IS NULL OR end_on >= start_on),
  CHECK ((kind='income' AND source_asset_id IS NULL AND destination_asset_id IS NOT NULL AND transfer_fee_minor IS NULL)
      OR (kind='expense' AND source_asset_id IS NOT NULL AND destination_asset_id IS NULL AND transfer_fee_minor IS NULL)
      OR (kind='transfer' AND source_asset_id IS NOT NULL AND destination_asset_id IS NOT NULL
          AND source_asset_id <> destination_asset_id AND category_id IS NULL))
);
CREATE TABLE recurring_rule_charges (
  rule_id uuid NOT NULL REFERENCES recurring_transaction_rules(id) ON DELETE CASCADE,
  ordinal integer NOT NULL CHECK (ordinal BETWEEN 0 AND 19),
  type_id uuid NOT NULL REFERENCES additional_charge_types(id) ON DELETE RESTRICT,
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  PRIMARY KEY (rule_id,ordinal)
);
CREATE TABLE recurring_transaction_occurrences (
  id uuid PRIMARY KEY,
  rule_id uuid NOT NULL REFERENCES recurring_transaction_rules(id) ON DELETE RESTRICT,
  rule_version integer NOT NULL CHECK (rule_version > 0),
  scheduled_at timestamptz NOT NULL,
  local_date date NOT NULL,
  kind text NOT NULL CHECK (kind IN ('income','expense','transfer')),
  amount_mode text NOT NULL CHECK (amount_mode IN ('fixed','confirm_amount')),
  amount_minor bigint CHECK (amount_minor > 0),
  execution_mode text NOT NULL CHECK (execution_mode IN ('auto_post','confirm_before_post')),
  source_asset_id uuid REFERENCES assets(id) ON DELETE RESTRICT,
  destination_asset_id uuid REFERENCES assets(id) ON DELETE RESTRICT,
  category_id uuid REFERENCES transaction_categories(id) ON DELETE RESTRICT,
  transfer_fee_minor bigint CHECK (transfer_fee_minor > 0),
  note text CHECK (note IS NULL OR length(note) <= 1000),
  status text NOT NULL DEFAULT 'upcoming' CHECK (status IN ('upcoming','due','pending_confirmation','posted','skipped','voided','failed','superseded')),
  activity_id uuid UNIQUE REFERENCES financial_activities(id) ON DELETE RESTRICT,
  failure_reason text,
  attempted_at timestamptz,
  posted_at timestamptz,
  skipped_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rule_id,scheduled_at),
  CHECK ((amount_mode='fixed' AND amount_minor IS NOT NULL) OR amount_mode='confirm_amount'),
  CHECK (amount_mode='fixed' OR execution_mode='confirm_before_post'),
  CHECK ((status IN ('posted','voided')) = (activity_id IS NOT NULL)),
  CHECK ((kind='income' AND source_asset_id IS NULL AND destination_asset_id IS NOT NULL AND transfer_fee_minor IS NULL)
      OR (kind='expense' AND source_asset_id IS NOT NULL AND destination_asset_id IS NULL AND transfer_fee_minor IS NULL)
      OR (kind='transfer' AND source_asset_id IS NOT NULL AND destination_asset_id IS NOT NULL
          AND source_asset_id <> destination_asset_id AND category_id IS NULL))
);
CREATE TABLE recurring_occurrence_charges (
  occurrence_id uuid NOT NULL REFERENCES recurring_transaction_occurrences(id) ON DELETE RESTRICT,
  ordinal integer NOT NULL CHECK (ordinal BETWEEN 0 AND 19),
  type_id uuid NOT NULL REFERENCES additional_charge_types(id) ON DELETE RESTRICT,
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  PRIMARY KEY (occurrence_id,ordinal)
);
CREATE TABLE recurring_mutation_requests (
  idempotency_key uuid PRIMARY KEY,
  action text NOT NULL CHECK (action IN ('save_rule')),
  request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  result_rule_id uuid NOT NULL REFERENCES recurring_transaction_rules(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX recurring_rules_status_cursor_idx ON recurring_transaction_rules(status,materialized_through);
CREATE INDEX recurring_occurrences_due_idx ON recurring_transaction_occurrences(status,scheduled_at);
CREATE INDEX recurring_occurrences_rule_idx ON recurring_transaction_occurrences(rule_id,scheduled_at DESC);
