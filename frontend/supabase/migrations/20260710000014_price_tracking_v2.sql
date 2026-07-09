-- Phase U: price tracking v2 (per-provider, debounced).
-- The OpenRouter model-level price is a noisy blend of the third-party provider
-- spread; tracking it produced misleading "price change" events (GLM-5.2, digest #1).
-- The pipeline now sweeps /endpoints on a rolling subset and tracks two prices:
--   vendor_price_in/out  = the first-party provider's list price (real news when it moves)
--   price_in/out         = cheapest CREDIBLE provider (no promos, no degraded providers,
--                          no sub-fp8 quants, no < 50%-of-native context), the honest
--                          "floor to run it on OpenRouter"
ALTER TABLE models ADD COLUMN IF NOT EXISTS vendor_price_in     FLOAT;  -- USD per 1M input tokens
ALTER TABLE models ADD COLUMN IF NOT EXISTS vendor_price_out    FLOAT;  -- USD per 1M output tokens
ALTER TABLE models ADD COLUMN IF NOT EXISTS floor_provider      TEXT;   -- provider serving the floor
ALTER TABLE models ADD COLUMN IF NOT EXISTS floor_quant         TEXT;   -- its quantization (fp8, bf16, ...)
ALTER TABLE models ADD COLUMN IF NOT EXISTS floor_context       INT;    -- its context length
-- Rolling-subset cursor: each pipeline run sweeps the N oldest-synced models.
ALTER TABLE models ADD COLUMN IF NOT EXISTS endpoints_synced_at TIMESTAMPTZ;
-- Debounce buffer: candidate values seen once but not yet confirmed by a second
-- consecutive sample. NULL = never endpoint-synced (first sync attaches without
-- events); '{}' = synced, nothing pending.
ALTER TABLE models ADD COLUMN IF NOT EXISTS pending_prices      JSONB;

-- Price events carry which price moved: 'vendor' (a real lab reprice) vs 'floor'
-- (cheapest-provider churn), so downstream surfaces can filter honestly.
ALTER TABLE model_events ADD COLUMN IF NOT EXISTS price_scope TEXT;
