-- Allocation assessments are snapshots, never an alternative ledger.
CREATE TABLE automation_allocation_assessments (
  id uuid PRIMARY KEY,
  legacy_instance_id uuid REFERENCES income_event_instances(id) ON DELETE RESTRICT,
  general_instance_id uuid REFERENCES automation_instances(id) ON DELETE RESTRICT,
  root_activity_id uuid NOT NULL REFERENCES financial_activities(id) ON DELETE RESTRICT,
  effective_activity_id uuid NOT NULL REFERENCES financial_activities(id) ON DELETE RESTRICT,
  original_result_id uuid NOT NULL REFERENCES financial_activities(id) ON DELETE RESTRICT,
  fingerprint text NOT NULL CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
  basis_fingerprint text NOT NULL CHECK (basis_fingerprint ~ '^[0-9a-f]{64}$'),
  percentage_bps integer NOT NULL CHECK (percentage_bps BETWEEN 1 AND 10000),
  currency_code text NOT NULL REFERENCES currencies(code) ON DELETE RESTRICT,
  source_amount_minor bigint NOT NULL CHECK (source_amount_minor >= 0),
  target_minor bigint NOT NULL CHECK (target_minor >= 0),
  recognized_minor bigint NOT NULL CHECK (recognized_minor >= 0),
  difference_minor bigint NOT NULL,
  action_kind text NOT NULL CHECK (action_kind IN ('income','expense','transfer')),
  source_asset_id uuid REFERENCES assets(id) ON DELETE RESTRICT,
  destination_asset_id uuid REFERENCES assets(id) ON DELETE RESTRICT,
  category_id uuid REFERENCES transaction_categories(id) ON DELETE RESTRICT,
  rule_snapshot jsonb NOT NULL CHECK (jsonb_typeof(rule_snapshot)='object'),
  source_snapshot jsonb NOT NULL CHECK (jsonb_typeof(source_snapshot)='object'),
  result_snapshot jsonb NOT NULL CHECK (jsonb_typeof(result_snapshot)='array'),
  state text NOT NULL CHECK (state IN ('additional','aligned','excess','blocked')),
  reason text, assessed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (num_nonnulls(legacy_instance_id,general_instance_id)=1),
  CHECK (difference_minor::numeric=target_minor::numeric-recognized_minor::numeric),
  CHECK (target_minor::numeric=CASE WHEN source_snapshot->>'status'='posted' AND source_snapshot->>'kind'='income'
    AND source_snapshot->>'currency_code'=currency_code THEN floor(source_amount_minor::numeric*percentage_bps/10000) ELSE 0 END),
  CHECK (state='blocked' OR (state='additional' AND difference_minor>0) OR (state='aligned' AND difference_minor=0) OR (state='excess' AND difference_minor<0)),
  CHECK ((action_kind='income' AND source_asset_id IS NULL AND destination_asset_id IS NOT NULL)
    OR (action_kind='expense' AND source_asset_id IS NOT NULL AND destination_asset_id IS NULL)
    OR (action_kind='transfer' AND source_asset_id IS NOT NULL AND destination_asset_id IS NOT NULL AND source_asset_id<>destination_asset_id AND category_id IS NULL)),
  UNIQUE(id,difference_minor)
);
CREATE UNIQUE INDEX allocation_legacy_revision ON automation_allocation_assessments(legacy_instance_id,fingerprint) WHERE legacy_instance_id IS NOT NULL;
CREATE UNIQUE INDEX allocation_general_revision ON automation_allocation_assessments(general_instance_id,fingerprint) WHERE general_instance_id IS NOT NULL;
CREATE INDEX allocation_legacy_latest ON automation_allocation_assessments(legacy_instance_id,assessed_at DESC,id DESC);
CREATE INDEX allocation_general_latest ON automation_allocation_assessments(general_instance_id,assessed_at DESC,id DESC);
CREATE TABLE automation_allocation_adjustments (
  id uuid PRIMARY KEY,
  assessment_id uuid NOT NULL UNIQUE REFERENCES automation_allocation_assessments(id) ON DELETE RESTRICT,
  amount_minor bigint NOT NULL CHECK (amount_minor>0),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','failed','superseded','posted')),
  result_activity_id uuid UNIQUE REFERENCES financial_activities(id) ON DELETE RESTRICT,
  confirmation_hash text CHECK (confirmation_hash ~ '^[0-9a-f]{64}$'),
  confirmed_by text CHECK (confirmed_by='owner'), confirmed_at timestamptz,
  transfer_fee_minor bigint CHECK (transfer_fee_minor>0),
  charges jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(charges)='array'),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts>=0), failure_reason text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY(assessment_id,amount_minor) REFERENCES automation_allocation_assessments(id,difference_minor) ON DELETE RESTRICT,
  CHECK ((status='posted')=(result_activity_id IS NOT NULL)),
  CHECK (status<>'posted' OR (confirmation_hash IS NOT NULL AND confirmed_at IS NOT NULL AND confirmed_by='owner'))
);
CREATE INDEX allocation_adjustment_state ON automation_allocation_adjustments(status,assessment_id);
CREATE TABLE automation_allocation_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  assessment_id uuid NOT NULL REFERENCES automation_allocation_assessments(id) ON DELETE RESTRICT,
  adjustment_id uuid REFERENCES automation_allocation_adjustments(id) ON DELETE RESTRICT,
  event text NOT NULL CHECK (event IN ('assessed','pending','failed','superseded','posted')),
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot)='object'),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE FUNCTION protect_allocation_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Allocation assessments and audit are immutable'; END;
$$;
CREATE TRIGGER allocation_assessment_immutable BEFORE UPDATE OR DELETE ON automation_allocation_assessments FOR EACH ROW EXECUTE FUNCTION protect_allocation_history();
CREATE TRIGGER allocation_audit_immutable BEFORE UPDATE OR DELETE ON automation_allocation_audit FOR EACH ROW EXECUTE FUNCTION protect_allocation_history();
CREATE FUNCTION validate_allocation_assessment() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE root uuid; result uuid;
BEGIN
  IF NEW.legacy_instance_id IS NOT NULL THEN
    SELECT root_activity_id,result_activity_id INTO root,result FROM income_event_instances WHERE id=NEW.legacy_instance_id;
  ELSE
    SELECT root_activity_id,result_activity_id INTO root,result FROM automation_instances WHERE id=NEW.general_instance_id AND trigger_namespace='transaction_posted';
  END IF;
  IF root IS DISTINCT FROM NEW.root_activity_id OR result IS DISTINCT FROM NEW.original_result_id OR result IS NULL THEN RAISE EXCEPTION 'Invalid allocation instance lineage'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER allocation_assessment_valid BEFORE INSERT ON automation_allocation_assessments FOR EACH ROW EXECUTE FUNCTION validate_allocation_assessment();
