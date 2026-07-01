-- Provenance for benchmark scores (Phase O5). Epoch stays authoritative; AA fills
-- gaps for models Epoch hasn't scored yet, and owns AA-only benchmarks. 'epoch' | 'aa'.
ALTER TABLE model_benchmarks ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'epoch';
