-- Speed history: median throughput + time-to-first-token per model, appended
-- (daily-gated) from the Artificial Analysis payload the pipeline already
-- fetches. Recording starts now so future charts can answer "did speed shift
-- alongside the price change" (capacity signal vs margin adjustment).
CREATE TABLE IF NOT EXISTS model_speed_history (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id          UUID NOT NULL REFERENCES models(id) ON DELETE CASCADE,
  tokens_per_second FLOAT,
  ttft_seconds      FLOAT,
  captured_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_speed_history_model_time
  ON model_speed_history (model_id, captured_at DESC);
