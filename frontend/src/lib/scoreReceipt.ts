// "Why this score" inputs, computed server-side over ALL cluster members and
// rendered by the score badge's receipt popover. Plain module (no 'use client')
// so both server components (story page) and client cards can build receipts.

export interface ScoreReceipt {
  articleCount: number
  sourceCount: number
  topSources: string[] // authority-ordered; first 3 shown
  maxImpact: number | null // highest LLM impact rating in the cluster, 1-10
}

// The 1-10 LLM impact rating rendered as a claim the reader can sanity-check
// against the headline. Never show the raw number: it's an internal multiplier,
// and a second number invites arithmetic the popover can't explain.
export function impactTier(n: number): string {
  if (n >= 9) return 'landmark'
  if (n >= 7) return 'major development'
  if (n >= 5) return 'notable'
  return 'routine coverage'
}

// Builds a receipt from the cluster shape the cards already receive. Falls back
// gracefully when the server hasn't sent the computed fields (e.g. search rows).
export function receiptFromCluster(c: {
  article_count: number
  source_count?: number
  max_impact?: number | null
  articles?: { source_name: string }[]
}): ScoreReceipt {
  const carried = c.articles ?? []
  return {
    articleCount: c.article_count,
    sourceCount: c.source_count ?? new Set(carried.map((a) => a.source_name)).size,
    // unique outlet names (two articles from one outlet must not read twice)
    topSources: [...new Set(carried.map((a) => a.source_name))].slice(0, 3),
    maxImpact: c.max_impact ?? null,
  }
}
