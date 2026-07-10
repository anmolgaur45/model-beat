// Canonical story ordering: significance score, then deterministic tie-breaks
// so the hero "top story" slot is decided by the data, never by Postgres row
// order (before this, equal-score days could flip their hero between ISR
// revalidations). Ties break toward breadth of coverage (the formula's own
// dominant signal), then the LLM impact rating, then recency.

export interface RankableStory {
  significance_score?: number | null
  source_count?: number
  max_impact?: number | null
  first_published_at: string
}

export function bySignificance(a: RankableStory, b: RankableStory): number {
  const score = (b.significance_score ?? 0) - (a.significance_score ?? 0)
  if (score !== 0) return score
  const sources = (b.source_count ?? 0) - (a.source_count ?? 0)
  if (sources !== 0) return sources
  const impact = (b.max_impact ?? 0) - (a.max_impact ?? 0)
  if (impact !== 0) return impact
  return new Date(b.first_published_at).getTime() - new Date(a.first_published_at).getTime()
}
