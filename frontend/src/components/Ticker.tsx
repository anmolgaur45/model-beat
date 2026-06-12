'use client'

interface TickerStory {
  headline: string
  significance_score: number
}

interface Props {
  stories: TickerStory[]
}

export function Ticker({ stories }: Props) {
  if (stories.length === 0) return null

  const items = stories.map((s, i) => (
    <span className="anc-tick" key={i}>
      <span className="tick-score">{s.significance_score.toFixed(1)}</span>
      {s.headline}
    </span>
  ))

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
