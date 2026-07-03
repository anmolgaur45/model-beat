-- Sync find_nearest_article with the version the pipeline actually calls
-- (pipeline/migrations/schema.sql): adds window_end for article-relative
-- time-bounded search. Without this, a DB provisioned from these migrations
-- (pnpm db:reset) only has the 4-arg overload and every clustering query fails.
-- window_start = article.published_at - 48h, window_end = article.published_at + 48h.
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

-- Drop the superseded 4-arg overload so the two don't coexist ambiguously.
DROP FUNCTION IF EXISTS find_nearest_article(VECTOR(384), UUID, TIMESTAMPTZ, FLOAT);
