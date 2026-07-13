// Phase W: pure helpers for the digest teaser (the floating signup card + the
// /digest live section). Kept out of the router so Vitest can cover the
// delta/tone/state/row-composition logic without a DB.

import type { DigestTeaserEvent, TeaserRow } from '@/types/article'

export type TeaserTone = 'good' | 'bad' | 'neutral'

// Importance order: vendor repricing is the headline event class, then the
// credible floor, then benchmark movement, context bumps, and finally
// new-model catalog rows. Ties break by recency (in the caller).
export function eventRank(eventType: string, priceScope: string | null): number {
  if (eventType === 'price') return priceScope === 'vendor' ? 0 : 1
  if (eventType === 'benchmark') return 2
  if (eventType === 'context') return 3
  if (eventType === 'catalog') return 4
  return 5
}

// Signed relative change from the event's old/new values (model_registry writes
// them as plain numeric strings). Tone is builder-semantic: a price DROP is
// good, a price RISE is bad; benchmark/context UP is good. Catalog events and
// unparseable values get no chip.
export function eventDelta(
  eventType: string,
  oldValue: string | null,
  newValue: string | null,
): { delta: string | null; tone: TeaserTone } {
  const o = oldValue == null ? NaN : Number(oldValue)
  const n = newValue == null ? NaN : Number(newValue)
  if (!Number.isFinite(o) || !Number.isFinite(n) || o <= 0 || n < 0) {
    return { delta: null, tone: 'neutral' }
  }
  const pct = ((n - o) / o) * 100
  if (pct === 0) return { delta: null, tone: 'neutral' }
  const delta = `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`
  const up = pct > 0
  if (eventType === 'price') return { delta, tone: up ? 'bad' : 'good' }
  if (eventType === 'benchmark' || eventType === 'context') {
    return { delta, tone: up ? 'good' : 'bad' }
  }
  return { delta, tone: 'neutral' }
}

// Floor prices are third-party marketplaces doing what marketplaces do, so
// only moves a builder would repeat to a colleague earn a card row (Kimi -31%
// yes, GLM-4.6 +9% no). Vendor list price, benchmark, and context events are
// exempt: rare and deliberate means news at any size. A floor event whose
// values can't prove materiality is dropped. (Locked rules, 2026-07-13.)
export const FLOOR_MATERIALITY_MIN_PCT = 15

export function isMaterialMove(
  eventType: string,
  priceScope: string | null,
  oldValue: string | null,
  newValue: string | null,
): boolean {
  if (eventType !== 'price' || priceScope !== 'floor') return true
  const o = oldValue == null ? NaN : Number(oldValue)
  const n = newValue == null ? NaN : Number(newValue)
  if (!Number.isFinite(o) || !Number.isFinite(n) || o <= 0) return false
  return Math.abs(((n - o) / o) * 100) >= FLOOR_MATERIALITY_MIN_PCT
}

// "GPT-5.6 Sol (OpenAI) added to the tracker." — the vendor paren is dead
// weight on a one-line row.
export function stripVendorParen(summary: string, vendor: string | null | undefined): string {
  return vendor ? summary.replace(` (${vendor})`, '') : summary
}

// A "cheapest credible provider" fact from the registry (Phase U data nobody
// else surfaces). Fed to composeRows so the card has an insider hook even in
// weeks with no movement events — top stories alone are things a visitor
// already knows, which is no reason to subscribe.
export interface FloorFact {
  slug: string
  name: string
  price_in: number // credible floor $/M input
  vendor_price_in: number // first-party list $/M input
  floor_provider: string
}

export function floorFactRow(f: FloorFact): TeaserRow | null {
  if (!(f.vendor_price_in > 0) || !(f.price_in > 0) || f.price_in >= f.vendor_price_in) return null
  const pct = Math.round((1 - f.price_in / f.vendor_price_in) * 100)
  if (pct < 20) return null // small spreads aren't a hook
  const price = f.price_in < 10 ? f.price_in.toFixed(2) : f.price_in.toFixed(0)
  // The chip carries the discount; the text stays short enough to fit the card.
  return {
    key: `floor-${f.slug}`,
    kind: 'event',
    text: `${f.name}: $${price}/M via ${f.floor_provider}`,
    chip: `-${pct}%`,
    tone: 'good',
    href: `/models/${f.slug}`,
  }
}

