import { cache } from 'react'
import type { Metadata } from 'next'
import { appRouter } from '@/server/routers/_app'
import { createContext } from '@/server/trpc'
import type { Model } from '@/types/article'
import type { TopModel } from '@/components/HeroModelBand'
import { isModelAvailable } from '@/lib/modelStatus'
import { AUTHOR_JSONLD, SITE_URL } from '@/lib/site'
import { storyPath } from '@/lib/story'
import { isPaperCluster } from '@/lib/papers'
import HomePageClient from './HomePageClient'

// Static at build; the pipeline-triggered redeploy every 3h is the freshness
// mechanism (zero ISR writes, 2026-07-14). The client island still refetches,
// so users see new stories between deploys.

// Server "today" in UTC (Vercel runs UTC); the client nudges to the visitor's
// local day post-hydration if their timezone has already rolled over.
function serverToday(): string {
  return new Date().toISOString().slice(0, 10)
}

// Overall intelligence composite (avg of per-bucket percentiles) — matches the
// "Intelligence Index" the model page shows, so the band ranks consistently.
function overallScore(m: Model): number | null {
  const vals = Object.values(m.buckets ?? {}).filter((v): v is number => v != null)
  return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null
}

// Cached per request so generateMetadata and the page share one set of queries.
const loadHome = cache(async () => {
  const caller = appRouter.createCaller(createContext())
  const date = serverToday()
  const [clusters, topStories, models] = await Promise.all([
    caller.articles.getClusters({ date, limit: 100, by: 'activity' }),
    caller.articles.getTopStories({ days: 7, limit: 6 }),
    caller.articles.getModels({ limit: 200 }),
  ])
  const topModels: TopModel[] = models
    .filter((m) => isModelAvailable(m.slug))
    .map((m) => ({ slug: m.slug, name: m.name, vendor: m.vendor, score: overallScore(m) }))
    .filter((m): m is TopModel => m.score != null)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
  return { date, clusters, topStories, topModels }
})

export function generateMetadata(): Metadata {
  return {
    // absolute bypasses the "%s | Model Beat" template so the brand isn't doubled
    title: { absolute: 'Model Beat — Daily AI News & Model Tracker' },
    // Hand-written and stable: the previous auto-concatenated headlines
    // truncated mid-word in SERPs and read as noise (2026-07-11 audit).
    description:
      'Stories from 1,300+ outlets, deduplicated and ranked by significance, plus a live tracker of 140+ AI models with benchmarks and pricing.',
    // Canonical renders without a trailing slash: Next's metadata resolver
    // normalizes it away even when passed explicitly. Audit-confirmed
    // negligible (Google normalizes the pair), so accepted as-is.
    // Page alternates override the layout's, so re-declare the RSS feed here to
    // keep feed-reader auto-discovery in <head> (the visible footer link is gone)
    alternates: { canonical: '/', types: { 'application/rss+xml': '/feed.xml' } },
  }
}

// Ranked-list schema for the homepage: "today's top N" is exactly the shape
// answer engines quote for fresh queries. Editorial stories only (papers are
// shelved in the UI); the week list mirrors the top-stories ticker.
type RankedStory = {
  id: string
  headline: string
  first_published_at: string
  articles?: { published_at: string }[]
}
// A story's "modified" moment is its newest covering article — coverage
// growing is what updates an aggregated story (clusters have no updated_at).
function lastUpdated(c: RankedStory): string {
  const times = (c.articles ?? []).map((a) => a.published_at).filter(Boolean)
  return times.length ? times.reduce((a, b) => (a > b ? a : b)) : c.first_published_at
}
function rankedListJsonLd(name: string, stories: RankedStory[]) {
  if (stories.length === 0) return null
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name,
    itemListElement: stories.map((c, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      item: {
        '@type': 'NewsArticle',
        headline: c.headline,
        datePublished: c.first_published_at,
        dateModified: lastUpdated(c),
        author: AUTHOR_JSONLD,
        url: `${SITE_URL}${storyPath(c)}`,
        publisher: { '@type': 'NewsMediaOrganization', name: 'Model Beat' },
      },
    })),
  }
}

export default async function HomePage() {
  const { date, clusters, topStories, topModels } = await loadHome()
  const jsonLd = [
    rankedListJsonLd('Top AI news today', clusters.filter((c) => !isPaperCluster(c)).slice(0, 10)),
    rankedListJsonLd('Top AI stories this week', topStories.slice(0, 6)),
  ].filter(Boolean)
  return (
    <>
      {jsonLd.length > 0 && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      )}
      <HomePageClient
        initialDate={date}
        initialClusters={clusters}
        initialTopStories={topStories}
        initialTopModels={topModels}
      />
    </>
  )
}
