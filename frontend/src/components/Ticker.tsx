'use client'

interface TickerStory {
  headline: string
  significance_score: number
  source_url?: string | null
}

interface Props {
  stories: TickerStory[]
}

export function Ticker({ stories }: Props) {
  if (stories.length === 0) return null

  const items = stories.map((s, i) => {
    const inner = (
      <>
        <span className="tick-score">{s.significance_score.toFixed(1)}</span>
        {s.headline}
      </>
    )
    return s.source_url ? (
      <a className="anc-tick" key={i} href={s.source_url} target="_blank" rel="noopener noreferrer">
        {inner}
      </a>
    ) : (
      <span className="anc-tick" key={i}>{inner}</span>
    )
  })

  return (
    <div className="anc-ticker">
      <span className="anc-ticker-label">
        <span className="anc-ticker-pulse" />
        TOP THIS WEEK
      </span>
      <div className="anc-ticker-viewport">
        <div className="ticker-track">
          {items}
          {items}
        </div>
      </div>
    </div>
  )
}
