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
CREATE INDEX IF NOT EXISTS idx_clusters_category      ON clusters (category);

-- Approximate nearest-neighbor index for embedding similarity search (Phase 2)
-- Uncomment after pgvector is enabled and data is populated:
-- CREATE INDEX ON articles USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
