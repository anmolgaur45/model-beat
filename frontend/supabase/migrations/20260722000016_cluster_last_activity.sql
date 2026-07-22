-- Timeline grouping by latest activity (2026-07-22). The homepage dates a story
-- by its most recent article (a developing multi-day story surfaces on the day
-- its coverage is active), while /day/[date] permalinks stay on first_published_at
-- for a stable SEO archive. last_activity_at = MAX(member published_at), maintained
-- by the pipeline alongside first_published_at (MIN).
ALTER TABLE clusters ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ;

UPDATE clusters c SET last_activity_at = COALESCE(
  (SELECT MAX(a.published_at) FROM articles a WHERE a.cluster_id = c.id),
  c.first_published_at
) WHERE last_activity_at IS NULL;

ALTER TABLE clusters ALTER COLUMN last_activity_at SET DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_clusters_last_activity ON clusters (last_activity_at DESC);
