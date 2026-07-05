-- Model change events (price, context window; later deprecations/API changes),
-- detected by the pipeline diffing OpenRouter data before overwriting it.
-- Feeds the digest "model moves" section and, later, a model-page changelog
-- and Stack Watch alerts.
CREATE TABLE IF NOT EXISTS model_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id    UUID NOT NULL REFERENCES models(id) ON DELETE CASCADE,
  event_type  TEXT NOT NULL,  -- price | context | deprecation | rate-limit | api-change | catalog
  summary     TEXT NOT NULL,
  old_value   TEXT,
  new_value   TEXT,
  source_url  TEXT,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS model_events_detected_idx ON model_events (detected_at DESC);
CREATE INDEX IF NOT EXISTS model_events_model_idx ON model_events (model_id);
