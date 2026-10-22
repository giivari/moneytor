-- P5: optional planning overlays; never a substitute for ledger movements.
CREATE TABLE planning_labels (
  id uuid PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('budget','goal','reserve','obligation')),
  system_key text UNIQUE,
  display_name text NOT NULL CHECK (length(btrim(display_name)) BETWEEN 1 AND 120),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id,kind),
  CHECK (system_key IS NULL OR system_key ~ '^[a-z][a-z0-9_]*$')
);
INSERT INTO planning_labels(id,kind,system_key,display_name) VALUES
  ('963724b4-42a3-4fbb-8cb1-97c14521ed01','budget','monthly_spending','Pengeluaran bulanan'),
  ('963724b4-42a3-4fbb-8cb1-97c14521ed02','goal','savings','Tabungan'),
  ('963724b4-42a3-4fbb-8cb1-97c14521ed03','goal','purchase','Pembelian'),
  ('963724b4-42a3-4fbb-8cb1-97c14521ed04','reserve','emergency','Dana darurat'),
  ('963724b4-42a3-4fbb-8cb1-97c14521ed05','reserve','restricted','Dana dibatasi'),
  ('963724b4-42a3-4fbb-8cb1-97c14521ed06','obligation','bill','Tagihan'),
  ('963724b4-42a3-4fbb-8cb1-97c14521ed07','obligation','debt','Kewajiban lain');

CREATE TABLE planning_budgets (
  id uuid PRIMARY KEY,
  label_id uuid NOT NULL,
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 120),
  currency_code text NOT NULL REFERENCES currencies(code) ON DELETE RESTRICT,
  limit_minor bigint NOT NULL CHECK (limit_minor > 0),
  category_id uuid REFERENCES transaction_categories(id) ON DELETE RESTRICT,
  period_start date NOT NULL,
  period_end date NOT NULL,
  note text CHECK (note IS NULL OR length(note) <= 500),
  is_active boolean NOT NULL DEFAULT true,
  archived_at timestamptz,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (period_end > period_start)
);

CREATE TABLE planning_goals (
  id uuid PRIMARY KEY,
  label_id uuid NOT NULL,
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 120),
  currency_code text NOT NULL REFERENCES currencies(code) ON DELETE RESTRICT,
  target_minor bigint NOT NULL CHECK (target_minor > 0),
  target_on date,
  note text CHECK (note IS NULL OR length(note) <= 500),
  is_active boolean NOT NULL DEFAULT true,
  archived_at timestamptz,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id,currency_code)
);

CREATE TABLE planning_obligations (
  id uuid PRIMARY KEY,
  label_id uuid NOT NULL,
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 120),
  currency_code text NOT NULL REFERENCES currencies(code) ON DELETE RESTRICT,
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  due_on date NOT NULL,
  note text CHECK (note IS NULL OR length(note) <= 500),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','settled','cancelled')),
  settled_at timestamptz,
  cancelled_at timestamptz,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id,currency_code),
  CHECK (status <> 'settled' OR settled_at IS NOT NULL),
  CHECK (status <> 'cancelled' OR cancelled_at IS NOT NULL)
);

CREATE TABLE planning_reserves (
  id uuid PRIMARY KEY,
  label_id uuid NOT NULL,
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 120),
  currency_code text NOT NULL REFERENCES currencies(code) ON DELETE RESTRICT,
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  purpose text NOT NULL CHECK (purpose IN ('general','emergency','restricted','goal','obligation')),
  source_asset_id uuid,
  goal_id uuid,
  obligation_id uuid,
  note text CHECK (note IS NULL OR length(note) <= 500),
  is_active boolean NOT NULL DEFAULT true,
  released_at timestamptz,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (source_asset_id,currency_code) REFERENCES assets(id,currency_code) ON DELETE RESTRICT,
  FOREIGN KEY (goal_id,currency_code) REFERENCES planning_goals(id,currency_code) ON DELETE RESTRICT,
  FOREIGN KEY (obligation_id,currency_code) REFERENCES planning_obligations(id,currency_code) ON DELETE RESTRICT,
  CHECK ((purpose='goal' AND goal_id IS NOT NULL AND obligation_id IS NULL)
    OR (purpose='obligation' AND obligation_id IS NOT NULL AND goal_id IS NULL)
    OR (purpose IN ('general','emergency','restricted') AND goal_id IS NULL AND obligation_id IS NULL))
);

