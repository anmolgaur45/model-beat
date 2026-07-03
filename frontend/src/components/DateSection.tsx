'use client'

import { useState, useEffect, useRef } from 'react'
import type { Article, Cluster } from '@/types/article'
import { StoryCard } from './StoryCard'
import { FeatureCard } from './FeatureCard'
import { PapersFold } from './PapersFold'
import { formatDateLabel } from '@/lib/timeFormat'
import { isPaperCluster } from '@/lib/papers'
import type { ScoreStyle } from './ScoreBadge'

type ClusterWithArticles = Cluster & { articles: Article[] }

const PAGE_SIZE = 6
// Only a genuinely high-signal story earns the prominent "top story" treatment.
// Below this, the lead is rendered as an ordinary card so a slow day isn't dressed up.
const TOP_STORY_MIN = 6

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <div className="anc-skel">
      <span className="anc-skel-sq anc-shimmer" />
      <span className="anc-skel-lines">
        <span className="anc-skel-ln anc-shimmer" style={{ width: '72%' }} />
        <span className="anc-skel-ln anc-shimmer" style={{ width: '38%' }} />
      </span>
    </div>
  )
}

export function SkeletonSection() {
  return (
    <div>
      <SkeletonCard />
      <SkeletonCard />
      <SkeletonCard />
      <SkeletonCard />
    </div>
  )
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState({ dateLabel }: { dateLabel: string }) {
  return (
    <div className="anc-statebox">
      <div className="anc-statebox-glyph">
        <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
          <rect x="3" y="4.5" width="16" height="14" rx="3" stroke="currentColor" strokeWidth="1.5" />
          <path d="M3 9h16M7.5 2.5v4M14.5 2.5v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </div>
      <h3>A quiet day in AI</h3>
      <p>No stories crossed the significance threshold on {dateLabel}. Even the models took a breather.</p>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

interface Props {
  date: string
  clusters: ClusterWithArticles[]
  scoreStyle?: ScoreStyle
}

export function DateSection({ date, clusters, scoreStyle = 'orb' }: Props) {
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)

  // Pure-arXiv paper clusters collapse into a shelf below the stories — a day
  // that's "20 stories · 80 papers" should read that way, not as a 100-item dump.
  const all = [...clusters].sort((a, b) => b.significance_score - a.significance_score)
  const sorted = all.filter((c) => !isPaperCluster(c))
  const papers = all.filter((c) => isPaperCluster(c))
  const label = formatDateLabel(date)

  // Promote the top cluster to the hero "top story" card only when it clears the
  // significance bar. Otherwise everything is an ordinary card in the list.
  const lead = sorted[0] && (sorted[0].significance_score ?? 0) >= TOP_STORY_MIN ? sorted[0] : null
  const cards = lead ? sorted.slice(1) : sorted
  const visible = cards.slice(0, visibleCount)
  const hasMore = visibleCount < cards.length

  // Honest signalling: stories ran, but nothing reached the "notable" tier (>= 7).
  // Better to say so than to dress up a slow news day. Today gets a softer line:
  // "quiet day" is a verdict, and the day isn't over yet.
  const isQuietDay = sorted.length > 0 && (sorted[0].significance_score ?? 0) < 7
  const quietLabel = label === 'Today' ? 'early on the beat · more lands all day' : 'quiet day · nothing major broke'

  // Infinite scroll: reveal the next page when the sentinel scrolls into view.
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => { setVisibleCount(PAGE_SIZE) }, [date])
  useEffect(() => {
    const el = sentinelRef.current
    if (!el || !hasMore) return
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) setVisibleCount((n) => n + PAGE_SIZE)
      },
      { rootMargin: '600px 0px' },
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [hasMore, visible.length])

  return (
    <section>
      <div className="anc-dhead">
        <h2 className="anc-dhead-label">{label}</h2>
        <span className="anc-dhead-count">
          {sorted.length} {sorted.length === 1 ? 'story' : 'stories'}
          {papers.length > 0 && <> · {papers.length} {papers.length === 1 ? 'paper' : 'papers'}</>}
        </span>
        {isQuietDay && <span className="anc-dhead-quiet">{quietLabel}</span>}
        <span className="anc-dhead-rule" />
      </div>

      {sorted.length === 0 && papers.length === 0 ? (
        <EmptyState dateLabel={label} />
      ) : (
        <>
          {lead && <FeatureCard cluster={lead} />}
          {visible.map((cluster) => (
            <StoryCard key={cluster.id} cluster={cluster} scoreStyle={scoreStyle} />
          ))}
          {hasMore && <div ref={sentinelRef} className="anc-scroll-sentinel" aria-hidden />}
          {/* Always rendered (the header advertises the paper count, so the shelf
              must be reachable without exhausting the infinite scroll) and keyed
              by date so open/collapsed state never leaks across day switches. */}
          <PapersFold key={date} papers={papers} scoreStyle={scoreStyle} defaultOpen={sorted.length < 6} />
        </>
      )}
    </section>
  )
}
