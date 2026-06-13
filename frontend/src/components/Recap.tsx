'use client'

import type { Article, Cluster } from '@/types/article'
import { StoryCard } from './StoryCard'
import { formatDateLabel } from '@/lib/timeFormat'

type ClusterWithArticles = Cluster & { articles: Article[] }

function localDay(iso: string): string {
  const d = new Date(iso)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

interface Props {
  clusters: ClusterWithArticles[]
  days: number
  onClose: () => void
}

export function Recap({ clusters, days, onClose }: Props) {
  // Clusters arrive sorted by significance; group into local days, newest first,
  // keeping the significance order within each day.
  const byDay = new Map<string, ClusterWithArticles[]>()
  for (const c of clusters) {
    const key = localDay(c.first_published_at)
    const arr = byDay.get(key) ?? []
    arr.push(c)
    byDay.set(key, arr)
  }
  const dayKeys = [...byDay.keys()].sort((a, b) => (a < b ? 1 : -1))

  return (
    <>
      <div className="anc-results-head">
        <h2>Catch me up</h2>
        <span className="anc-results-count">
          {clusters.length} {clusters.length === 1 ? 'STORY' : 'STORIES'} · LAST {days} DAYS
        </span>
        <button className="anc-results-back" onClick={onClose}>
          ← Back to today
        </button>
      </div>

      {clusters.length === 0 ? (
        <div className="anc-statebox">
          <div className="anc-statebox-glyph">
            <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
              <rect x="3" y="4.5" width="16" height="14" rx="3" stroke="currentColor" strokeWidth="1.5" />
              <path d="M3 9h16M7.5 2.5v4M14.5 2.5v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </div>
          <h3>Nothing major to catch up on</h3>
          <p>No stories cleared the significance bar in the last {days} days. A quiet stretch.</p>
        </div>
      ) : (
        dayKeys.map((key) => {
          const dayClusters = byDay.get(key) ?? []
          return (
            <section key={key}>
              <div className="anc-dhead">
                <h2 className="anc-dhead-label">{formatDateLabel(key)}</h2>
                <span className="anc-dhead-count">
                  {dayClusters.length} {dayClusters.length === 1 ? 'story' : 'stories'}
                </span>
                <span className="anc-dhead-rule" />
              </div>
              {dayClusters.map((c) => (
                <StoryCard key={c.id} cluster={c} showDate={false} />
              ))}
            </section>
          )
        })
      )}
    </>
  )
}
