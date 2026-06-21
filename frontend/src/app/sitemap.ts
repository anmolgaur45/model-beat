import type { MetadataRoute } from 'next'
import sql from '@/lib/db'

import { SITE_URL as SITE } from '@/lib/site'

export const revalidate = 3600

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // UTC-day grouping to match getClusters' day boundaries (it filters on UTC midnight).
  const rows = await sql<{ day: string; last: string }[]>`
    SELECT to_char(first_published_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
           max(created_at) AS last
    FROM clusters
    WHERE first_published_at >= now() - interval '90 days'
    GROUP BY day
    ORDER BY day DESC
  `

  const days: MetadataRoute.Sitemap = rows.map((r) => ({
    url: `${SITE}/day/${r.day}`,
    lastModified: new Date(r.last),
    changeFrequency: 'daily',
    priority: 0.7,
  }))

  // Per-model pages (Phase K) — one URL per canonical model in the registry.
  const modelRows = await sql<{ slug: string; updated_at: string }[]>`
    SELECT slug, updated_at FROM models
    WHERE released_at >= now() - interval '1 year'
    ORDER BY released_at DESC NULLS LAST
  `
  const modelPages: MetadataRoute.Sitemap = modelRows.map((m) => ({
    url: `${SITE}/models/${m.slug}`,
    lastModified: new Date(m.updated_at),
    changeFrequency: 'weekly',
    priority: 0.6,
  }))

  return [
    { url: SITE, lastModified: new Date(), changeFrequency: 'hourly', priority: 1 },
    { url: `${SITE}/models`, lastModified: new Date(), changeFrequency: 'daily', priority: 0.8 },
    ...modelPages,
    ...days,
  ]
}
