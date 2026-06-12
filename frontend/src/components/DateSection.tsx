'use client'

import { useState } from 'react'
import type { Article, Cluster } from '@/types/article'
import { StoryCard } from './StoryCard'
import { FeatureCard } from './FeatureCard'
import { formatDateLabel } from '@/lib/timeFormat'
import type { ScoreStyle } from './ScoreBadge'

type ClusterWithArticles = Cluster & { articles: Article[] }

const PAGE_SIZE = 6

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

  const sorted = [...clusters].sort((a, b) => b.significance_score - a.significance_score)
  const label = formatDateLabel(date)
  const feature = sorted[0] ?? null
  const rest = sorted.slice(1)
  const visible = rest.slice(0, visibleCount)
  const hasMore = visibleCount < rest.length

  return (
    <section>
      <div className="anc-dhead">
        <h2 className="anc-dhead-label">{label}</h2>
        <span className="anc-dhead-count">{sorted.length} {sorted.length === 1 ? 'story' : 'stories'}</span>
        <span className="anc-dhead-rule" />
      </div>

      {sorted.length === 0 ? (
        <EmptyState dateLabel={label} />
      ) : (
        <>
          {feature && <FeatureCard cluster={feature} />}
          {visible.map((cluster) => (
            <StoryCard key={cluster.id} cluster={cluster} scoreStyle={scoreStyle} />
          ))}
          {hasMore && (
            <button className="anc-more" onClick={() => setVisibleCount((n) => n + PAGE_SIZE)}>
              Load more stories ({rest.length - visibleCount})
            </button>
          )}
        </>
      )}
    </section>
  )
}
