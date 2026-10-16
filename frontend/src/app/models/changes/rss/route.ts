import { appRouter } from '@/server/routers/_app'
import { createContext } from '@/server/trpc'
import { SITE_URL } from '@/lib/site'
import type { ModelEvent } from '@/types/article'

// Phase V: the change feed as RSS — the zero-infra "responsive signal" for
// power users (no accounts, no email). Summaries are self-contained.
// Rendered per request behind a 1h CDN cache (next.config.ts). force-static
// froze it at the build, and builds land days apart.
export const dynamic = 'force-dynamic'

function esc(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

export async function GET() {
  const caller = appRouter.createCaller(createContext())
  // No catch: on a DB error the 500 lets the CDN keep serving the last good
  // feed (stale-if-error), where an empty feed would have been cached as real.
  const events: ModelEvent[] = await caller.articles.getModelEvents({ days: 30 })

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
      'Cache-Control': 'public, max-age=1800',
    },
  })
}
