-- Owner review is append-only, nonfinancial, and bound to a specific effective revision.
CREATE TABLE automation_activity_reviews (
  id uuid PRIMARY KEY,
  schedule_instance_id uuid REFERENCES recurring_transaction_occurrences(id) ON DELETE RESTRICT,
  legacy_instance_id uuid REFERENCES income_event_instances(id) ON DELETE RESTRICT,
  general_instance_id uuid REFERENCES automation_instances(id) ON DELETE RESTRICT,
  assessment_id uuid REFERENCES automation_allocation_assessments(id) ON DELETE RESTRICT,
  revision text NOT NULL CHECK (revision ~ '^[0-9a-f]{64}$'),
  decision text NOT NULL CHECK (decision IN ('acknowledged','declined_allocation')),
  reviewed_by text NOT NULL DEFAULT 'owner' CHECK (reviewed_by='owner'),
  reviewed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot)='object'),
  CHECK (num_nonnulls(schedule_instance_id,legacy_instance_id,general_instance_id)=1),
  CHECK (decision<>'declined_allocation' OR assessment_id IS NOT NULL)
);
CREATE UNIQUE INDEX automation_review_schedule_revision ON automation_activity_reviews(schedule_instance_id,revision) WHERE schedule_instance_id IS NOT NULL;
CREATE UNIQUE INDEX automation_review_legacy_revision ON automation_activity_reviews(legacy_instance_id,revision) WHERE legacy_instance_id IS NOT NULL;
CREATE UNIQUE INDEX automation_review_general_revision ON automation_activity_reviews(general_instance_id,revision) WHERE general_instance_id IS NOT NULL;
CREATE FUNCTION protect_automation_review() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Automation review history is immutable'; END;
$$;
CREATE TRIGGER automation_review_immutable BEFORE UPDATE OR DELETE ON automation_activity_reviews FOR EACH ROW EXECUTE FUNCTION protect_automation_review();
CREATE FUNCTION validate_automation_review() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.assessment_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM automation_allocation_assessments a WHERE a.id=NEW.assessment_id
    AND a.legacy_instance_id IS NOT DISTINCT FROM NEW.legacy_instance_id
    AND a.general_instance_id IS NOT DISTINCT FROM NEW.general_instance_id
    AND NEW.schedule_instance_id IS NULL
    AND (NEW.decision<>'declined_allocation' OR a.difference_minor>0)
  ) THEN RAISE EXCEPTION 'Invalid review assessment lineage'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER automation_review_valid BEFORE INSERT ON automation_activity_reviews FOR EACH ROW EXECUTE FUNCTION validate_automation_review();
