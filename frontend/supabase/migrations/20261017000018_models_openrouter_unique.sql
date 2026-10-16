-- One registry row per OpenRouter model (2026-10-17). Two Qwen models each had two
-- rows sharing an openrouter_id, so each showed up as two model pages with different
-- prices. sync_pricing sets openrouter_id by join key; a second row with the same
-- key now fails that update and logs pricing.update_failed instead of forking a page.
-- Applied to production with CREATE UNIQUE INDEX CONCURRENTLY after the duplicates
-- were merged. NULLs stay allowed (models without an OpenRouter listing).
CREATE UNIQUE INDEX IF NOT EXISTS models_openrouter_id_key ON models (openrouter_id);
