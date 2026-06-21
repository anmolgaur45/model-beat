import sql from '@/lib/db'
import { SITE_URL as SITE } from '@/lib/site'

export const revalidate = 3600

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export async function GET() {
  const clusters = await sql<
    { id: string; headline: string; summary: string | null; first_published_at: string }[]
  >`
    SELECT id, headline, summary, first_published_at FROM clusters
    WHERE first_published_at >= now() - interval '7 days' AND significance_score >= 5
    ORDER BY first_published_at DESC
    LIMIT 50
  `

  const ids = clusters.map((c) => c.id)
  const articles = ids.length
    ? await sql<{ cluster_id: string; source_url: string; body_excerpt: string | null }[]>`
        SELECT DISTINCT ON (cluster_id) cluster_id, source_url, body_excerpt
        FROM articles WHERE cluster_id = ANY(${ids})
        ORDER BY cluster_id, significance_base DESC
      `
    : []
  const byCluster = new Map(articles.map((a) => [a.cluster_id, a]))

  const items = clusters
    .map((c) => {
      const a = byCluster.get(c.id)
      const link = a?.source_url ?? SITE
      const desc = c.summary ?? a?.body_excerpt ?? ''
      const pub = new Date(c.first_published_at).toUTCString()
      return (
        `<item>` +
        `<title>${esc(c.headline)}</title>` +
        `<link>${esc(link)}</link>` +
        `<guid isPermaLink="false">${c.id}</guid>` +
        `<pubDate>${pub}</pubDate>` +
        `<description>${esc(desc)}</description>` +
        `</item>`
      )
    })
    .join('')

  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel>` +
    `<title>Model Beat</title>` +
    `<link>${SITE}</link>` +
    `<atom:link href="${SITE}/feed.xml" rel="self" type="application/rss+xml"/>` +
    `<description>The AI news that actually mattered — deduplicated across sources, ranked by significance, every story cited.</description>` +
    `<language>en</language>` +
    items +
    `</channel></rss>`

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
    },
  })
}
