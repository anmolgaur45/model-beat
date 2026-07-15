import { cache } from 'react'
import type { Metadata } from 'next'
import { AUTHOR_JSONLD, SITE_URL } from '@/lib/site'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { appRouter } from '@/server/routers/_app'
import { createContext } from '@/server/trpc'
import sql from '@/lib/db'
import { FeatureCard } from '@/components/FeatureCard'
import { StoryCard } from '@/components/StoryCard'
import { NavBar } from '@/components/NavBar'
import { storyPath } from '@/lib/story'
import { isPaperCluster } from '@/lib/papers'
import { bySignificance } from '@/lib/storyRank'
import { PapersFold } from '@/components/PapersFold'

// Match the homepage's top-story gate: only a high-signal lead gets the hero card.
const TOP_STORY_MIN = 6

// Fully static, no TTL: freshness comes from the pipeline-triggered redeploy
// every 3h, so revalidation writes are zero (Hobby ISR-write budget,
// 2026-07-14). Prerender the sitemap's day list (same substantive-and-recent
// gate — an ungated DISTINCT pulled 1,207 days incl. backdated 2017 ones and
// flaked the build). Thin/backdated days and a brand-new day between deploys
// render on demand and cache once per deploy (a handful of writes/day).
export async function generateStaticParams() {
  const rows = await sql<{ day: string }[]>`
    SELECT to_char(first_published_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day
    FROM clusters c
    WHERE first_published_at >= now() - interval '370 days'
      AND EXISTS (SELECT 1 FROM articles a
                  WHERE a.cluster_id = c.id AND a.source_name NOT LIKE 'arXiv%')
    GROUP BY day
    HAVING count(*) >= 3
  `
  return rows.map((r) => ({ date: r.day }))
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const SITE = SITE_URL

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
  return [...clusters].sort(bySignificance)
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

function navLabel(day: string): string {
  return new Date(day + 'T12:00:00Z').toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC',
  })
}

// A day is worth indexing only if it's a substantive, recent news day. Thin or
// backdated days (arXiv carries original publication dates back to 2015) are
// noindexed so a long tail of one-story pages doesn't dilute the site. The
// archive, sitemap and prev/next chain use the same bar.
const DAY_INDEX_MIN_STORIES = 3
function isIndexableDay(date: string, storyCount: number): boolean {
  if (storyCount < DAY_INDEX_MIN_STORIES) return false
  const ageDays = (Date.now() - new Date(date + 'T00:00:00Z').getTime()) / 86_400_000
  return ageDays <= 370
}

// Nearest substantive days on either side — the crawlable archive chain.
const adjacentDays = cache(async (date: string) => {
  const [row] = await sql<{ prev: string | null; next: string | null }[]>`
    WITH substantive AS (
      SELECT to_char(first_published_at AT TIME ZONE 'UTC','YYYY-MM-DD') AS d
      FROM clusters c
      WHERE first_published_at >= now() - interval '370 days'
        AND EXISTS (SELECT 1 FROM articles a
                    WHERE a.cluster_id = c.id AND a.source_name NOT LIKE 'arXiv%')
      GROUP BY 1 HAVING count(*) >= ${DAY_INDEX_MIN_STORIES}
    )
    SELECT
      (SELECT max(d) FROM substantive WHERE d < ${date}) AS prev,
      (SELECT min(d) FROM substantive WHERE d > ${date}) AS next
  `
  return row ?? { prev: null, next: null }
})

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
  // Lead with editorial stories, not shelved paper clusters — the SERP snippet
  // must match what the page shows above the fold. All-paper days fall back.
  const metaStories = clusters.filter((c) => !isPaperCluster(c))
  const top = (metaStories.length > 0 ? metaStories : clusters)
    .slice(0, 3).map((c) => c.headline).join(' · ')
  const description = `The AI news that mattered on ${label}: ${top}`.slice(0, 200)
  const url = `${SITE}/day/${date}`

  return {
    title: `AI news on ${label}`,
    description,
    alternates: { canonical: url },
    robots: isIndexableDay(date, clusters.filter((c) => !isPaperCluster(c)).length) ? undefined : { index: false, follow: true },
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
  // Pure-arXiv paper clusters shelve below the stories (PapersFold); counts,
  // lead pick, and JSON-LD all work off the editorial stories only.
  const stories = clusters.filter((c) => !isPaperCluster(c))
  const papers = clusters.filter((c) => isPaperCluster(c))

  const { prev, next } = await adjacentDays(date)

  const label = longDate(date)
  const d = new Date(date + 'T12:00:00Z')
  const weekday = d.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' })
  const monthDay = d.toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  })
  const ghostNum = String(d.getUTCDate()).padStart(2, '0')

  // Top story gets the hero feature card (like the homepage); the rest are cards.
  const lead = stories[0] && stories[0].significance_score >= TOP_STORY_MIN ? stories[0] : null
  const rest = lead ? stories.slice(1) : stories

  const jsonLd = [
    {
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      name: `AI news on ${label}`,
      itemListElement: stories.map((c, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        item: {
          '@type': 'NewsArticle',
          headline: c.headline,
          datePublished: c.first_published_at,
          // Newest covering article = when the aggregated story last changed.
          dateModified: (c.articles ?? [])
            .map((a) => a.published_at)
            .reduce((x, y) => (x > y ? x : y), c.first_published_at),
          author: AUTHOR_JSONLD,
          description: bestText(c).slice(0, 250),
          // Our permalink (schema + all sources), not the external publisher.
          url: `${SITE}${storyPath(c)}`,
          publisher: { '@type': 'NewsMediaOrganization', name: 'Model Beat' },
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

      <NavBar />

      <div className="ghost-number">{ghostNum}</div>

      <main className="anc-daywrap">
        <Link className="anc-day-back" href="/">← Back to the timeline</Link>
        <div className="anc-kicker">Daily archive</div>
        {/* H1 targets "AI news on {date}", not the weekday. */}
        <h1 className="anc-date-heading">
          AI news on {monthDay} <span className="dim">· {weekday}</span>
        </h1>
        <div className="anc-hero-sub">
          <b>{stories.length} {stories.length === 1 ? 'story' : 'stories'}</b>
          {papers.length > 0 && <> · {papers.length} research {papers.length === 1 ? 'paper' : 'papers'}</>} — deduplicated
          across sources, ranked by significance, every source cited.
        </div>

        <div className="anc-dayfeed">
          {lead && <FeatureCard cluster={lead} />}
          {rest.map((c) => (
            <StoryCard key={c.id} cluster={c} />
          ))}
          <PapersFold papers={papers} defaultOpen={stories.length < 6} />
        </div>

        {(prev || next) && (
          <nav className="anc-day-nav" aria-label="Browse adjacent days">
            {prev ? (
              <Link className="anc-day-navlink" href={`/day/${prev}`} rel="prev">← {navLabel(prev)}</Link>
            ) : (
              <span className="anc-day-navlink is-disabled">← Older</span>
            )}
            {next ? (
              <Link className="anc-day-navlink" href={`/day/${next}`} rel="next">{navLabel(next)} →</Link>
            ) : (
              <span className="anc-day-navlink is-disabled">Newer →</span>
            )}
          </nav>
        )}
      </main>
    </div>
  )
}
