import { appRouter } from '@/server/routers/_app'
import { createContext } from '@/server/trpc'
import { SITE_URL } from '@/lib/site'
import type { ModelEvent } from '@/types/article'

// Phase V: the change feed as RSS — the zero-infra "responsive signal" for
// power users (no accounts, no email). Summaries are self-contained.
// Built once per deploy (zero ISR writes, 2026-07-14); 3h redeploys refresh it.
export const dynamic = 'force-static'

function esc(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

export async function GET() {
  const caller = appRouter.createCaller(createContext())
  let events: ModelEvent[] = []
  try {
    events = await caller.articles.getModelEvents({ days: 30 })
  } catch {
    // empty feed beats a 500; the next revalidation retries
  }

  const items = events
    .map((e) => {
      const link = `${SITE_URL}/models/${e.model_slug}`
      return `    <item>
      <title>${esc(e.summary)}</title>
      <link>${esc(link)}</link>
      <guid isPermaLink="false">${e.id}</guid>
      <pubDate>${new Date(e.detected_at).toUTCString()}</pubDate>
      <category>${esc(e.event_type === 'price' ? `price:${e.price_scope ?? ''}` : e.event_type)}</category>
    </item>`
    })
    .join('\n')

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Model Beat: model changes</title>
    <link>${SITE_URL}/models/changes</link>
    <description>Vendor price moves, cheapest-provider shifts, context window changes, benchmark movement, and newly tracked AI models. Detected every 3 hours.</description>
    <language>en</language>
${items}
  </channel>
</rss>`

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Cache-Control': 'public, s-maxage=1800, stale-while-revalidate=3600',
    },
  })
}
