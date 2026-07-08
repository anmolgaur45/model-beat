import Link from 'next/link'

// Compact, labeled "model tracker" strip under the ticker. Demoted from a
// hero-weight panel (2026-07-08, repeated Reddit feedback: two competing hero
// pitches muddled what the site is). The strip keeps the news↔models join
// visible and the /models entry prominent without contesting the page's
// identity; the news feed below is the primary product.
export interface TopModel {
  slug: string
  name: string
  vendor: string | null
  score: number // overall intelligence composite (0–100)
}

export function HeroModelBand({ models }: { models: TopModel[] }) {
  if (models.length === 0) return null

  return (
    <section className="anc-mstrip" aria-label="Model tracker: top models">
      <span className="anc-mstrip-label">Model tracker</span>
      <ol className="anc-mstrip-list">
        {models.slice(0, 3).map((m, i) => (
          <li key={m.slug}>
            <span className="rk">{i + 1}</span>
            <Link href={`/models/${m.slug}`} className="nm">{m.name}</Link>
            <span className="sc">{m.score}</span>
          </li>
        ))}
      </ol>
      <span className="anc-mstrip-links">
        <Link href="/models">Full leaderboard →</Link>
        <Link href="/models/compare">Compare</Link>
      </span>
    </section>
  )
}