CREATE FUNCTION protect_allocation_adjustment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Allocation adjustment history cannot be deleted'; END IF;
  IF NEW.id<>OLD.id OR NEW.assessment_id<>OLD.assessment_id OR NEW.amount_minor<>OLD.amount_minor OR NEW.created_at<>OLD.created_at
    OR OLD.status IN ('posted','superseded') OR (OLD.confirmation_hash IS NOT NULL AND
      (NEW.confirmation_hash IS DISTINCT FROM OLD.confirmation_hash OR NEW.charges IS DISTINCT FROM OLD.charges OR NEW.transfer_fee_minor IS DISTINCT FROM OLD.transfer_fee_minor)) THEN
    RAISE EXCEPTION 'Allocation identity, confirmation and posted results are immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER allocation_adjustment_protected BEFORE UPDATE OR DELETE ON automation_allocation_adjustments FOR EACH ROW EXECUTE FUNCTION protect_allocation_adjustment();
CREATE FUNCTION validate_allocation_result() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a automation_allocation_assessments%ROWTYPE; f financial_activities%ROWTYPE;
BEGIN
  SELECT * INTO a FROM automation_allocation_assessments WHERE id=NEW.assessment_id;
  IF TG_OP='INSERT' AND a.state<>'additional' THEN RAISE EXCEPTION 'Only positive allocations have proposals'; END IF;
  IF NEW.status='posted' THEN
    SELECT * INTO f FROM financial_activities WHERE id=NEW.result_activity_id;
    IF f.kind IS DISTINCT FROM a.action_kind OR f.base_amount_minor IS DISTINCT FROM NEW.amount_minor OR f.currency_code IS DISTINCT FROM a.currency_code
      OR f.source_asset_id IS DISTINCT FROM a.source_asset_id OR f.destination_asset_id IS DISTINCT FROM a.destination_asset_id
      OR NOT EXISTS(SELECT 1 FROM finance_operations WHERE idempotency_key=NEW.id AND operation='post' AND result_activity_id=f.id) THEN
      RAISE EXCEPTION 'Allocation result must be the matching idempotent P3 posting';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER allocation_result_valid BEFORE INSERT OR UPDATE ON automation_allocation_adjustments FOR EACH ROW EXECUTE FUNCTION validate_allocation_result();
CREATE FUNCTION audit_allocation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME='automation_allocation_assessments' THEN
    INSERT INTO automation_allocation_audit(assessment_id,event,snapshot) VALUES(NEW.id,'assessed',to_jsonb(NEW));
  ELSE
    INSERT INTO automation_allocation_audit(assessment_id,adjustment_id,event,snapshot) VALUES(NEW.assessment_id,NEW.id,NEW.status,to_jsonb(NEW));
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER allocation_assessed_audit AFTER INSERT ON automation_allocation_assessments FOR EACH ROW EXECUTE FUNCTION audit_allocation();
CREATE TRIGGER allocation_adjustment_audit AFTER INSERT OR UPDATE ON automation_allocation_adjustments FOR EACH ROW EXECUTE FUNCTION audit_allocation();
