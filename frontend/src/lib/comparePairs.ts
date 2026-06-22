import { cache } from 'react'
import sql from '@/lib/db'

// Curated "X vs Y" comparison pages (SEO Workstream A). We deliberately keep the
// indexable set small and high-intent — cross-vendor flagship match-ups plus a
// few "new vs landmark" pairs — rather than mass-generating every combination,
// which the 2026 core updates penalize as thin programmatic content. Each page
// still carries genuinely differentiated data (two models' real benchmarks +
// pricing), so it clears the quality floor.

export interface PairModel {
  slug: string
  name: string
  vendor: string | null
  eci: number | null
  news: number
}

export interface Pair {
  a: string
  b: string
}

// Collapse vendor-string variants to one lineage (so "Google" and
// "Google DeepMind" don't both field a flagship).
function normVendor(v: string | null): string {
  if (!v) return ''
  const s = v.toLowerCase()
  if (s.includes('google') || s.includes('deepmind')) return 'google'
  if (s.includes('zhipu') || s.includes('z.ai')) return 'zai'
  return s.split(/[\s(]/)[0]
}

// Canonical, order-independent key for a pair. Slugs never contain "-vs-", so
// this round-trips cleanly via split('-vs-').
export function pairKey(a: string, b: string): string {
  return [a, b].sort().join('-vs-')
}

// Well-benchmarked recent models with an Epoch Capabilities Index, plus how much
// news each has drawn (search-demand proxy).
const candidates = cache(async (): Promise<PairModel[]> => {
  const rows = await sql<{ slug: string; name: string; vendor: string | null; eci: number | null; news: number }[]>`
    SELECT m.slug, m.name, m.vendor,
      (SELECT eci.score FROM model_benchmarks eci
        WHERE eci.model_id = m.id AND eci.benchmark = 'Epoch Capabilities Index') AS eci,
      (SELECT count(*)::int FROM model_clusters mc WHERE mc.model_id = m.id) AS news
    FROM models m
    WHERE m.released_at >= now() - interval '1 year'
      AND (SELECT count(*) FROM model_benchmarks mb WHERE mb.model_id = m.id) >= 10
  `
  return rows.filter((m) => m.eci != null)
})

const MAX_VENDORS = 8 // cross-vendor flagship pairs = C(8,2) = 28
const LANDMARK_NEWS = 12 // a heavily-covered non-flagship earns a "new vs landmark" pair

// The flagship model of each curated vendor (highest ECI), capability-ranked.
export const flagshipModels = cache(async (): Promise<PairModel[]> => {
  const cands = await candidates()
  const byVendor = new Map<string, PairModel>()
  for (const m of cands) {
    const v = normVendor(m.vendor)
    const cur = byVendor.get(v)
    if (!cur || (m.eci ?? 0) > (cur.eci ?? 0)) byVendor.set(v, m)
  }
  return [...byVendor.values()].sort((a, b) => (b.eci ?? 0) - (a.eci ?? 0)).slice(0, MAX_VENDORS)
})

// The curated, indexable pair set.
export const comparePairs = cache(async (): Promise<Pair[]> => {
  const cands = await candidates()
  const flagships = await flagshipModels()
  const flagshipByVendor = new Map(flagships.map((m) => [normVendor(m.vendor), m]))
  const pairs = new Map<string, Pair>()

  // cross-vendor flagship match-ups
  for (let i = 0; i < flagships.length; i++) {
    for (let j = i + 1; j < flagships.length; j++) {
      const [a, b] = [flagships[i].slug, flagships[j].slug].sort()
      pairs.set(`${a}-vs-${b}`, { a, b })
    }
  }

  // "new vs landmark": a heavily-covered model vs its vendor's flagship
  for (const m of cands) {
    if (m.news < LANDMARK_NEWS) continue
    const fv = flagshipByVendor.get(normVendor(m.vendor))
    if (!fv || fv.slug === m.slug) continue
    const [a, b] = [m.slug, fv.slug].sort()
    pairs.set(`${a}-vs-${b}`, { a, b })
  }

  return [...pairs.values()]
})

// Set of canonical keys, for the pair page's indexable check.
export const comparePairKeys = cache(async (): Promise<Set<string>> => {
  const pairs = await comparePairs()
  return new Set(pairs.map((p) => `${p.a}-vs-${p.b}`))
})

// slug → display name for every model that can appear in a curated pair, so
// link lists can show real names instead of slugs.
export const pairModelNames = cache(async (): Promise<Map<string, string>> => {
  return new Map((await candidates()).map((m) => [m.slug, m.name]))
})
