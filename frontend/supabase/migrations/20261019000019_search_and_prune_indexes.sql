-- Search speed + embedding prune/pending (2026-10-18/19). Applied to production with
-- CREATE INDEX CONCURRENTLY; mirrored in pipeline/migrations/schema.sql.

-- Search's "source_name ILIKE ANY" match read the whole articles heap on every
-- search ("claude" took 1.8-2.6 s cold). A trigram index answers it in 10-50 ms.
-- Patterns under 3 letters ("ai") have no trigrams and stay on the published_at
-- index, which stops early at the 500-row limit.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_articles_source_name_trgm
  ON articles USING gin (source_name gin_trgm_ops);

-- prune_old_embeddings ran a full scan every run; only ~25k rows keep a vector
-- (30-day retention), so this partial index stays under 1 MB.
CREATE INDEX IF NOT EXISTS idx_articles_embedded_published_at
  ON articles (published_at) WHERE embedding IS NOT NULL;

-- embed_pending walked all ~25k articles in the 30-day window to test
-- embedding IS NULL (1.6-3.2 s a run, even with nothing pending).
CREATE INDEX IF NOT EXISTS idx_articles_unembedded_published_at
  ON articles (published_at DESC) WHERE embedding IS NULL;

-- Query statistics. Cloud SQL already preloads the library; this exposes the view.
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- In production and pipeline/migrations/schema.sql since 2026-08-27, but never
-- added here: the day pages' "has real coverage" probe.
CREATE INDEX IF NOT EXISTS idx_articles_cluster_non_arxiv
  ON articles (cluster_id) WHERE source_name NOT LIKE 'arXiv%';
