'use client'

import type { Article, Cluster, Category } from '@/types/article'
import { ScoreOrbLarge } from './ScoreBadge'
import { SourceBubble } from './SourceBubble'
import { CATEGORY_LABELS } from './categoryMeta'
import { timeAgo } from '@/lib/timeFormat'

interface Props {
  cluster: Cluster & { articles: Article[] }
}

export function FeatureCard({ cluster }: Props) {
  const primary = cluster.articles[0]
  const category = cluster.category as Category
  const label = CATEGORY_LABELS[category] ?? category
  const score = cluster.significance_score ?? 0

  return (
    <article className="anc-feature">
      <ScoreOrbLarge score={score} />
      <div className="anc-fmain">
        <div className="anc-frow">
          <span className="anc-ftag">★ Top story · {label}</span>
          {primary && <span className="anc-ftime">{timeAgo(primary.published_at)}</span>}
        </div>
        <h3>{cluster.headline}</h3>
        {(cluster.summary ?? primary?.body_excerpt) && (
          <p className="anc-sum">{cluster.summary ?? primary?.body_excerpt}</p>
        )}
        <div className="anc-fsrc">
          {cluster.articles.slice(0, 3).map((a) => (
            <a
              className="anc-src"
              key={a.id}
              href={a.source_url}
              target="_blank"
              rel="noopener noreferrer"
            >
              <SourceBubble name={a.source_name} size={17} />
              {a.source_name}
            </a>
          ))}
          {primary && (
            <a
              className="anc-read"
              href={primary.source_url}
              target="_blank"
              rel="noopener noreferrer"
            >
              Read original ↗
            </a>
          )}
        </div>
      </div>
    </article>
  )
}
