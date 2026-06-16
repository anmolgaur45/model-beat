-- AI summaries (Phase J): one original 1-2 sentence synthesis per cluster,
-- generated from member articles by Gemini 3.1 Flash-Lite in the pipeline.
ALTER TABLE clusters ADD COLUMN IF NOT EXISTS summary TEXT;
