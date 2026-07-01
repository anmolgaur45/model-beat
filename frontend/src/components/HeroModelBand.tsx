import Link from 'next/link'

// Compact "model intelligence" band for the top of the homepage. Reframes the
// first impression toward the model-tracker wedge without demoting the news
// timeline below it. Data is a tiny top-5 slice computed server-side.
export interface TopModel {
  slug: string
  name: string
  vendor: string | null
  score: number // overall intelligence composite (0–100)
}

export function HeroModelBand({ models }: { models: TopModel[] }) {
  if (models.length === 0) return null

  return (
    <section className="anc-hband" aria-label="AI model intelligence">
      <div className="anc-hband-head">
        <div className="anc-kicker">Model intelligence</div>
        <h2 className="anc-hband-title">Track and compare every major AI model</h2>
        <p className="anc-hband-sub">
          Ranked on real benchmarks, with live pricing, context windows, and the news behind
          each release.
        </p>
        <div className="anc-hband-cta">
          <Link href="/models" className="anc-hband-btn primary">Open the leaderboard →</Link>
          <Link href="/models/compare" className="anc-hband-btn">Compare models</Link>
        </div>
      </div>

      <div className="anc-hband-panel">
        <div className="anc-hband-cap">Top by overall intelligence</div>
        <ol className="anc-hband-list">
          {models.map((m, i) => (
            <li key={m.slug}>
              <span className="rk">{i + 1}</span>
              <Link href={`/models/${m.slug}`} className="nm">{m.name}</Link>
              {m.vendor && <span className="vnd">{m.vendor}</span>}
              <span className="sc">{m.score}</span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}
