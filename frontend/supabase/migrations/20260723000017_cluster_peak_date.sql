-- Timeline grouping by PEAK coverage day (2026-07-23), replacing last_activity_at.
-- Grouping by newest article pulled any old story to "today" on a single straggler
-- (Kimi K3: 105 articles on Jul 17 but 12 stragglers on Jul 22 dragged it to the
-- 22nd). peak_date = the calendar day a story got the MOST coverage = "the day it
-- was the biggest story". A straggler can't outweigh the original burst; a genuine
-- resurgence (Hugging Face's reveal peaking on its 3rd day) does surface. Ties -> the
-- earliest day (deterministic; articles only accrete, so peak_date never oscillates).
-- /day/[date] permalinks still use first_published_at (stable SEO archive).
ALTER TABLE clusters DROP COLUMN IF EXISTS last_activity_at;
DROP INDEX IF EXISTS idx_clusters_last_activity;

ALTER TABLE clusters ADD COLUMN IF NOT EXISTS peak_date DATE;

UPDATE clusters c SET peak_date = COALESCE(
  (SELECT a.published_at::date
   FROM articles a WHERE a.cluster_id = c.id
   GROUP BY a.published_at::date
   ORDER BY count(*) DESC, a.published_at::date ASC
   LIMIT 1),
  c.first_published_at::date
) WHERE peak_date IS NULL;

CREATE INDEX IF NOT EXISTS idx_clusters_peak_date ON clusters (peak_date DESC);
