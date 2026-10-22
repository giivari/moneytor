-- P5.1B: posted Income events, versioned active periods, and auditable candidates.
-- The source receipt is necessary to order a committed Income against a rule
-- lifecycle transition without using a timestamp cursor over financial history.
CREATE TABLE income_automation_sources (
  root_activity_id uuid PRIMARY KEY REFERENCES financial_activities(id) ON DELETE RESTRICT,
  eligible_at timestamptz NOT NULL
);
CREATE INDEX income_automation_sources_time ON income_automation_sources(eligible_at,root_activity_id);

CREATE FUNCTION record_income_automation_source() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.kind = 'income' AND NEW.replaces_activity_id IS NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext('moneytor_income_event_order'));
    INSERT INTO income_automation_sources(root_activity_id,eligible_at)
      VALUES (NEW.id,clock_timestamp());
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER income_automation_source_insert AFTER INSERT ON financial_activities
  FOR EACH ROW EXECUTE FUNCTION record_income_automation_source();

CREATE TABLE income_event_rules (
  id uuid PRIMARY KEY,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','archived')),
  version_no integer NOT NULL DEFAULT 1 CHECK (version_no > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE income_event_rule_versions (
  rule_id uuid NOT NULL REFERENCES income_event_rules(id) ON DELETE RESTRICT,
  version_no integer NOT NULL CHECK (version_no > 0),
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 120),
  trigger_type text NOT NULL DEFAULT 'posted_income' CHECK (trigger_type = 'posted_income'),
  percentage_bps integer NOT NULL CHECK (percentage_bps BETWEEN 1 AND 10000),
  output_kind text NOT NULL CHECK (output_kind IN ('expense','transfer')),
  destination_asset_id uuid REFERENCES assets(id) ON DELETE RESTRICT,
  category_id uuid REFERENCES transaction_categories(id) ON DELETE RESTRICT,
  transfer_fee_minor bigint CHECK (transfer_fee_minor > 0),
  charges jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(charges) = 'array'),
  note text CHECK (note IS NULL OR length(note) <= 1000),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (rule_id,version_no),
  CHECK ((output_kind='expense' AND destination_asset_id IS NULL AND transfer_fee_minor IS NULL)
      OR (output_kind='transfer' AND destination_asset_id IS NOT NULL AND category_id IS NULL AND charges='[]'::jsonb))
);
CREATE TABLE income_event_active_periods (
  id uuid PRIMARY KEY,
  rule_id uuid NOT NULL,
  version_no integer NOT NULL,
  opened_at timestamptz NOT NULL,
  closed_at timestamptz CHECK (closed_at IS NULL OR closed_at >= opened_at),
  FOREIGN KEY (rule_id,version_no) REFERENCES income_event_rule_versions(rule_id,version_no) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX income_event_one_open_period ON income_event_active_periods(rule_id) WHERE closed_at IS NULL;
CREATE INDEX income_event_period_lookup ON income_event_active_periods(opened_at,closed_at,rule_id);

CREATE TABLE income_event_instances (
  id uuid PRIMARY KEY,
  rule_id uuid NOT NULL,
  rule_version integer NOT NULL,
  root_activity_id uuid NOT NULL REFERENCES income_automation_sources(root_activity_id) ON DELETE RESTRICT,
  effective_activity_id uuid NOT NULL REFERENCES financial_activities(id) ON DELETE RESTRICT,
  source_asset_id uuid NOT NULL REFERENCES assets(id) ON DELETE RESTRICT,
  source_currency text NOT NULL REFERENCES currencies(code) ON DELETE RESTRICT,
  source_amount_minor bigint NOT NULL CHECK (source_amount_minor > 0),
  source_occurred_at timestamptz NOT NULL,
  percentage_bps integer NOT NULL CHECK (percentage_bps BETWEEN 1 AND 10000),
  proposed_amount_minor bigint CHECK (proposed_amount_minor > 0),
  output_kind text NOT NULL CHECK (output_kind IN ('expense','transfer')),
  destination_asset_id uuid REFERENCES assets(id) ON DELETE RESTRICT,
  category_id uuid REFERENCES transaction_categories(id) ON DELETE RESTRICT,
  transfer_fee_minor bigint CHECK (transfer_fee_minor > 0),
  charges jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(charges)='array'),
  note text,
  status text NOT NULL CHECK (status IN ('awaiting_confirmation','posted','skipped','failed','superseded','review_required')),
  failure_reason text,
  attempted_at timestamptz,
  result_activity_id uuid UNIQUE REFERENCES financial_activities(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  evaluated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (rule_id,root_activity_id),
  FOREIGN KEY (rule_id,rule_version) REFERENCES income_event_rule_versions(rule_id,version_no) ON DELETE RESTRICT,
  CHECK ((status IN ('posted','review_required')) = (result_activity_id IS NOT NULL)),
  CHECK ((output_kind='expense' AND destination_asset_id IS NULL AND transfer_fee_minor IS NULL)
      OR (output_kind='transfer' AND destination_asset_id IS NOT NULL AND category_id IS NULL AND charges='[]'::jsonb))
);
CREATE INDEX income_event_instances_status ON income_event_instances(status,created_at);

CREATE TABLE income_event_instance_revisions (
  id uuid PRIMARY KEY,
  instance_id uuid NOT NULL REFERENCES income_event_instances(id) ON DELETE RESTRICT,
  previous_effective_activity_id uuid NOT NULL REFERENCES financial_activities(id) ON DELETE RESTRICT,
  previous_source_amount_minor bigint NOT NULL,
  previous_proposed_amount_minor bigint,
  revised_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE income_event_rule_mutations (
  idempotency_key uuid PRIMARY KEY,
  request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  result_rule_id uuid NOT NULL REFERENCES income_event_rules(id) ON DELETE RESTRICT
);

CREATE FUNCTION prevent_income_event_snapshot_rewrite() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Income event source and rule version history are immutable';
END;
$$;
CREATE TRIGGER income_event_source_no_rewrite BEFORE UPDATE OR DELETE ON income_automation_sources
  FOR EACH ROW EXECUTE FUNCTION prevent_income_event_snapshot_rewrite();
CREATE TRIGGER income_event_version_no_rewrite BEFORE UPDATE OR DELETE ON income_event_rule_versions
  FOR EACH ROW EXECUTE FUNCTION prevent_income_event_snapshot_rewrite();
CREATE TRIGGER income_event_revision_no_rewrite BEFORE UPDATE OR DELETE ON income_event_instance_revisions
  FOR EACH ROW EXECUTE FUNCTION prevent_income_event_snapshot_rewrite();
