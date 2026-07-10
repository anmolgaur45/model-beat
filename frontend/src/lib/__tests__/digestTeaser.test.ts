import { describe, expect, it } from 'vitest'
import { composeRows, eventDelta, eventRank, floorFactRow } from '../digestTeaser'
import type { DigestTeaserEvent } from '@/types/article'

function ev(over: Partial<DigestTeaserEvent>): DigestTeaserEvent {
  return {
    id: over.id ?? Math.random().toString(36).slice(2),
    event_type: 'price',
    price_scope: 'vendor',
    summary: 'Model X: input price changed',
    detected_at: '2026-07-10T00:00:00Z',
    model_vendor: 'OpenAI',
    delta: null,
    tone: 'neutral',
    ...over,
  }
}

describe('eventRank', () => {
  it('orders vendor price first, then floor, benchmark, context, catalog', () => {
    const ranks = [
      eventRank('price', 'vendor'),
      eventRank('price', 'floor'),
      eventRank('benchmark', null),
      eventRank('context', null),
      eventRank('catalog', null),
    ]
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b))
    expect(new Set(ranks).size).toBe(ranks.length)
  })

  it('ranks unknown event types last', () => {
    expect(eventRank('deprecation', null)).toBeGreaterThan(eventRank('catalog', null))
  })
})

describe('eventDelta', () => {
  it('marks a price rise as bad with a signed one-decimal delta', () => {
    // GLM-5.2's quiet reprice: 0.57 -> 0.90 per 1M input
    expect(eventDelta('price', '0.57', '0.9')).toEqual({ delta: '+57.9%', tone: 'bad' })
  })

  it('marks a price drop as good', () => {
    expect(eventDelta('price', '2', '1.5')).toEqual({ delta: '-25.0%', tone: 'good' })
  })

  it('marks a benchmark rise as good and a fall as bad', () => {
    expect(eventDelta('benchmark', '68.2', '74.1')).toEqual({ delta: '+8.7%', tone: 'good' })
    expect(eventDelta('benchmark', '74.1', '68.2')).toEqual({ delta: '-8.0%', tone: 'bad' })
  })

  it('marks a context increase as good', () => {
    expect(eventDelta('context', '128000', '256000')).toEqual({ delta: '+100.0%', tone: 'good' })
  })

  it('returns no chip for catalog, unparseable, non-positive, or unchanged values', () => {
    expect(eventDelta('catalog', null, null)).toEqual({ delta: null, tone: 'neutral' })
    expect(eventDelta('price', 'n/a', '2')).toEqual({ delta: null, tone: 'neutral' })
    expect(eventDelta('price', '0', '2')).toEqual({ delta: null, tone: 'neutral' })
    expect(eventDelta('price', '1.4', '1.4')).toEqual({ delta: null, tone: 'neutral' })
  })
})