// Compose the card's rows from ranked events + top stories. Design rules
// (from the 2026-07-10 review): a burst of same-vendor catalog events reads
// as spam, so 2+ catalog entries collapse into one grouped line; and the card
// always mixes in at least one top story when available, so it never shows
// three near-identical lines about a single launch everyone already knows.
export function composeRows(
  events: DigestTeaserEvent[],
  stories: { id: string; headline: string }[],
  fact: TeaserRow | null = null,
  max = 3,
): TeaserRow[] {
  const rows: TeaserRow[] = []
  const catalogs = events.filter((e) => e.event_type === 'catalog')
  const moves = events.filter((e) => e.event_type !== 'catalog')

  // Real movement first (already ranked by the caller): price, benchmark,
  // context. Reserve one slot for a story when stories exist. One row per
  // model: sync_pricing emits separate input/output (and vendor/floor) events
  // for what a reader sees as one repricing, so the best-ranked event speaks
  // for the model and the rest are the same news twice (Anmol caught two Kimi
  // K2.5 floor rows side by side, 2026-07-11).
  const eventCap = stories.length > 0 ? max - 1 : max
  const seenModels = new Set<string>()
  // Type-variety preference (2026-07-13 amendment): after the top-ranked row,
  // prefer an event of a type not yet shown (price + benchmark reads richer
  // than price + price). Preference, not rule — same-type rows remain when
  // that's all that moved. Rank order still decides within each choice.
  const usedTypes = new Set<string>()
  const remaining = [...moves]
  while (rows.length < eventCap && remaining.length > 0) {
    const eligible = remaining.filter((e) => !(e.model_slug && seenModels.has(e.model_slug)))
    if (eligible.length === 0) break
    const pick = eligible.find((e) => !usedTypes.has(e.event_type)) ?? eligible[0]
    remaining.splice(remaining.indexOf(pick), 1)
    if (pick.model_slug) seenModels.add(pick.model_slug)
    usedTypes.add(pick.event_type)
    rows.push({
      key: pick.id,
      kind: 'event',
      text: stripVendorParen(pick.summary, pick.model_vendor),
      chip: pick.delta,
      tone: pick.tone,
      href: pick.model_slug ? `/models/${pick.model_slug}` : undefined,
    })
  }

  // The registry fact slots in after real movement, before catalog filler —
  // unless a movement row already told this model's price story.
  if (fact && rows.length < eventCap && !(fact.href && seenModels.has(fact.href.replace('/models/', '')))) {
    rows.push(fact)
  }

  // Catalog: one collapsed line for the biggest vendor group, never a list of
  // near-identical "X added to the tracker" rows.
  if (catalogs.length > 0 && rows.length < eventCap) {
    if (catalogs.length === 1) {
      const c = catalogs[0]
      rows.push({
        key: c.id,
        kind: 'event',
        text: stripVendorParen(c.summary, c.model_vendor),
        chip: 'NEW',
        tone: 'neutral',
        href: c.model_slug ? `/models/${c.model_slug}` : undefined,
      })
    } else {
      const byVendor = new Map<string, DigestTeaserEvent[]>()
      for (const c of catalogs) {
        const key = c.model_vendor ?? 'various vendors'
        byVendor.set(key, [...(byVendor.get(key) ?? []), c])
      }
      const [vendor, group] = [...byVendor.entries()].sort((a, b) => b[1].length - a[1].length)[0]
      rows.push({
        key: group[0].id,
        kind: 'event',
        text:
          group.length > 1
            ? `${group.length} new ${vendor} models in the tracker`
            : `${catalogs.length} new models in the tracker`,
        chip: null,
        tone: 'neutral',
        href: '/models/changes',
      })
    }
  }

  // Fill with the week's top stories.
  for (const s of stories) {
    if (rows.length >= max) break
    rows.push({
      key: s.id,
      kind: 'story',
      text: s.headline,
      chip: null,
      tone: 'neutral',
      href: `/story/${s.id}`,
    })
  }

  return rows.slice(0, max)
}
