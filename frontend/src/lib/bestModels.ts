import type { Model } from '@/types/article'
import { BUCKETS, type BucketKey } from './modelBuckets'

// "Best [use case] model" landing pages (SEO Workstream C). Each view re-ranks
// the registry by a single lens and targets a high-intent query like
// "best AI model for coding". The rankings are computed live from the same
// benchmark/pricing data as the leaderboard, so they stay current automatically.

export type BestKey = BucketKey | 'overall' | 'value'

export interface BestView {
  key: BestKey
  noun: string // "coding", "value", ...
  heading: string // <h1>
  titleBase: string // meta title (year appended at render time)
  methodology: string // how the ranking is computed
}

const benchList = (key: BucketKey): string => {
  const b = BUCKETS.find((x) => x.key === key)!
  return b.benchmarks.slice(0, 4).join(', ')
}

export const BEST_VIEWS: BestView[] = [
  {
    key: 'overall',
    noun: 'overall',
    heading: 'Best AI models, ranked by capability',
    titleBase: 'Best AI Models, Ranked',
    methodology: "Ranked by Epoch AI's Capabilities Index (ECI), an aggregate score of each model's measured capability across standardized evaluations.",
  },
  {
    key: 'coding',
    noun: 'coding',
    heading: 'Best AI models for coding',
    titleBase: 'Best AI Models for Coding',
    methodology: `Ranked by a 0–100 composite of coding benchmarks (${benchList('coding')}), scored as percentile rank against every model released in the past year.`,
  },
  {
    key: 'math',
    noun: 'math',
    heading: 'Best AI models for math',
    titleBase: 'Best AI Models for Math',
    methodology: `Ranked by a 0–100 composite of math benchmarks (${benchList('math')}), scored as percentile rank against every model released in the past year.`,
  },
  {
    key: 'reasoning',
    noun: 'reasoning',
    heading: 'Best AI models for reasoning',
    titleBase: 'Best AI Models for Reasoning',
    methodology: `Ranked by a 0–100 composite of reasoning and knowledge benchmarks (${benchList('reasoning')}), scored as percentile rank against every model released in the past year.`,
  },
  {
    key: 'agentic',
    noun: 'agentic tasks',
    heading: 'Best AI models for agentic tasks',
    titleBase: 'Best AI Models for Agentic Tasks',
    methodology: `Ranked by a 0–100 composite of agentic and tool-use benchmarks (${benchList('agentic')}), scored as percentile rank against every model released in the past year.`,
  },
  {
    key: 'value',
    noun: 'value',
    heading: 'Best value AI models',
    titleBase: 'Best Value AI Models — Intelligence per Dollar',
    methodology: "Ranked by intelligence per dollar — Epoch's Capabilities Index divided by blended token price (the average of input and output $/M). Higher means more capability per dollar.",
  },
]

export const bestView = (key: string): BestView | undefined => BEST_VIEWS.find((v) => v.key === key)

export interface Ranked {
  model: Model
  value: number
  label: string
}

function usd(n: number | null): string {
  if (n == null) return '—'
  return n % 1 === 0 ? `$${n}` : `$${n.toFixed(2)}`
}

// The cheapest model among the strongest — a recurring "best value" question.
function cheapestStrong(ranked: Ranked[]): Ranked | null {
  const pool = ranked.slice(0, 10).filter((r) => r.model.price_in != null)
  if (pool.length === 0) return null
  return pool.reduce((best, r) => (r.model.price_in! < best.model.price_in! ? r : best))
}

// Data-driven Q&A for a ranking view → on-page FAQ + FAQPage schema.
export function buildFaq(view: BestView, ranked: Ranked[]): { q: string; a: string }[] {
  if (ranked.length === 0) return []
  const faq: { q: string; a: string }[] = []
  const top = ranked[0]
  const runners = ranked.slice(1, 3).map((r) => r.model.name)
  faq.push({
    q: `What is the best AI model for ${view.noun}?`,
    a: `${top.model.name} (${top.model.vendor ?? 'unknown vendor'}) currently ranks first for ${view.noun} on Model Beat${runners.length ? `, followed by ${runners.join(' and ')}` : ''}. ${view.methodology}`,
  })
  if (view.key !== 'value') {
    const cheap = cheapestStrong(ranked)
    if (cheap) {
      faq.push({
        q: `Which is the most affordable strong ${view.noun} model?`,
        a: `Among the top-ranked ${view.noun} models, ${cheap.model.name} is the cheapest at ${usd(cheap.model.price_in)} per million input tokens.`,
      })
    }
  }
  faq.push({ q: `How are these ${view.noun} rankings calculated?`, a: view.methodology })
  return faq
}

// Rank the registry for a given lens, best first. Models lacking the relevant
// data are dropped (no empty rows).
export function rankModels(models: Model[], key: BestKey): Ranked[] {
  const scored: Ranked[] = []
  for (const m of models) {
    if (key === 'overall') {
      if (m.headline_score == null) continue
      scored.push({ model: m, value: m.headline_score, label: `${Math.round(m.headline_score)}` })
    } else if (key === 'value') {
      const eci = m.headline_score
      if (eci == null || m.price_in == null || m.price_out == null) continue
      const blended = (m.price_in + m.price_out) / 2
      if (blended <= 0) continue
      const v = eci / blended
      scored.push({ model: m, value: v, label: v.toFixed(1) })
    } else {
      const v = m.buckets?.[key]
      if (v == null) continue
      scored.push({ model: m, value: v, label: `${v}` })
    }
  }
  return scored.sort((a, b) => b.value - a.value)
}
