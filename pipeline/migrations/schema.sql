-- Enable pgvector extension for semantic similarity search
CREATE EXTENSION IF NOT EXISTS vector;

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
  embedding      VECTOR(384),
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
  article_count       INT DEFAULT 1,
  summary             TEXT,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE articles
  ADD CONSTRAINT fk_cluster
  FOREIGN KEY (cluster_id) REFERENCES clusters(id)
  ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_articles_published_at ON articles (published_at DESC);
CREATE INDEX IF NOT EXISTS idx_articles_cluster_id   ON articles (cluster_id);
CREATE INDEX IF NOT EXISTS idx_clusters_published_at ON clusters (first_published_at DESC);
CREATE INDEX IF NOT EXISTS idx_clusters_category     ON clusters (category);
-- Add significance_base to articles for use during clustering (Phase 2)
ALTER TABLE articles ADD COLUMN IF NOT EXISTS significance_base FLOAT DEFAULT 0;
-- HNSW index on article embeddings for fast approximate nearest-neighbor search
-- Used by Phase 2 clustering (cosine distance queries)
CREATE INDEX IF NOT EXISTS idx_articles_embedding
  ON articles USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
-- RPC function for pgvector nearest-neighbor lookup
-- Used by Phase 2 clustering to find similar articles within a time window
CREATE OR REPLACE FUNCTION find_nearest_article(
  query_embedding VECTOR(384),
  exclude_id       UUID,
  window_start     TIMESTAMPTZ,
  distance_threshold FLOAT DEFAULT 0.15
)
RETURNS TABLE (
  id          UUID,
  cluster_id  UUID,
  title       TEXT,
  distance    FLOAT
)
LANGUAGE SQL STABLE
AS $$
  SELECT
    a.id,
    a.cluster_id,
    a.title,
    (a.embedding <=> query_embedding)::FLOAT AS distance
  FROM articles a
  WHERE
    a.published_at >= window_start
    AND a.embedding IS NOT NULL
    AND a.id != exclude_id
    AND (a.embedding <=> query_embedding) < distance_threshold
  ORDER BY a.embedding <=> query_embedding
  LIMIT 1;
$$;
ALTER TABLE articles ADD COLUMN IF NOT EXISTS impact_score INTEGER DEFAULT NULL;
-- Phase 4: Full-text search on cluster headlines.
-- Generated column keeps tsvector automatically in sync with headline changes.
-- GIN index supports the @@ operator efficiently.

ALTER TABLE clusters
  ADD COLUMN IF NOT EXISTS headline_tsv TSVECTOR
    GENERATED ALWAYS AS (to_tsvector('english', headline)) STORED;

CREATE INDEX IF NOT EXISTS idx_clusters_headline_fts
  ON clusters USING GIN (headline_tsv);
-- Update find_nearest_article to return multiple candidates (up to 10)
-- and accept window_end for article-relative time-bounded search.
-- window_start = article.published_at - 48h, window_end = article.published_at + 48h
-- This lets late-ingested articles still cluster with contemporaneous articles,
-- and naturally prevents cross-temporal contamination (old articles only find old neighbors).
CREATE OR REPLACE FUNCTION find_nearest_article(
  query_embedding VECTOR(384),
  exclude_id       UUID,
  window_start     TIMESTAMPTZ,
  distance_threshold FLOAT DEFAULT 0.15,
  window_end       TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE (
  id          UUID,
  cluster_id  UUID,
  title       TEXT,
  distance    FLOAT
)
LANGUAGE SQL STABLE
AS $$
  SELECT
    a.id,
    a.cluster_id,
    a.title,
    (a.embedding <=> query_embedding)::FLOAT AS distance
  FROM articles a
  WHERE
    a.published_at >= window_start
    AND (window_end IS NULL OR a.published_at <= window_end)
    AND a.embedding IS NOT NULL
    AND a.id != exclude_id
    AND (a.embedding <=> query_embedding) < distance_threshold
  ORDER BY a.embedding <=> query_embedding
  LIMIT 10;
$$;

-- Phase K: model registry (Epoch AI–backed, CC BY). Canonical models released
-- in the last year with their benchmark scores; existing news clusters link in
-- as "in the news" coverage. Populated by the pipeline's model_registry step.
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
ALTER TABLE models ADD COLUMN IF NOT EXISTS price_in          FLOAT;  -- USD per 1M input tokens
ALTER TABLE models ADD COLUMN IF NOT EXISTS price_out         FLOAT;  -- USD per 1M output tokens
ALTER TABLE models ADD COLUMN IF NOT EXISTS context_window    INT;
ALTER TABLE models ADD COLUMN IF NOT EXISTS input_modalities  TEXT;
ALTER TABLE models ADD COLUMN IF NOT EXISTS output_modalities TEXT;
