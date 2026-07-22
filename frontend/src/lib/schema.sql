-- ⚠️ STALE — do not provision a database from this file.
-- It predates impact_score, significance_base, headline_tsv/FTS,
-- find_nearest_article, pipeline_runs, and waitlist; the first frontend query
-- against a DB built from it fails. Canonical schema lives in
-- frontend/supabase/migrations/ (applied in order) and pipeline/migrations/schema.sql.

-- AI News Calendar — Initial Database Schema
-- Run in Supabase SQL Editor
-- Requires: Database → Extensions → enable "vector" (pgvector)

-- Raw ingested articles (pre-clustering)
CREATE TABLE IF NOT EXISTS articles (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title          TEXT NOT NULL,
  body_excerpt   TEXT,
  source_name    TEXT NOT NULL,
  source_url     TEXT NOT NULL UNIQUE,
  author         TEXT,
  published_at   TIMESTAMPTZ NOT NULL,
  raw_category   TEXT,
  embedding      VECTOR(384),  -- all-MiniLM-L6-v2 output; enable pgvector first
  cluster_id     UUID,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

-- Deduplicated story groups
CREATE TABLE IF NOT EXISTS clusters (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  headline            TEXT NOT NULL,
  category            TEXT DEFAULT 'uncategorized',
  significance_score  FLOAT DEFAULT 0,
  first_published_at  TIMESTAMPTZ NOT NULL,
  peak_date           DATE,
  article_count       INT DEFAULT 1,
  summary             TEXT,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- Foreign key: articles → clusters
ALTER TABLE articles
  ADD CONSTRAINT fk_cluster
  FOREIGN KEY (cluster_id) REFERENCES clusters(id)
  ON DELETE SET NULL;

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_articles_published_at  ON articles (published_at DESC);
CREATE INDEX IF NOT EXISTS idx_articles_cluster_id    ON articles (cluster_id);
CREATE INDEX IF NOT EXISTS idx_clusters_published_at  ON clusters (first_published_at DESC);
CREATE INDEX IF NOT EXISTS idx_clusters_peak_date ON clusters (peak_date DESC);
CREATE INDEX IF NOT EXISTS idx_clusters_category      ON clusters (category);

-- Approximate nearest-neighbor index for embedding similarity search (Phase 2)
-- Uncomment after pgvector is enabled and data is populated:
-- CREATE INDEX ON articles USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- Phase K: model registry (Epoch AI–backed, CC BY). Canonical models released
-- in the last year with their benchmark scores; news clusters link in as coverage.
CREATE TABLE IF NOT EXISTS models (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug            TEXT UNIQUE NOT NULL,
  epoch_key       TEXT UNIQUE,
  name            TEXT NOT NULL,
  vendor          TEXT,
  family          TEXT,
  released_at     TIMESTAMPTZ,
  parameters      TEXT,
  accessibility   TEXT,
  is_open_weight  BOOLEAN,
  description     TEXT,
  primary_url     TEXT,
  significance    FLOAT DEFAULT 0,
  first_seen_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS model_benchmarks (
  model_id    UUID REFERENCES models(id) ON DELETE CASCADE,
  benchmark   TEXT NOT NULL,
  score       FLOAT,
  unit        TEXT,
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

-- Phase O1: pricing & specs from OpenRouter's public model catalog (nullable).
ALTER TABLE models ADD COLUMN IF NOT EXISTS openrouter_id     TEXT;
ALTER TABLE models ADD COLUMN IF NOT EXISTS price_in          FLOAT;
ALTER TABLE models ADD COLUMN IF NOT EXISTS price_out         FLOAT;
ALTER TABLE models ADD COLUMN IF NOT EXISTS context_window    INT;
ALTER TABLE models ADD COLUMN IF NOT EXISTS input_modalities  TEXT;
ALTER TABLE models ADD COLUMN IF NOT EXISTS output_modalities TEXT;

-- Phase O5: benchmark provenance (epoch authoritative, aa fills gaps).
ALTER TABLE model_benchmarks ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'epoch';

-- Model change events (price, context window; later deprecations/API changes),
-- detected by sync_pricing diffing OpenRouter data before overwriting it.
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

-- Phase U: price tracking v2 (per-provider, debounced). vendor_price_* is the
-- first-party provider's list price from /endpoints; price_in/out becomes the
-- cheapest CREDIBLE provider (no promos/degraded/sub-fp8/short-context) for
-- endpoint-synced models. pending_prices is the debounce buffer (NULL = never
-- endpoint-synced; '{}' = synced, nothing pending). endpoints_synced_at is the
-- rolling-subset sweep cursor. price_scope: 'vendor' | 'floor' on price events.
ALTER TABLE models ADD COLUMN IF NOT EXISTS vendor_price_in     FLOAT;
ALTER TABLE models ADD COLUMN IF NOT EXISTS vendor_price_out    FLOAT;
ALTER TABLE models ADD COLUMN IF NOT EXISTS floor_provider      TEXT;
ALTER TABLE models ADD COLUMN IF NOT EXISTS floor_quant         TEXT;
ALTER TABLE models ADD COLUMN IF NOT EXISTS floor_context       INT;
ALTER TABLE models ADD COLUMN IF NOT EXISTS endpoints_synced_at TIMESTAMPTZ;
ALTER TABLE models ADD COLUMN IF NOT EXISTS pending_prices      JSONB;
ALTER TABLE model_events ADD COLUMN IF NOT EXISTS price_scope TEXT;

-- Speed history (2026-07-14): median throughput + TTFT per model from the
-- Artificial Analysis payload sync_aa_benchmarks already fetches, appended at
-- most once per ~day per model. Answers "did speed shift alongside the price
-- change" once history accrues (capacity signal vs margin adjustment).
CREATE TABLE IF NOT EXISTS model_speed_history (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id          UUID NOT NULL REFERENCES models(id) ON DELETE CASCADE,
  tokens_per_second FLOAT,
  ttft_seconds      FLOAT,
  captured_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_speed_history_model_time
  ON model_speed_history (model_id, captured_at DESC);
