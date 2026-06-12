CREATE TABLE IF NOT EXISTS pipeline_runs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ran_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  articles_ingested INT NOT NULL DEFAULT 0,
  clusters_updated  INT NOT NULL DEFAULT 0
);

-- only keep last 100 runs
CREATE INDEX IF NOT EXISTS idx_pipeline_runs_ran_at ON pipeline_runs (ran_at DESC);
