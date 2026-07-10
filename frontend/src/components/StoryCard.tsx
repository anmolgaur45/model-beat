'use client'

import { useState } from 'react'
import Link from 'next/link'
import { AnimatePresence, motion } from 'framer-motion'
import type { Article, Cluster, Category } from '@/types/article'
import { ScoreBadge, type ScoreStyle } from './ScoreBadge'
import { receiptFromCluster } from '@/lib/scoreReceipt'
import { SourceBubble } from './SourceBubble'
import { CATEGORY_LABELS } from './categoryMeta'
import { timeAgo } from '@/lib/timeFormat'
import { storyPath } from '@/lib/story'
import { SharePopover } from './SharePopover'

interface Props {
  cluster: Cluster & { articles: Article[] }
  showDate?: boolean
  scoreStyle?: ScoreStyle
  highlight?: string
}

function highlightText(text: string, query: string): React.ReactNode {
  if (!query) return text
  const idx = text.toLowerCase().indexOf(query.toLowerCase())
  if (idx === -1) return text
  return (
    <>
      {text.slice(0, idx)}
      <mark className="anc-hl">{text.slice(idx, idx + query.length)}</mark>
      {text.slice(idx + query.length)}
    </>
  )
}

export function StoryCard({ cluster, showDate = false, scoreStyle = 'orb', highlight }: Props) {
  const [isOpen, setIsOpen] = useState(false)
  const primary = cluster.articles[0]
  const category = cluster.category as Category
  const label = CATEGORY_LABELS[category] ?? category
  const score = cluster.significance_score ?? 0
  const tier = score >= 8.5 ? 'high' : score >= 7 ? 'notable' : 'standard'
  const hnArticle = cluster.articles.find((a) => a.source_name === 'Hacker News')

  return (
    <div className={`anc-card tier-${tier}${isOpen ? ' open' : ''}`}>
      {/* Head is a div (not <button>) so the headline can be a real <a> — the
          permalink must be in the SSR HTML or the ~3k story pages are crawl
          orphans. Clicking the headline navigates; anywhere else still toggles. */}
      <div
        className="anc-card-head"
        role="button"
        tabIndex={0}
        onClick={() => setIsOpen((o) => !o)}
        onKeyDown={(e) => {
          // Only when the head itself is focused — Enter on the nested headline
          // <Link> must navigate, not toggle the card.
          if (e.target !== e.currentTarget) return
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            setIsOpen((o) => !o)
          }
        }}
      >
        <ScoreBadge score={score} style={scoreStyle} receipt={receiptFromCluster(cluster)} />

        <span className="anc-cmain">
          <h3>
            <Link
              className="anc-ctitle"
              href={storyPath(cluster)}
              onClick={(e) => e.stopPropagation()}
            >
              {highlightText(cluster.headline, highlight ?? '')}
            </Link>
          </h3>
          <span className="anc-cmeta">
            <span className="cat">{label}</span>
            <span>·</span>
            <span>
              {primary?.source_name ?? ''}
              {cluster.article_count > 1 ? ` +${cluster.article_count - 1}` : ''}
            </span>
            <span>·</span>
            {/* suppressHydrationWarning: relative times legitimately drift
                between the ISR-cached HTML and hydration ("7h ago" vs "8h
                ago"); without this React regenerates the whole tree. */}
            <span suppressHydrationWarning>{showDate ? new Date(cluster.first_published_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : timeAgo(cluster.first_published_at)}</span>
          </span>
        </span>

        {/* Stacked source bubbles */}
        <span className="anc-cfavs">
          {cluster.articles.slice(0, 3).map((a) => (
            <SourceBubble key={a.id} name={a.source_name} size={20} className="anc-bubble" />
          ))}
        </span>

        <svg className="anc-chev" width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M3 5l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>

      <SharePopover headline={cluster.headline} summary={cluster.summary ?? null} path={storyPath(cluster)} className="anc-cshare" />

      {cluster.models && cluster.models.length > 0 && (
        <div className="anc-cmodels">
          <span className="anc-cmodels-label">Models</span>
          {cluster.models.map((m) => (
            <Link key={m.slug} href={`/models/${m.slug}`} className="anc-cmodel">{m.name}</Link>
          ))}
        </div>
      )}

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <div className="anc-card-body">
              {(cluster.summary ?? primary?.body_excerpt) && (
                <p className="anc-sum">{cluster.summary ?? primary?.body_excerpt}</p>
              )}
              {cluster.articles.length > 0 && (
                <div className="anc-srclist">
                  <div className="anc-srclist-title">
                    {/* Real totals, not the 3-article display cap — must agree
                        with the score receipt's "N articles across M sources". */}
                    Coverage · {cluster.source_count ?? cluster.articles.length} source
                    {(cluster.source_count ?? cluster.articles.length) > 1 ? 's' : ''}
                    {cluster.article_count > cluster.articles.length ? ` · top ${cluster.articles.length} shown` : ''}
                  </div>
                  {cluster.articles.map((a) => (
                    <div className="anc-srcitem" key={a.id}>
                      <SourceBubble name={a.source_name} size={17} />
                      <a
                        href={a.source_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {a.source_name}
                      </a>
                      <span className="anc-srctime" suppressHydrationWarning>{timeAgo(a.published_at)}</span>
                    </div>
                  ))}
                  <div className="anc-card-actions" style={{ marginTop: 8 }}>
                    <Link
                      className="anc-read anc-full"
                      href={storyPath(cluster)}
                      onClick={(e) => e.stopPropagation()}
                    >
                      Open full story →
                    </Link>
                    {primary && (
                      <a
                        className="anc-read"
                        href={primary.source_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                      >
                        Read original ↗
                      </a>
                    )}
                    {hnArticle && (
                      <a
                        className="anc-read anc-discuss"
                        href={hnArticle.source_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                      >
                        💬 Discussion on Hacker News ↗
                      </a>
                    )}
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
