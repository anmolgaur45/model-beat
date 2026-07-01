import type { Metadata } from 'next'
import Link from 'next/link'
import { SITE_URL } from '@/lib/site'
import { NavBar } from '@/components/NavBar'
import { WaitlistForm } from '@/components/WaitlistForm'

const SITE = SITE_URL

export const metadata: Metadata = {
  title: 'AI Stack Watch — alerts when the models you use change',
  description:
    'Get told the moment a model you depend on is deprecated, drops in price, ships a new version, or gets beaten by a cheaper alternative. Early access.',
  alternates: { canonical: `${SITE}/stack-watch` },
  openGraph: {
    type: 'website',
    title: 'AI Stack Watch — alerts when the models you use change',
    description:
      'Deprecations, price drops, new versions, better alternatives. Stop getting blindsided by the models you ship on.',
    url: `${SITE}/stack-watch`,
  },
}

const ALERTS = [
  {
    tag: 'Deprecation',
    title: 'The model you ship on is being retired',
    body: 'Find out weeks ahead, not when your app starts erroring in production.',
  },
  {
    tag: 'Price drop',
    title: 'You are overpaying',
    body: 'The model you use just got cheaper, or a cheaper one now matches it. Get told, switch, save.',
  },
  {
    tag: 'New version',
    title: 'A new version shipped',
    body: 'See what actually changed before you upgrade, instead of finding out the hard way.',
  },
  {
    tag: 'Better option',
    title: 'Something beats it now',
    body: 'A new model tops yours on the benchmark you actually care about, at a price you like.',
  },
]

export default function StackWatchPage() {
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
        <div className="anc-kicker">Early access</div>
        <h1 className="anc-sw-h1">
          Stop getting blindsided when the models you depend on change.
        </h1>
        <p className="anc-sw-lead">
          New models, new versions, price changes, deprecations. It moves too fast to track by hand,
          and the one change that matters is the one you miss. Tell Stack Watch which models and tools
          you rely on, and it watches them for you. You only hear from it when something actually affects you.
        </p>

        <div className="anc-sw-grid">
          {ALERTS.map((a) => (
            <div className="anc-sw-card" key={a.tag}>
              <span className="anc-sw-tag">{a.tag}</span>
              <h3>{a.title}</h3>
              <p>{a.body}</p>
            </div>
          ))}
        </div>

        <section className="anc-sw-cta">
          <div className="anc-sw-sample" role="img" aria-label="Example Stack Watch alert">
            <span className="anc-sw-sample-flag">Example alert</span>
            <div className="anc-sw-sample-card">
              <div className="anc-sw-sample-head">
                <span className="anc-sw-tag">Deprecation</span>
                <span className="anc-sw-sample-model">GPT-5.5</span>
              </div>
              <p className="anc-sw-sample-title">OpenAI is retiring GPT-5.5 on August 1.</p>
              <p className="anc-sw-sample-text">
                You have about 6 weeks to migrate. Here are 3 models at similar quality and the same
                or lower price, ready to compare.
              </p>
            </div>
          </div>

          <h2>Want in?</h2>
          <p>
            Stack Watch isn’t live yet. I’m building it on top of Model Beat’s model and news tracking.
            Join the list and you’ll be first in, and you’ll help shape what it watches.
          </p>
          <WaitlistForm source="stack-watch" />
          <p className="anc-sw-fineprint">
            No spam. We&rsquo;ll only email you about Stack Watch. See our{' '}
            <Link href="/privacy">Privacy Policy</Link>.
          </p>
        </section>
      </main>
    </div>
  )
}
