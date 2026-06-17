-- Phase K: model registry (Epoch AI–backed, CC BY). Canonical models released
-- in the last year with their benchmark scores; existing news clusters link in
-- as "in the news" coverage. Populated by the pipeline's model_registry step.
CREATE TABLE IF NOT EXISTS models (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug            TEXT UNIQUE NOT NULL,          -- canonical URL id, e.g. 'claude-opus-4-8'
  epoch_key       TEXT UNIQUE,                   -- Epoch model name; the sync upsert key
  name            TEXT NOT NULL,                 -- display name, e.g. 'Claude Opus 4.8'
  vendor          TEXT,                          -- Epoch "Organization"
  family          TEXT,                          -- derived: 'GPT','Claude','Gemini','Llama'...
  released_at     TIMESTAMPTZ,                   -- Epoch "Publication date"
  parameters      TEXT,                          -- human-readable, e.g. '3T', '70B'
  accessibility   TEXT,                          -- Epoch: 'API access','Open weights...','Unreleased'
  is_open_weight  BOOLEAN,                       -- derived from "Open model weights?" (nullable)
  description     TEXT,                          -- short neutral synthesis (nullable)
  primary_url     TEXT,                          -- Epoch "Link" (source/announcement)
  significance    FLOAT DEFAULT 0,               -- max significance across linked news clusters
  first_seen_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS model_benchmarks (
  model_id    UUID REFERENCES models(id) ON DELETE CASCADE,
  benchmark   TEXT NOT NULL,                     -- 'ECI','GPQA Diamond','SWE-bench Verified'...
  score       FLOAT,                             -- native scale (fraction for %, raw for ECI)
  unit        TEXT,                              -- '%' or 'index'
  PRIMARY KEY (model_id, benchmark)
);

CREATE TABLE IF NOT EXISTS model_clusters (
  model_id    UUID REFERENCES models(id) ON DELETE CASCADE,
  cluster_id  UUID REFERENCES clusters(id) ON DELETE CASCADE,
  PRIMARY KEY (model_id, cluster_id)
);

CREATE INDEX IF NOT EXISTS idx_models_released         ON models (released_at DESC);
CREATE INDEX IF NOT EXISTS idx_model_benchmarks_model  ON model_benchmarks (model_id);
CREATE INDEX IF NOT EXISTS idx_model_clusters_model    ON model_clusters (model_id);
