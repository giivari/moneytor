-- 014_imports.sql
-- P7: Staged import batches and row-level traceability to financial_activities.

CREATE TABLE import_batches (
  id UUID PRIMARY KEY,
  file_name TEXT NOT NULL CHECK (char_length(btrim(file_name)) BETWEEN 1 AND 240),
  source_format TEXT NOT NULL CHECK (source_format IN ('csv', 'xlsx')),
  sheet_name TEXT CHECK (sheet_name IS NULL OR char_length(btrim(sheet_name)) BETWEEN 1 AND 120),
  file_sha256 CHAR(64) NOT NULL CHECK (file_sha256 ~ '^[0-9a-f]{64}$'),
  idempotency_key UUID NOT NULL UNIQUE,
  total_rows INTEGER NOT NULL CHECK (total_rows >= 0),
  imported_count INTEGER NOT NULL CHECK (imported_count >= 0),
  skipped_count INTEGER NOT NULL CHECK (skipped_count >= 0),
  created_categories_count INTEGER NOT NULL DEFAULT 0 CHECK (created_categories_count >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (imported_count + skipped_count <= total_rows)
);

CREATE INDEX import_batches_created_idx ON import_batches (created_at DESC, id DESC);

CREATE TABLE import_batch_rows (
  id UUID PRIMARY KEY,
  batch_id UUID NOT NULL REFERENCES import_batches(id) ON DELETE RESTRICT,
  row_number INTEGER NOT NULL CHECK (row_number >= 1),
  row_fingerprint CHAR(64) NOT NULL CHECK (row_fingerprint ~ '^[0-9a-f]{64}$'),
  outcome TEXT NOT NULL CHECK (outcome IN ('imported', 'skipped_duplicate', 'skipped_user')),
  activity_id UUID REFERENCES financial_activities(id) ON DELETE RESTRICT,
  summary_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (batch_id, row_number),
  CHECK (jsonb_typeof(summary_json) = 'object'),
  CHECK (
    (outcome = 'imported' AND activity_id IS NOT NULL)
    OR (outcome <> 'imported' AND activity_id IS NULL)
  )
);

CREATE INDEX import_batch_rows_fingerprint_idx ON import_batch_rows (row_fingerprint) WHERE outcome = 'imported';
CREATE INDEX import_batch_rows_activity_idx ON import_batch_rows (activity_id) WHERE activity_id IS NOT NULL;

CREATE TRIGGER protect_import_batches_mutation
BEFORE UPDATE OR DELETE ON import_batches
FOR EACH ROW EXECUTE FUNCTION reject_posted_finance_rewrite();

CREATE TRIGGER protect_import_batch_rows_mutation
BEFORE UPDATE OR DELETE ON import_batch_rows
FOR EACH ROW EXECUTE FUNCTION reject_posted_finance_rewrite();

