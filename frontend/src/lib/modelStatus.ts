// Models that are no longer available for use (withdrawn / access pulled). They
// stay in the registry for historical and benchmark reference, but are excluded
// from "which model should I use" surfaces like the homepage top-models band.
//
// This is a manual, code-side list on purpose: the pipeline re-syncs the models
// table from Epoch/OpenRouter every run (which would clobber a DB flag), and that
// data has no reliable availability signal to derive this from. Availability
// withdrawal is an editorial call, so it lives here and survives syncs.
export const UNAVAILABLE_MODEL_SLUGS = new Set<string>([
  // (empty) — Fable 5 access was restored 2026-06-30.
])

export function isModelAvailable(slug: string): boolean {
  return !UNAVAILABLE_MODEL_SLUGS.has(slug)
}
