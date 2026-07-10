import type { Metadata } from 'next'
import Link from 'next/link'
import { SITE_URL } from '@/lib/site'
import { appRouter } from '@/server/routers/_app'
import { createContext } from '@/server/trpc'
import type { DigestTeaser } from '@/types/article'
import { NavBar } from '@/components/NavBar'
import { DigestForm } from '@/components/DigestForm'
import { listIssues } from '@/lib/digestIssues'

const SITE = SITE_URL

// Phase W3: the page shows the product, not a description of it — the live
// week section below is the same data the Thursday issue is curated from,
// refreshed by the pipeline's revalidate call every 3 hours.
export const revalidate = 1800

export const metadata: Metadata = {
  // absolute: the layout template appends "| Model Beat", which double-brands
  title: { absolute: 'The Model Beat Digest: the week in AI models' },
  description:
    'A weekly email for people who build on LLMs: the stories that mattered, new models, price moves and deprecations from the Model Beat tracker. Free.',
  alternates: { canonical: `${SITE}/digest` },
  openGraph: {
    type: 'website',
    title: 'The Model Beat Digest: the week in AI models',
    description:
      'The stories that mattered, new models, price moves and deprecations. One email a week, for people who build on LLMs.',
    url: `${SITE}/digest`,
  },
}

const SECTIONS = [
  {
    tag: 'Top stories',
    title: 'What actually mattered this week',
    body: 'Ranked by our significance engine across 1,300+ outlets, deduplicated to one entry per story. No filler.',
  },
  {
    tag: 'Model moves',
    title: 'What changed in the tracker',
    body: 'New models, price changes, benchmark movements and deprecations, straight from the Model Beat registry.',
  },
  {
    tag: 'One take',
    title: 'A short builder’s note',
    body: 'One honest paragraph on what this week’s changes mean if you ship on these models. Written by a human.',
  },
]

export default async function DigestPage() {
  // The week's raw material (same composition rules as the floating card,
  // two extra rows). A fetch failure hides the section, never the page.
  let teaser: DigestTeaser | null = null
  try {
    const caller = appRouter.createCaller(createContext())
    teaser = await caller.articles.getDigestTeaser({ rows: 5 })
  } catch {}
  const issues = listIssues()

  return (
    <div className="aurora-stage">
      <div className="aurora-layer">
        <div className="aurora-blob aurora-blob-1" />
        <div className="aurora-blob aurora-blob-2" />
        <div className="aurora-blob aurora-blob-3" />
      </div>

      <NavBar />

      <main className="anc-sw">
        <Link className="anc-day-back" href="/">← Back to Model Beat</Link>
        <div className="anc-kicker">Free weekly email</div>
        <h1 className="anc-sw-h1">The week in AI models. One email, Thursdays.</h1>
        <p className="anc-sw-lead">
          Model Beat watches ~45 feeds around the clock and tracks 140+ models with benchmarks and
          pricing. The digest is the distilled version: what mattered, what changed, and what it
          means if you build on these models. Read it in three minutes, skip the other fifty tabs.
        </p>

        {teaser && teaser.rows.length > 0 && (
          <section className="anc-dgweek" aria-label="The week the digest is built from">
            <div className="anc-dgweek-head">
              <h2>This week on the beat</h2>
              <span className="anc-dgweek-live">live · updates every 3 hours</span>
            </div>
            <ul className="anc-dgweek-rows">
              {teaser.rows.map((r) => (
                <li key={r.key}>
                  <span className={`anc-dgweek-tick${r.kind === 'story' ? ' is-story' : ''}`} aria-hidden />
                  {r.href ? <Link href={r.href}>{r.text}</Link> : <span>{r.text}</span>}
                  {r.chip && <span className={`anc-dgc-chip ${r.tone}`}>{r.chip}</span>}
                </li>
              ))}
            </ul>
          </section>
        )}

        {issues.length > 0 && (
          <Link className="anc-dgprev" href="/digest/archive">
            <span className="anc-dgprev-label">Read the previous issues</span>
            <span className="anc-dgprev-count">
              {issues.length === 1 ? '1 issue' : `${issues.length} issues`}
            </span>
            <span className="anc-dgprev-arrow" aria-hidden>→</span>
          </Link>
        )}

        <div className="anc-sw-grid anc-digest-grid">
          {SECTIONS.map((s) => (
            <div className="anc-sw-card" key={s.tag}>
              <span className="anc-sw-tag">{s.tag}</span>
              <h3>{s.title}</h3>
              <p>{s.body}</p>
            </div>
          ))}
        </div>

        <section className="anc-sw-cta">
          <h2>Get the next issue</h2>
          <p>Free, weekly, unsubscribe anytime. That’s the whole pitch.</p>
          <DigestForm />
          <p className="anc-sw-fineprint">
            Free forever. No spam. One-click unsubscribe. See our <Link href="/privacy">Privacy Policy</Link>.
          </p>
        </section>
      </main>
    </div>
  )
}
