-- Additive composable rules. Legacy 008/009 records remain authoritative.
CREATE TABLE automation_categories (
  id uuid PRIMARY KEY, name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE UNIQUE INDEX automation_category_name ON automation_categories(lower(btrim(name)));
CREATE TABLE automation_rules (
  id uuid PRIMARY KEY, status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','archived')),
  active_version integer NOT NULL DEFAULT 1 CHECK (active_version > 0),
  category_id uuid REFERENCES automation_categories(id) ON DELETE RESTRICT,
  materialized_through date,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE automation_rule_versions (
  rule_id uuid NOT NULL REFERENCES automation_rules(id) ON DELETE RESTRICT,
  version_no integer NOT NULL CHECK (version_no > 0),
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 120),
  trigger_namespace text NOT NULL CHECK (trigger_namespace IN ('time','transaction_posted')),
  trigger_config jsonb NOT NULL CHECK (jsonb_typeof(trigger_config)='object'),
  condition_mode text NOT NULL CHECK (condition_mode IN ('ALL','ANY')),
  execution_policy text NOT NULL CHECK (execution_policy IN ('confirm_before_execute','automatic')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(rule_id,version_no), UNIQUE(rule_id,version_no,trigger_namespace),
  CHECK (trigger_namespace='time' OR execution_policy='confirm_before_execute'),
  CHECK ((trigger_namespace='time' AND trigger_config ? 'schedule' AND jsonb_typeof(trigger_config->'schedule')='object')
    OR (trigger_namespace='transaction_posted' AND NOT trigger_config ? 'schedule'
      AND (NOT trigger_config ? 'activityKind' OR trigger_config->>'activityKind' IN ('income','expense','transfer'))))
);
ALTER TABLE automation_rules ADD CONSTRAINT automation_active_version_fk FOREIGN KEY(id,active_version)
  REFERENCES automation_rule_versions(rule_id,version_no) DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE automation_conditions (
  rule_id uuid NOT NULL, version_no integer NOT NULL, position integer NOT NULL CHECK (position>=0),
  field text NOT NULL CHECK (field IN ('transaction_type','source_asset','destination_asset','transaction_category','base_amount','currency')),
  operator text NOT NULL CHECK (operator IN ('equals','not_equals','greater_than','greater_or_equal','less_than','less_or_equal','between')),
  activity_kind text CHECK (activity_kind IN ('income','expense','transfer')),
  asset_id uuid REFERENCES assets(id) ON DELETE RESTRICT,
  category_id uuid REFERENCES transaction_categories(id) ON DELETE RESTRICT,
  currency_code text REFERENCES currencies(code) ON DELETE RESTRICT,
  amount_minor bigint CHECK (amount_minor>=0), upper_amount_minor bigint CHECK (upper_amount_minor>=amount_minor),
  PRIMARY KEY(rule_id,version_no,position),
  FOREIGN KEY(rule_id,version_no) REFERENCES automation_rule_versions(rule_id,version_no) ON DELETE RESTRICT,
  CHECK ((field='transaction_type' AND activity_kind IS NOT NULL AND asset_id IS NULL AND category_id IS NULL AND currency_code IS NULL AND amount_minor IS NULL)
    OR (field IN ('source_asset','destination_asset') AND asset_id IS NOT NULL AND activity_kind IS NULL AND category_id IS NULL AND currency_code IS NULL AND amount_minor IS NULL)
    OR (field='transaction_category' AND category_id IS NOT NULL AND activity_kind IS NULL AND asset_id IS NULL AND currency_code IS NULL AND amount_minor IS NULL)
    OR (field='currency' AND currency_code IS NOT NULL AND activity_kind IS NULL AND asset_id IS NULL AND category_id IS NULL AND amount_minor IS NULL)
    OR (field='base_amount' AND amount_minor IS NOT NULL AND currency_code IS NOT NULL AND activity_kind IS NULL AND asset_id IS NULL AND category_id IS NULL)),
  CHECK (field='base_amount' OR operator IN ('equals','not_equals')),
  CHECK ((operator='between')=(upper_amount_minor IS NOT NULL))
);
CREATE TABLE automation_actions (
  rule_id uuid NOT NULL, version_no integer NOT NULL, position integer NOT NULL CHECK (position>=0),
  action_kind text NOT NULL CHECK (action_kind IN ('income','expense','transfer')),
  source_strategy text CHECK (source_strategy IN ('configured_asset','trigger_source_asset','trigger_destination_asset')),
  source_asset_id uuid REFERENCES assets(id) ON DELETE RESTRICT,
  destination_strategy text CHECK (destination_strategy IN ('configured_asset','trigger_source_asset','trigger_destination_asset')),
  destination_asset_id uuid REFERENCES assets(id) ON DELETE RESTRICT,
  amount_strategy text NOT NULL CHECK (amount_strategy IN ('fixed','percentage_of_trigger','trigger_amount','confirm_at_runtime')),
  amount_minor bigint CHECK (amount_minor>0), currency_code text REFERENCES currencies(code) ON DELETE RESTRICT,
  percentage_bps integer CHECK (percentage_bps BETWEEN 1 AND 10000),
  category_id uuid REFERENCES transaction_categories(id) ON DELETE RESTRICT,
  transfer_fee_minor bigint CHECK (transfer_fee_minor>0), note text CHECK (length(note)<=1000),
  PRIMARY KEY(rule_id,version_no,position),
  FOREIGN KEY(rule_id,version_no) REFERENCES automation_rule_versions(rule_id,version_no) ON DELETE RESTRICT,
  CHECK ((source_strategy='configured_asset' AND source_asset_id IS NOT NULL) OR (source_strategy IS DISTINCT FROM 'configured_asset' AND source_asset_id IS NULL)),
  CHECK ((destination_strategy='configured_asset' AND destination_asset_id IS NOT NULL) OR (destination_strategy IS DISTINCT FROM 'configured_asset' AND destination_asset_id IS NULL)),
  CHECK ((action_kind='income' AND source_strategy IS NULL AND destination_strategy IS NOT NULL AND transfer_fee_minor IS NULL)
    OR (action_kind='expense' AND source_strategy IS NOT NULL AND destination_strategy IS NULL AND transfer_fee_minor IS NULL)
    OR (action_kind='transfer' AND source_strategy IS NOT NULL AND destination_strategy IS NOT NULL AND category_id IS NULL)),
  CHECK (source_asset_id IS NULL OR destination_asset_id IS NULL OR source_asset_id<>destination_asset_id),
  CHECK ((amount_strategy='fixed' AND amount_minor IS NOT NULL AND currency_code IS NOT NULL AND percentage_bps IS NULL)
    OR (amount_strategy='percentage_of_trigger' AND percentage_bps IS NOT NULL AND amount_minor IS NULL AND currency_code IS NULL)
    OR (amount_strategy IN ('trigger_amount','confirm_at_runtime') AND amount_minor IS NULL AND currency_code IS NULL AND percentage_bps IS NULL))
);
CREATE TABLE automation_action_charges (
  rule_id uuid NOT NULL, version_no integer NOT NULL, action_position integer NOT NULL,
  position integer NOT NULL CHECK (position>=0), type_id uuid NOT NULL REFERENCES additional_charge_types(id) ON DELETE RESTRICT,
  amount_minor bigint NOT NULL CHECK (amount_minor>0), PRIMARY KEY(rule_id,version_no,action_position,position),
  FOREIGN KEY(rule_id,version_no,action_position) REFERENCES automation_actions(rule_id,version_no,position) ON DELETE RESTRICT
);
CREATE TABLE automation_active_periods (
  id uuid PRIMARY KEY, rule_id uuid NOT NULL, version_no integer NOT NULL,
  opened_at timestamptz NOT NULL, closed_at timestamptz CHECK (closed_at IS NULL OR closed_at>=opened_at),
  FOREIGN KEY(rule_id,version_no) REFERENCES automation_rule_versions(rule_id,version_no) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX automation_one_open_period ON automation_active_periods(rule_id) WHERE closed_at IS NULL;
CREATE INDEX automation_period_lookup ON automation_active_periods(opened_at,closed_at,rule_id);
CREATE TABLE automation_source_receipts (
  root_activity_id uuid PRIMARY KEY REFERENCES financial_activities(id) ON DELETE RESTRICT,
  eligible_at timestamptz NOT NULL
);
CREATE INDEX automation_source_time ON automation_source_receipts(eligible_at,root_activity_id);
-- No historical backfill. Replacement activities never become a second logical event.
CREATE FUNCTION record_general_automation_source() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.replaces_activity_id IS NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext('moneytor_general_automation_order'));
    INSERT INTO automation_source_receipts(root_activity_id,eligible_at) VALUES(NEW.id,clock_timestamp());
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER automation_v1_source_insert AFTER INSERT ON financial_activities
  FOR EACH ROW EXECUTE FUNCTION record_general_automation_source();
CREATE TABLE automation_instances (
  id uuid PRIMARY KEY, rule_id uuid NOT NULL, version_no integer NOT NULL,
  trigger_namespace text NOT NULL, trigger_identity text NOT NULL CHECK (length(trigger_identity) BETWEEN 1 AND 180),
  eligible_at timestamptz NOT NULL, scheduled_at timestamptz,
  root_activity_id uuid REFERENCES automation_source_receipts(root_activity_id) ON DELETE RESTRICT,
  effective_activity_id uuid REFERENCES financial_activities(id) ON DELETE RESTRICT,
  trigger_snapshot jsonb NOT NULL CHECK (jsonb_typeof(trigger_snapshot)='object'),
  condition_snapshot jsonb NOT NULL CHECK (jsonb_typeof(condition_snapshot)='object'),
  action_snapshot jsonb NOT NULL CHECK (jsonb_typeof(action_snapshot)='object'),
  calculated_amount_minor bigint CHECK (calculated_amount_minor>0),
  resolved_source_asset_id uuid REFERENCES assets(id) ON DELETE RESTRICT,
  resolved_destination_asset_id uuid REFERENCES assets(id) ON DELETE RESTRICT,
  currency_code text REFERENCES currencies(code) ON DELETE RESTRICT,
  status text NOT NULL CHECK (status IN ('upcoming','awaiting_confirmation','posted','skipped','failed','superseded','review_required','not_matched')),
  confirmation_state text NOT NULL DEFAULT 'pending' CHECK (confirmation_state IN ('pending','not_required','confirmed','skipped')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts>=0), attempted_at timestamptz, failure_reason text,
  result_activity_id uuid UNIQUE REFERENCES financial_activities(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(rule_id,trigger_namespace,trigger_identity),
  FOREIGN KEY(rule_id,version_no,trigger_namespace) REFERENCES automation_rule_versions(rule_id,version_no,trigger_namespace) ON DELETE RESTRICT,
  CHECK ((trigger_namespace='time' AND scheduled_at IS NOT NULL AND root_activity_id IS NULL AND effective_activity_id IS NULL AND trigger_identity=to_char(scheduled_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
    OR (trigger_namespace='transaction_posted' AND scheduled_at IS NULL AND root_activity_id IS NOT NULL AND effective_activity_id IS NOT NULL AND trigger_identity=root_activity_id::text)),
  CHECK ((status IN ('posted','review_required'))=(result_activity_id IS NOT NULL))
);
CREATE INDEX automation_instance_attention ON automation_instances(status,eligible_at);
CREATE INDEX automation_instance_source ON automation_instances(root_activity_id,effective_activity_id);
CREATE TABLE automation_action_results (
  id uuid PRIMARY KEY, instance_id uuid NOT NULL REFERENCES automation_instances(id) ON DELETE RESTRICT,
  action_position integer NOT NULL CHECK (action_position>=0),
  activity_id uuid NOT NULL UNIQUE REFERENCES financial_activities(id) ON DELETE RESTRICT,
  origin text NOT NULL CHECK (origin IN ('time_automation','transaction_automation')),
  causal_root_activity_id uuid REFERENCES financial_activities(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE(instance_id,action_position)
);
CREATE TABLE automation_instance_revisions (
  id uuid PRIMARY KEY, instance_id uuid NOT NULL REFERENCES automation_instances(id) ON DELETE RESTRICT,
  previous_snapshot jsonb NOT NULL CHECK (jsonb_typeof(previous_snapshot)='object'),
  revised_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE automation_rule_mutations (
  idempotency_key uuid PRIMARY KEY, request_hash text NOT NULL CHECK(request_hash ~ '^[0-9a-f]{64}$'),
  rule_id uuid NOT NULL REFERENCES automation_rules(id) ON DELETE RESTRICT
);
CREATE FUNCTION prevent_general_automation_rewrite() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Automation configuration and audit history are immutable'; END;
$$;
CREATE TRIGGER automation_version_immutable BEFORE UPDATE OR DELETE ON automation_rule_versions FOR EACH ROW EXECUTE FUNCTION prevent_general_automation_rewrite();
CREATE TRIGGER automation_condition_immutable BEFORE UPDATE OR DELETE ON automation_conditions FOR EACH ROW EXECUTE FUNCTION prevent_general_automation_rewrite();
CREATE TRIGGER automation_action_immutable BEFORE UPDATE OR DELETE ON automation_actions FOR EACH ROW EXECUTE FUNCTION prevent_general_automation_rewrite();
CREATE TRIGGER automation_charge_immutable BEFORE UPDATE OR DELETE ON automation_action_charges FOR EACH ROW EXECUTE FUNCTION prevent_general_automation_rewrite();
CREATE TRIGGER automation_receipt_immutable BEFORE UPDATE OR DELETE ON automation_source_receipts FOR EACH ROW EXECUTE FUNCTION prevent_general_automation_rewrite();
CREATE TRIGGER automation_revision_immutable BEFORE UPDATE OR DELETE ON automation_instance_revisions FOR EACH ROW EXECUTE FUNCTION prevent_general_automation_rewrite();
CREATE TRIGGER automation_result_immutable BEFORE UPDATE OR DELETE ON automation_action_results FOR EACH ROW EXECUTE FUNCTION prevent_general_automation_rewrite();
-- Ordered storage permits future expansion; V1 explicitly admits only one action.
CREATE FUNCTION validate_general_automation_version() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v automation_rule_versions%ROWTYPE; a automation_actions%ROWTYPE;
BEGIN
  SELECT * INTO v FROM automation_rule_versions WHERE rule_id=NEW.rule_id AND version_no=NEW.version_no;
  IF (SELECT count(*) FROM automation_actions WHERE rule_id=v.rule_id AND version_no=v.version_no)<>1 THEN
    RAISE EXCEPTION 'V1 requires exactly one action';
  END IF;
  SELECT * INTO a FROM automation_actions WHERE rule_id=v.rule_id AND version_no=v.version_no;
  IF a.position<>0 OR (v.trigger_namespace='time' AND (a.amount_strategy IN ('percentage_of_trigger','trigger_amount')
    OR a.source_strategy IN ('trigger_source_asset','trigger_destination_asset') OR a.destination_strategy IN ('trigger_source_asset','trigger_destination_asset')
    OR EXISTS(SELECT 1 FROM automation_conditions WHERE rule_id=v.rule_id AND version_no=v.version_no)))
    OR (v.execution_policy='automatic' AND (v.trigger_namespace<>'time' OR a.amount_strategy<>'fixed')) THEN
    RAISE EXCEPTION 'Incompatible automation configuration';
  END IF;
  IF a.action_kind<>'expense' AND EXISTS(SELECT 1 FROM automation_action_charges WHERE rule_id=v.rule_id AND version_no=v.version_no) THEN
    RAISE EXCEPTION 'Charges require an Expense action';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER automation_version_valid AFTER INSERT ON automation_rule_versions
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_general_automation_version();
CREATE CONSTRAINT TRIGGER automation_action_valid AFTER INSERT ON automation_actions
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_general_automation_version();
CREATE CONSTRAINT TRIGGER automation_condition_valid AFTER INSERT ON automation_conditions
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_general_automation_version();
CREATE CONSTRAINT TRIGGER automation_charge_valid AFTER INSERT ON automation_action_charges
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION validate_general_automation_version();
CREATE FUNCTION prevent_published_automation_extension() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM automation_active_periods WHERE rule_id=NEW.rule_id AND version_no=NEW.version_no)
    OR EXISTS(SELECT 1 FROM automation_instances WHERE rule_id=NEW.rule_id AND version_no=NEW.version_no) THEN
    RAISE EXCEPTION 'Published automation configuration is immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER automation_condition_no_extension BEFORE INSERT ON automation_conditions FOR EACH ROW EXECUTE FUNCTION prevent_published_automation_extension();
CREATE TRIGGER automation_action_no_extension BEFORE INSERT ON automation_actions FOR EACH ROW EXECUTE FUNCTION prevent_published_automation_extension();
CREATE TRIGGER automation_charge_no_extension BEFORE INSERT ON automation_action_charges FOR EACH ROW EXECUTE FUNCTION prevent_published_automation_extension();
