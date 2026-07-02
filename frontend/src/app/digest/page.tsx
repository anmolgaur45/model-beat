import type { Metadata } from 'next'
import Link from 'next/link'
import { SITE_URL } from '@/lib/site'
import { NavBar } from '@/components/NavBar'
import { DigestForm } from '@/components/DigestForm'

const SITE = SITE_URL

export const metadata: Metadata = {
  title: 'The Model Beat Digest — the week in AI models, once a week',
  description:
    'A weekly email for people who build on LLMs: the stories that mattered, new models, price moves and deprecations from the Model Beat tracker. Free.',
  alternates: { canonical: `${SITE}/digest` },
  openGraph: {
    type: 'website',
    title: 'The Model Beat Digest — the week in AI models, once a week',
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

export default function DigestPage() {
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
            No spam, no selling your address. See our <Link href="/privacy">Privacy Policy</Link>.
          </p>
        </section>
      </main>
    </div>
  )
}