describe('composeRows', () => {
  const stories = [
    { id: 's1', headline: 'UST is bringing Claude to physical AI' },
    { id: 's2', headline: 'Mistral releases robotics model' },
    { id: 's3', headline: 'Third story' },
  ]

  it('collapses a same-vendor catalog burst into one grouped line', () => {
    const events = [
      ev({ id: 'c1', event_type: 'catalog', price_scope: null, summary: 'GPT-5.6 Sol (OpenAI) added to the tracker.' }),
      ev({ id: 'c2', event_type: 'catalog', price_scope: null, summary: 'GPT-5.6 Sol Pro (OpenAI) added to the tracker.' }),
      ev({ id: 'c3', event_type: 'catalog', price_scope: null, summary: 'GPT-5.6 Terra (OpenAI) added to the tracker.' }),
    ]
    const rows = composeRows(events, stories)
    expect(rows).toHaveLength(3)
    expect(rows[0]).toMatchObject({ kind: 'event', text: '3 new OpenAI models in the tracker', chip: null })
    // The remaining slots are stories, never more near-identical catalog lines.
    expect(rows[1]).toMatchObject({ kind: 'story', text: stories[0].headline })
    expect(rows[2]).toMatchObject({ kind: 'story', text: stories[1].headline })
  })

  it('leads with the biggest vendor group when the burst is mixed', () => {
    const events = [
      ev({ id: 'c1', event_type: 'catalog', price_scope: null, model_vendor: 'OpenAI', summary: 'a (OpenAI) added to the tracker.' }),
      ev({ id: 'c2', event_type: 'catalog', price_scope: null, model_vendor: 'OpenAI', summary: 'b (OpenAI) added to the tracker.' }),
      ev({ id: 'c3', event_type: 'catalog', price_scope: null, model_vendor: 'xAI', summary: 'c (xAI) added to the tracker.' }),
    ]
    const rows = composeRows(events, stories)
    expect(rows[0].text).toBe('2 new OpenAI models in the tracker')
    expect(rows[0].chip).toBeNull()
  })

  it('keeps a single catalog event as its own line with a NEW chip', () => {
    const events = [
      ev({ id: 'c1', event_type: 'catalog', price_scope: null, summary: 'Grok 4.5 (xAI) added to the tracker.', model_vendor: 'xAI' }),
    ]
    const rows = composeRows(events, stories)
    expect(rows[0]).toMatchObject({ text: 'Grok 4.5 added to the tracker.', chip: 'NEW' })
  })

  it('puts movement events before catalog and strips the vendor paren', () => {
    const events = [
      ev({ id: 'p1', summary: 'GLM-5.2 (Zhipu): input price $0.57 to $0.90 per 1M', model_vendor: 'Zhipu', delta: '+57.9%', tone: 'bad' }),
      ev({ id: 'c1', event_type: 'catalog', price_scope: null, summary: 'X (OpenAI) added to the tracker.' }),
    ]
    const rows = composeRows(events, stories)
    expect(rows[0]).toMatchObject({ text: 'GLM-5.2: input price $0.57 to $0.90 per 1M', chip: '+57.9%', tone: 'bad' })
    expect(rows[1].chip).toBe('NEW')
    expect(rows[2].kind).toBe('story')
  })

  it('always reserves a slot for a story when stories exist', () => {
    const events = [
      ev({ id: 'p1', delta: '-10.0%', tone: 'good' }),
      ev({ id: 'p2', delta: '+5.0%', tone: 'bad' }),
      ev({ id: 'p3', delta: '+7.0%', tone: 'bad' }),
    ]
    const rows = composeRows(events, stories)
    expect(rows.filter((r) => r.kind === 'story')).toHaveLength(1)
  })

  it('uses all event slots when there are no stories', () => {
    const events = [ev({ id: 'p1' }), ev({ id: 'p2' }), ev({ id: 'p3' })]
    expect(composeRows(events, []).every((r) => r.kind === 'event')).toBe(true)
  })

  it('falls back to stories alone in a quiet week', () => {
    const rows = composeRows([], stories)
    expect(rows).toHaveLength(3)
    expect(rows.every((r) => r.kind === 'story')).toBe(true)
  })

  it('returns empty for no data', () => {
    expect(composeRows([], [])).toEqual([])
  })

  it('slots the registry fact after movement events, before catalog filler', () => {
    const fact = floorFactRow({
      slug: 'glm-5-2', name: 'GLM-5.2', price_in: 0.546, vendor_price_in: 1.4, floor_provider: 'StreamLake',
    })
    const events = [
      ev({ id: 'c1', event_type: 'catalog', price_scope: null, summary: 'a (OpenAI) added to the tracker.' }),
      ev({ id: 'c2', event_type: 'catalog', price_scope: null, summary: 'b (OpenAI) added to the tracker.' }),
    ]
    const rows = composeRows(events, stories, fact)
    expect(rows[0]).toMatchObject({
      text: 'GLM-5.2: $0.55/M via StreamLake',
      chip: '-61%',
      tone: 'good',
    })
    expect(rows[1].text).toBe('2 new OpenAI models in the tracker')
    expect(rows[2].kind).toBe('story')
  })
})

describe('composeRows hrefs', () => {
  it('links stories to their cluster, events to their model, groups to the change feed', () => {
    const fact = floorFactRow({
      slug: 'glm-5-2', name: 'GLM-5.2', price_in: 0.5, vendor_price_in: 1, floor_provider: 'P',
    })
    const events = [
      ev({ id: 'c1', event_type: 'catalog', price_scope: null, summary: 'a (OpenAI) added to the tracker.' }),
      ev({ id: 'c2', event_type: 'catalog', price_scope: null, summary: 'b (OpenAI) added to the tracker.' }),
    ]
    const rows = composeRows(events, [{ id: 's1', headline: 'Story' }], fact, 5)
    expect(rows.find((r) => r.key === 'floor-glm-5-2')?.href).toBe('/models/glm-5-2')
    expect(rows.find((r) => r.kind === 'story')?.href).toBe('/story/s1')
    expect(rows.find((r) => r.text.includes('new OpenAI models'))?.href).toBe('/models/changes')
  })
})

describe('parseFrontmatter', () => {
  it('parses title/date/preview and returns the body', async () => {
    const { parseFrontmatter } = await import('../digestIssues')
    const raw = '---\ntitle: The subject\ndate: 2026-07-09\npreview: "Plus: things."\n---\n\n## Body\n'
    const { meta, body } = parseFrontmatter(raw)
    expect(meta).toEqual({ title: 'The subject', date: '2026-07-09', preview: 'Plus: things.' })
    expect(body.trim()).toBe('## Body')
  })

  it('passes through content without frontmatter', async () => {
    const { parseFrontmatter } = await import('../digestIssues')
    const { meta, body } = parseFrontmatter('just text')
    expect(meta).toEqual({})
    expect(body).toBe('just text')
  })
})

describe('floorFactRow', () => {
  it('skips spreads under 20% and bad inputs', () => {
    expect(floorFactRow({ slug: 'x', name: 'X', price_in: 0.9, vendor_price_in: 1, floor_provider: 'P' })).toBeNull()
    expect(floorFactRow({ slug: 'x', name: 'X', price_in: 0, vendor_price_in: 1, floor_provider: 'P' })).toBeNull()
    expect(floorFactRow({ slug: 'x', name: 'X', price_in: 2, vendor_price_in: 1, floor_provider: 'P' })).toBeNull()
  })
})
