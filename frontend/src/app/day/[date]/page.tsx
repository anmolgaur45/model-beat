import { cache } from 'react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { appRouter } from '@/server/routers/_app'
import { createContext } from '@/server/trpc'
import { FeatureCard } from '@/components/FeatureCard'
import { StoryCard } from '@/components/StoryCard'

// Match the homepage's top-story gate: only a high-signal lead gets the hero card.
const TOP_STORY_MIN = 6

export const revalidate = 3600

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const SITE = process.env.NEXT_PUBLIC_URL ?? 'http://localhost:3000'

// Format AND real-calendar check — rejects 9999-99-99 / 2026-02-31 before any
// Date math runs (an invalid Date.toISOString() throws → 500 instead of 404).
function isValidDate(date: string): boolean {
  if (!DATE_RE.test(date)) return false
  const d = new Date(date + 'T12:00:00Z')
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === date
}

type DayCluster = Awaited<ReturnType<typeof loadDay>>[number]

// Cached per-request so generateMetadata and the page share one DB round trip.
const loadDay = cache(async (date: string) => {
  const caller = appRouter.createCaller(createContext())
  const clusters = await caller.articles.getClusters({ date, limit: 100 })
  return [...clusters].sort((a, b) => b.significance_score - a.significance_score)
})

function longDate(date: string): string {
  return new Date(date + 'T12:00:00Z').toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

function bestText(c: DayCluster): string {
  return c.summary ?? c.articles[0]?.body_excerpt ?? ''
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ date: string }>
}): Promise<Metadata> {
  const { date } = await params
  if (!isValidDate(date)) return {}
  const clusters = await loadDay(date).catch(() => [])
  if (clusters.length === 0) return {}

  const label = longDate(date)
  const top = clusters.slice(0, 3).map((c) => c.headline).join(' · ')
  const description = `The AI news that mattered on ${label}: ${top}`.slice(0, 200)
  const url = `${SITE}/day/${date}`

  return {
    title: `AI news on ${label}`,
    description,
    alternates: { canonical: url },
    openGraph: {
      type: 'article',
      title: `AI news on ${label}`,
      description,
      url,
      images: [{ url: `/api/og?date=${date}`, width: 1200, height: 630 }],
    },
    twitter: {
      card: 'summary_large_image',
      title: `AI news on ${label}`,
      description,
      images: [`/api/og?date=${date}`],
    },
  }
}

export default async function DayPage({
  params,
}: {
  params: Promise<{ date: string }>
}) {
  const { date } = await params
  if (!isValidDate(date)) notFound()

  const clusters = await loadDay(date)
  if (clusters.length === 0) notFound()

  const label = longDate(date)
  const d = new Date(date + 'T12:00:00Z')
  const weekday = d.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' })
  const monthDay = d.toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  })
  const ghostNum = String(d.getUTCDate()).padStart(2, '0')

  // Top story gets the hero feature card (like the homepage); the rest are cards.
  const lead = clusters[0] && clusters[0].significance_score >= TOP_STORY_MIN ? clusters[0] : null
  const rest = lead ? clusters.slice(1) : clusters

  const jsonLd = [
    {
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      name: `AI news on ${label}`,
      itemListElement: clusters.map((c, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        item: {
          '@type': 'NewsArticle',
          headline: c.headline,
          datePublished: c.first_published_at,
          description: bestText(c).slice(0, 250),
          url: c.articles[0]?.source_url ?? `${SITE}/day/${date}`,
        },
      })),
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: SITE },
        { '@type': 'ListItem', position: 2, name: `AI news on ${label}`, item: `${SITE}/day/${date}` },
      ],
    },
  ]

  return (
    <div className="aurora-stage">
      <div className="aurora-layer">
        <div className="aurora-blob aurora-blob-1" />
        <div className="aurora-blob aurora-blob-2" />
        <div className="aurora-blob aurora-blob-3" />
      </div>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      {/* Static server nav (no theme toggle — this is an archive page) */}
      <div className="anc-navwrap nav-scrolled">
        <nav className="anc-nav">
          <Link className="anc-brand" href="/">
            <span className="anc-mark"><span className="anc-mark-dot" /></span>
            <span className="anc-brand-name">AI News Calendar</span>
          </Link>
          <span style={{ flex: 1 }} />
          <Link className="anc-navlink" href="/models">Models</Link>
          <Link className="anc-navlink" href="/">Today</Link>
        </nav>
      </div>

      <div className="ghost-number">{ghostNum}</div>

      <main className="anc-daywrap">
        <Link className="anc-day-back" href="/">← Back to the timeline</Link>
        <div className="anc-kicker">Daily archive</div>
        <h1 className="anc-date-heading">
          {weekday} <span className="dim">— {monthDay}</span>
        </h1>
        <div className="anc-hero-sub">
          <b>{clusters.length} {clusters.length === 1 ? 'story' : 'stories'}</b> — deduplicated
          across sources, ranked by significance, every source cited.
        </div>

        <div className="anc-dayfeed">
          {lead && <FeatureCard cluster={lead} />}
          {rest.map((c) => (
            <StoryCard key={c.id} cluster={c} />
          ))}
        </div>
      </main>
    </div>
  )
}
