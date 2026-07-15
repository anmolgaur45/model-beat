import type { Metadata } from 'next'
import Link from 'next/link'
import { NavBar } from '@/components/NavBar'
import { SITE_URL } from '@/lib/site'
import { appRouter } from '@/server/routers/_app'
import { createContext } from '@/server/trpc'
import type { ModelEvent } from '@/types/article'

export const metadata: Metadata = {
  title: 'Model changes: prices, context windows, benchmarks',
  description:
    'A running feed of what changed across tracked AI models in the last 30 days: vendor price moves, cheapest-provider shifts, context window changes, benchmark movement, and newly tracked models.',
  alternates: { canonical: '/models/changes' },
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', timeZone: 'UTC',
  })
}

// event → short tag shown next to the date (mirrors the model-page changelog)
function eventTag(e: ModelEvent): string {
  if (e.event_type === 'price') return e.price_scope === 'floor' ? 'cheapest provider' : 'list price'
  if (e.event_type === 'catalog') return 'tracked'
  return e.event_type
}

// Summaries are self-contained ("GLM-5.2: input price..."), but here the model
// name is already the link, so strip the leading name (and a vendor paren).
function trimSummary(e: ModelEvent): string {
  let s = e.summary
  if (e.model_name && s.startsWith(e.model_name)) {
    s = s.slice(e.model_name.length).replace(/^\s*\([^)]*\)\s*/, '').replace(/^:\s*/, '')
  }
  return s
}

export default async function ModelChangesPage() {
  const caller = appRouter.createCaller(createContext())
  let events: ModelEvent[] = []
  try {
    events = await caller.articles.getModelEvents({ days: 30 })
  } catch {
    // ISR keeps serving the last good page; an empty render is the cold-start fallback
  }

  // Vendor groups, ordered by each vendor's most recent event
  const groups = new Map<string, ModelEvent[]>()
  for (const e of events) {
    const key = e.model_vendor || 'Other'
    const arr = groups.get(key) ?? []
    arr.push(e)
    groups.set(key, arr)
  }

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: 'AI model changes',
    url: `${SITE_URL}/models/changes`,
    description:
      'What changed across tracked AI models: prices, context windows, benchmarks, and new models.',
  }

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <NavBar />
      <main className="anc-sw">
        <Link className="anc-day-back" href="/models">← Model tracker</Link>
        <div className="anc-kicker">Change feed</div>
        <h1 className="anc-sw-h1">What changed, model by model</h1>
        <p className="anc-sw-lead">
          Every operational change the tracker detects, from the last 30 days: vendor list-price
          moves, shifts in the cheapest credible provider, context window changes, benchmark
          movement, and newly tracked models. Detected automatically every 3 hours; how it works
          is on the <Link href="/methodology">methodology page</Link>.{' '}
          <a href="/models/changes/rss">Subscribe via RSS</a>.
        </p>

        {events.length === 0 && (
          <p className="anc-sw-lead">No changes detected in the last 30 days.</p>
        )}

        {[...groups.entries()].map(([vendor, list]) => (
          <section className="anc-sw-prose" key={vendor}>
            <h2>{vendor}</h2>
            <ul>
              {list.map((e) => (
                <li key={e.id}>
                  <Link href={`/models/${e.model_slug}`}>{e.model_name}</Link>{' '}{trimSummary(e)}{' '}
                  <span style={{ opacity: 0.65, fontSize: '0.85em', whiteSpace: 'nowrap' }}>
                    {eventTag(e)} · {fmtDate(e.detected_at)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </main>
    </>
  )
}
