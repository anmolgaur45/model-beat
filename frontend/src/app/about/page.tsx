import type { Metadata } from 'next'
import Link from 'next/link'
import { SITE_URL } from '@/lib/site'
import { NavBar } from '@/components/NavBar'

const SITE = SITE_URL

export const metadata: Metadata = {
  // absolute: the layout template would append "| Model Beat" and double-brand
  title: { absolute: 'About Model Beat' },
  description:
    'Who runs Model Beat, how the news pipeline and model tracker work, where the data comes from (Epoch AI, Artificial Analysis, OpenRouter), and how to reach us.',
  alternates: { canonical: `${SITE}/about` },
  openGraph: {
    type: 'website',
    title: 'About Model Beat',
    description:
      'Who runs Model Beat, how the pipeline works, and where the data comes from.',
    url: `${SITE}/about`,
  },
}

const JSONLD = {
  '@context': 'https://schema.org',
  '@type': 'AboutPage',
  name: 'About Model Beat',
  url: `${SITE}/about`,
  mainEntity: {
    '@type': 'NewsMediaOrganization',
    name: 'Model Beat',
    url: SITE,
    founder: {
      '@type': 'Person',
      name: 'Anmol Gaur',
      sameAs: ['https://github.com/anmolgaur45', 'https://www.linkedin.com/in/anmolgaur45/', 'https://x.com/0xanmolgaur'],
    },
  },
}

export default function AboutPage() {
  return (
    <div className="aurora-stage">
      <div className="aurora-layer">
        <div className="aurora-blob aurora-blob-1" />
        <div className="aurora-blob aurora-blob-2" />
        <div className="aurora-blob aurora-blob-3" />
      </div>

      <NavBar />

      <main className="anc-sw">
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(JSONLD) }} />
        <Link className="anc-day-back" href="/">← Back to Model Beat</Link>
        <div className="anc-kicker">About</div>
        <h1 className="anc-sw-h1">Covering the AI beat, every day.</h1>
        <p className="anc-sw-lead">
          Model Beat is an AI news tracker and model comparison site. It watches about 45 feeds
          around the clock, collapses the fifteen articles covering the same event into one story,
          ranks what is left by significance, and links the news to the models it is about. The
          model tracker follows 140+ models with benchmark scores, pricing, and specs, refreshed
          every few hours.
        </p>

        <section className="anc-sw-cta">
          <h2>How it works</h2>
          <p>
            A pipeline runs every 3 hours. It ingests from roughly 45 configured feeds (last month
            the stories it collected came from more than 1,300 different outlets), groups articles
            that cover the same event, and scores each story on source authority, breadth of
            coverage, and impact. Nothing is published without a citation: every story shows its
            original sources with direct links and timestamps, and the site never reproduces full
            article text.
          </p>

          <h2>Where the data comes from</h2>
          <p>
            Benchmark scores come from <a href="https://epoch.ai" rel="noopener noreferrer" target="_blank">Epoch AI</a>{' '}
            (CC BY) and <a href="https://artificialanalysis.ai" rel="noopener noreferrer" target="_blank">Artificial Analysis</a>.
            Pricing, context windows, and model specs come from{' '}
            <a href="https://openrouter.ai" rel="noopener noreferrer" target="_blank">OpenRouter</a>.
            News comes from the publishers credited on every story. When sources disagree or a
            model has no independent scores yet, the page says so instead of filling the gap.
          </p>

          <h2>Who makes it</h2>
          <p>
            I&rsquo;m Anmol Gaur, a data engineer. I built Model Beat solo because I kept finding out
            about model releases from three-day-old tweets, and I run it as an independent project.
            The code, the pipeline, and the editorial calls are mine. You can find me on{' '}
            <a href="https://www.linkedin.com/in/anmolgaur45/" rel="noopener noreferrer" target="_blank">LinkedIn</a>,{' '}
            <a href="https://x.com/0xanmolgaur" rel="noopener noreferrer" target="_blank">X</a>, and{' '}
            <a href="https://github.com/anmolgaur45" rel="noopener noreferrer" target="_blank">GitHub</a>,
            or get the weekly digest at <Link href="/digest">themodelbeat.com/digest</Link>.
          </p>

          <h2>Corrections and contact</h2>
          <p>
            If something here is wrong, tell me and I will fix it: email{' '}
            <a href="mailto:anmolgaur45@gmail.com">anmolgaur45@gmail.com</a> or reply to any digest
            issue. Corrections get made in place, quickly.
          </p>
        </section>
      </main>
    </div>
  )
}
