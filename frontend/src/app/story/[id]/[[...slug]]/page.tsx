import { cache } from 'react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { SITE_URL } from '@/lib/site'
import { appRouter } from '@/server/routers/_app'
import { createContext } from '@/server/trpc'
import type { Category } from '@/types/article'
import { NavBar } from '@/components/NavBar'
import { ScoreBadge } from '@/components/ScoreBadge'
import { SourceBubble } from '@/components/SourceBubble'
import { ShareMenu } from '@/components/ShareMenu'
import { CATEGORY_LABELS } from '@/components/categoryMeta'
import { storyPath } from '@/lib/story'
import { timeAgo } from '@/lib/timeFormat'

export const revalidate = 3600

const SITE = SITE_URL
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const loadStory = cache(async (id: string) => {
  const caller = appRouter.createCaller(createContext())
  return caller.articles.getCluster({ id }).catch(() => null)
})

function utcDay(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10)
}
function longDate(day: string): string {
  return new Date(day + 'T12:00:00Z').toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  })
}
function bestText(s: { summary: string | null; articles: { body_excerpt: string | null }[] }): string {
  return s.summary ?? s.articles[0]?.body_excerpt ?? ''
}

// A story is worth indexing only if it has multi-source coverage or a strong
// significance, and is recent — mirrors the day-page gate so a long tail of
// thin single-source pages doesn't dilute the site.
function isIndexableStory(s: { article_count: number; significance_score: number; first_published_at: string }): boolean {
  const ageDays = (Date.now() - new Date(s.first_published_at).getTime()) / 86_400_000
  return ageDays <= 370 && (s.article_count >= 2 || s.significance_score >= 6)
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string; slug?: string[] }>
}): Promise<Metadata> {
  const { id } = await params
  if (!UUID_RE.test(id)) return {}
  const story = await loadStory(id)
  if (!story) return {}

  const title = story.headline
  const description = (bestText(story) || `The AI story: ${story.headline}`).slice(0, 200)
  const url = `${SITE}${storyPath(story)}`
  const ogImage = `/api/og?title=${encodeURIComponent(title.slice(0, 60))}`

  return {
    title,
    description,
    alternates: { canonical: url },
    robots: isIndexableStory(story) ? undefined : { index: false, follow: true },
    openGraph: {
      type: 'article',
      title,
      description,
      url,
      publishedTime: story.first_published_at,
      images: [{ url: ogImage, width: 1200, height: 630 }],
    },
    twitter: { card: 'summary_large_image', title, description, images: [ogImage] },
  }
}

export default async function StoryPage({
  params,
}: {
  params: Promise<{ id: string; slug?: string[] }>
}) {
  const { id } = await params
  if (!UUID_RE.test(id)) notFound()
  const story = await loadStory(id)
  if (!story) notFound()

  const day = utcDay(story.first_published_at)
  const label = CATEGORY_LABELS[story.category as Category] ?? story.category
  const summary = bestText(story)
  const url = `${SITE}${storyPath(story)}`
  const canonical = url

  const jsonLd = [
    {
      '@context': 'https://schema.org',
      '@type': 'NewsArticle',
      headline: story.headline,
      datePublished: story.first_published_at,
      description: summary.slice(0, 250),
      mainEntityOfPage: canonical,
      ...(story.articles[0]?.author ? { author: { '@type': 'Person', name: story.articles[0].author } } : {}),
      ...(story.articles[0]?.source_url ? { isBasedOn: story.articles[0].source_url } : {}),
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: SITE },
        { '@type': 'ListItem', position: 2, name: `AI news on ${longDate(day)}`, item: `${SITE}/day/${day}` },
        { '@type': 'ListItem', position: 3, name: story.headline, item: canonical },
      ],
    },
  ]

  return (
    <div className="aurora-stage">
      <div className="aurora-layer" aria-hidden="true">
        <div className="aurora-blob aurora-blob-1" />
        <div className="aurora-blob aurora-blob-2" />
        <div className="aurora-blob aurora-blob-3" />
      </div>

      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <NavBar />

      <main className="anc-story">
        <Link className="anc-day-back" href="/">← Back to Model Beat</Link>

        <div className="anc-story-top">
          <ScoreBadge score={story.significance_score ?? 0} style="pill" />
          <span className="anc-story-cat">{label}</span>
          <span className="anc-story-dot">·</span>
          <span className="anc-story-time">{timeAgo(story.first_published_at)}</span>
        </div>

        <h1 className="anc-story-h1">{story.headline}</h1>

        {summary && <p className="anc-story-sum">{summary}</p>}

        <ShareMenu url={url} title={story.headline} summary={story.summary} />

        {story.models.length > 0 && (
          <div className="anc-story-models">
            <span className="lbl">Models</span>
            {story.models.map((m) => (
              <Link key={m.slug} href={`/models/${m.slug}`} className="anc-story-model">{m.name}</Link>
            ))}
          </div>
        )}

        <section className="anc-story-sources">
          <h2>Covered by {story.articles.length} source{story.articles.length === 1 ? '' : 's'}</h2>
          <ul>
            {story.articles.map((a) => (
              <li key={a.id}>
                <SourceBubble name={a.source_name} size={20} />
                <a href={a.source_url} target="_blank" rel="noopener noreferrer" className="src">
                  {a.source_name}
                  <span className="ext">↗</span>
                </a>
                {a.author && <span className="by">{a.author}</span>}
                <span className="tm">{timeAgo(a.published_at)}</span>
              </li>
            ))}
          </ul>
        </section>

        {story.related.length > 0 && (
          <section className="anc-story-related">
            <h2>Related stories</h2>
            <div className="anc-story-relgrid">
              {story.related.map((r) => (
                <Link key={r.id} href={storyPath(r)} className="anc-story-relcard">
                  <span className="rc-cat">{CATEGORY_LABELS[r.category as Category] ?? r.category}</span>
                  <span className="rc-head">{r.headline}</span>
                  <span className="rc-meta">
                    {new Date(r.first_published_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}
                    {r.article_count > 1 ? ` · ${r.article_count} sources` : ''}
                  </span>
                </Link>
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  )
}
