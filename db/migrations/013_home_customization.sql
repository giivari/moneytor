-- Presentation preferences only. No defaults, financial backfills or posting triggers.
CREATE TABLE home_layout_preferences (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton)
    REFERENCES app_owner_state(singleton),
  config jsonb NOT NULL CHECK (
    jsonb_typeof(config) = 'object'
    AND config ?& ARRAY['version','density','sections']
    AND jsonb_typeof(config->'version') = 'number'
    AND (config->>'version') ~ '^[1-9][0-9]*$'
    AND jsonb_typeof(config->'density') = 'string'
    AND jsonb_typeof(config->'sections') = 'array'
    AND jsonb_array_length(config->'sections') <= 32
    AND octet_length(config::text) <= 4096
  ),
  revision bigint NOT NULL CHECK (revision > 0),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
