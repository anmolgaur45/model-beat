import { cache } from 'react'
import type { Metadata } from 'next'
import { appRouter } from '@/server/routers/_app'
import { createContext } from '@/server/trpc'
import HomePageClient from './HomePageClient'

// ISR safety net; the client island also refetches, so users stay current and
// the pipeline's /api/revalidate refreshes on new data.
export const revalidate = 3600

// Server "today" in UTC (Vercel runs UTC); the client nudges to the visitor's
// local day post-hydration if their timezone has already rolled over.
function serverToday(): string {
  return new Date().toISOString().slice(0, 10)
}

// Cached per request so generateMetadata and the page share one set of queries.
const loadHome = cache(async () => {
  const caller = appRouter.createCaller(createContext())
  const date = serverToday()
  const [clusters, topStories] = await Promise.all([
    caller.articles.getClusters({ date, limit: 100 }),
    caller.articles.getTopStories({ days: 7, limit: 6 }),
  ])
  return { date, clusters, topStories }
})

export async function generateMetadata(): Promise<Metadata> {
  const { clusters } = await loadHome().catch(() => ({ clusters: [] as { headline: string }[] }))
  const top = clusters.slice(0, 3).map((c) => c.headline).join(' · ')
  const description = top
    ? `Today's top AI news: ${top}`.slice(0, 155)
    : 'Daily AI news, deduplicated across sources and ranked by significance, plus a model tracker with benchmarks and pricing.'
  return {
    // absolute bypasses the "%s | Model Beat" template so the brand isn't doubled
    title: { absolute: 'Model Beat — Daily AI News & Model Tracker' },
    description,
    // page alternates override the layout's, so re-declare the RSS feed here to
    // keep feed-reader auto-discovery in <head> (the visible footer link is gone)
    alternates: { canonical: '/', types: { 'application/rss+xml': '/feed.xml' } },
  }
}

export default async function HomePage() {
  const { date, clusters, topStories } = await loadHome()
  return (
    <HomePageClient
      initialDate={date}
      initialClusters={clusters}
      initialTopStories={topStories}
    />
  )
}
