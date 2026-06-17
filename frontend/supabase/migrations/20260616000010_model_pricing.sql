-- Phase O1: model pricing & specs from OpenRouter's public, no-auth model catalog.
-- Fills Epoch's gap (no pricing/context). Nullable — only models OpenRouter serves
-- (~half the registry) get these; the rest render "—".
ALTER TABLE models ADD COLUMN IF NOT EXISTS openrouter_id     TEXT;
ALTER TABLE models ADD COLUMN IF NOT EXISTS price_in          FLOAT;  -- USD per 1M input tokens
ALTER TABLE models ADD COLUMN IF NOT EXISTS price_out         FLOAT;  -- USD per 1M output tokens
ALTER TABLE models ADD COLUMN IF NOT EXISTS context_window    INT;
ALTER TABLE models ADD COLUMN IF NOT EXISTS input_modalities  TEXT;   -- comma-joined, e.g. 'text, image'
ALTER TABLE models ADD COLUMN IF NOT EXISTS output_modalities TEXT;