-- A constant kind column permits composite FKs without a nullable, many-kind item table.
ALTER TABLE planning_budgets ADD COLUMN kind text NOT NULL DEFAULT 'budget' CHECK (kind='budget');
ALTER TABLE planning_goals ADD COLUMN kind text NOT NULL DEFAULT 'goal' CHECK (kind='goal');
ALTER TABLE planning_obligations ADD COLUMN kind text NOT NULL DEFAULT 'obligation' CHECK (kind='obligation');
ALTER TABLE planning_reserves ADD COLUMN kind text NOT NULL DEFAULT 'reserve' CHECK (kind='reserve');
ALTER TABLE planning_budgets ADD FOREIGN KEY (label_id,kind) REFERENCES planning_labels(id,kind) ON DELETE RESTRICT;
ALTER TABLE planning_goals ADD FOREIGN KEY (label_id,kind) REFERENCES planning_labels(id,kind) ON DELETE RESTRICT;
ALTER TABLE planning_obligations ADD FOREIGN KEY (label_id,kind) REFERENCES planning_labels(id,kind) ON DELETE RESTRICT;
ALTER TABLE planning_reserves ADD FOREIGN KEY (label_id,kind) REFERENCES planning_labels(id,kind) ON DELETE RESTRICT;

CREATE TABLE planning_mutation_requests (
  idempotency_key uuid PRIMARY KEY,
  operation text NOT NULL,
  request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  completed boolean NOT NULL DEFAULT false,
  result_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX planning_budget_period ON planning_budgets(currency_code,period_start,period_end) WHERE is_active;
CREATE INDEX planning_reserve_active_currency ON planning_reserves(currency_code) WHERE is_active;
CREATE INDEX planning_reserve_goal ON planning_reserves(goal_id) WHERE is_active AND goal_id IS NOT NULL;
CREATE INDEX planning_reserve_obligation ON planning_reserves(obligation_id) WHERE is_active AND obligation_id IS NOT NULL;
CREATE INDEX planning_obligation_due ON planning_obligations(currency_code,due_on) WHERE status='open';

CREATE FUNCTION guard_planning_record() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Planning history cannot be deleted'; END IF;
  IF TG_OP='UPDATE' AND (NEW.id<>OLD.id OR NEW.currency_code<>OLD.currency_code OR NEW.kind<>OLD.kind) THEN
    RAISE EXCEPTION 'Planning identity, currency and kind are immutable';
  END IF;
  IF TG_TABLE_NAME='planning_budgets' THEN
    IF NEW.category_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM transaction_categories WHERE id=NEW.category_id AND applies_to='expense'
    ) THEN RAISE EXCEPTION 'Budget category must apply to expenses'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER planning_budget_guard BEFORE INSERT OR UPDATE OR DELETE ON planning_budgets FOR EACH ROW EXECUTE FUNCTION guard_planning_record();
CREATE TRIGGER planning_goal_guard BEFORE INSERT OR UPDATE OR DELETE ON planning_goals FOR EACH ROW EXECUTE FUNCTION guard_planning_record();
CREATE TRIGGER planning_reserve_guard BEFORE INSERT OR UPDATE OR DELETE ON planning_reserves FOR EACH ROW EXECUTE FUNCTION guard_planning_record();
CREATE TRIGGER planning_obligation_guard BEFORE INSERT OR UPDATE OR DELETE ON planning_obligations FOR EACH ROW EXECUTE FUNCTION guard_planning_record();

CREATE FUNCTION guard_planning_label() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' AND OLD.system_key IS NOT NULL THEN RAISE EXCEPTION 'Built-in planning label cannot be deleted'; END IF;
  IF TG_OP='UPDATE' AND (NEW.kind<>OLD.kind OR NEW.system_key IS DISTINCT FROM OLD.system_key) THEN RAISE EXCEPTION 'Planning label identity is immutable'; END IF;
  IF TG_OP='UPDATE' AND OLD.system_key IS NOT NULL AND (NEW.display_name<>OLD.display_name OR NEW.is_active<>OLD.is_active) THEN RAISE EXCEPTION 'Built-in planning label cannot be changed'; END IF;
  RETURN COALESCE(NEW,OLD);
END $$;
CREATE TRIGGER planning_label_guard BEFORE UPDATE OR DELETE ON planning_labels FOR EACH ROW EXECUTE FUNCTION guard_planning_label();
