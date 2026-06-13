'use client'

import { trpc } from '@/lib/trpc'
import { NavBar } from '@/components/NavBar'
import { ScoreBadge } from '@/components/ScoreBadge'
import { SourceBubble } from '@/components/SourceBubble'
import { useTheme } from '@/hooks/useTheme'

const WINDOW_DAYS = 60

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export default function ModelsPage() {
  const { theme, toggle } = useTheme()
  const { data, isLoading } = trpc.articles.getModelReleases.useQuery(
    { days: WINDOW_DAYS, limit: 50 },
    { staleTime: 5 * 60_000 },
  )

  return (
    <div className="aurora-stage" suppressHydrationWarning>
      <div className="aurora-layer">
        <div className="aurora-blob aurora-blob-1" />
        <div className="aurora-blob aurora-blob-2" />
        <div className="aurora-blob aurora-blob-3" />
      </div>

      <NavBar theme={theme} onToggleTheme={toggle} showSearch={false} />

      <main className="anc-models">
        <header className="anc-models-head">
          <div className="anc-kicker">Model release tracker</div>
          <h1>Every model release, newest first</h1>
          <p>
            New AI models from the top labs over the last {WINDOW_DAYS} days —
            deduplicated across sources and ranked by significance.
          </p>
        </header>

        {isLoading ? (
          <div className="anc-models-empty">Loading releases…</div>
        ) : !data || data.length === 0 ? (
          <div className="anc-models-empty">No model releases in the last {WINDOW_DAYS} days.</div>
        ) : (
          <div className="anc-mtable">
            <div className="anc-mrow anc-mhead">
              <span>Date</span>
              <span>Release</span>
              <span>Coverage</span>
              <span>Score</span>
            </div>
            {data.map((c) => {
              const primary = c.articles[0]
              return (
                <div className="anc-mrow" key={c.id}>
                  <span className="anc-mdate">{fmtDate(c.first_published_at)}</span>
                  <span className="anc-mtitle">
                    {primary ? (
                      <a href={primary.source_url} target="_blank" rel="noopener noreferrer">
                        {c.headline}
                      </a>
                    ) : (
                      c.headline
                    )}
                  </span>
                  <span className="anc-mcov">
                    {c.articles.slice(0, 3).map((a) => (
                      <SourceBubble key={a.id} name={a.source_name} size={18} className="anc-bubble" />
                    ))}
                    {c.article_count > 1 && (
                      <span className="anc-mcov-n">+{c.article_count - 1}</span>
                    )}
                  </span>
                  <span className="anc-mscore">
                    <ScoreBadge score={c.significance_score} style="pill" />
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </main>
    </div>
  )
}
