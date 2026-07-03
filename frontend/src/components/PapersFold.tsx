'use client'

import { useState } from 'react'
import type { Article, Cluster } from '@/types/article'
import { StoryCard } from './StoryCard'
import type { ScoreStyle } from './ScoreBadge'

type ClusterWithArticles = Cluster & { articles: Article[] }

// Shelf for pure-arXiv paper clusters at the bottom of a day's list. Collapsed
// by default so story-rich days read as editorial pages, not database dumps
// (papers absent from the initial HTML until expanded). On sparse days it
// starts open instead — see defaultOpen. Solo paper clusters' own story pages
// are noindexed either way, so nothing rankable is lost.
export function PapersFold({ papers, scoreStyle = 'orb', defaultOpen = false }: { papers: ClusterWithArticles[]; scoreStyle?: ScoreStyle; defaultOpen?: boolean }) {
  // On sparse days (early mornings) the shelf starts expanded: the papers ARE
  // the day's content so far, and the page should not look empty.
  const [open, setOpen] = useState(defaultOpen)
  if (papers.length === 0) return null

  return (
    <div className="anc-papersfold">
      <button
        className="anc-papersfold-head"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span className="anc-papersfold-label">
          Research papers · {papers.length}
        </span>
        <span className="anc-papersfold-hint">
          {open ? 'collapse' : 'new on arXiv this day'}
        </span>
        <svg
          className={`anc-chev${open ? ' is-open' : ''}`}
          width="14" height="14" viewBox="0 0 14 14" fill="none"
        >
          <path d="M3 5l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && papers.map((c) => <StoryCard key={c.id} cluster={c} scoreStyle={scoreStyle} />)}
    </div>
  )
}
