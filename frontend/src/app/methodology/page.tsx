import type { Metadata } from 'next'
import Link from 'next/link'
import { NavBar } from '@/components/NavBar'
import { SITE_URL } from '@/lib/site'

export const metadata: Metadata = {
  title: 'Methodology: how stories are grouped and scored',
  description:
    'How Model Beat deduplicates AI news and computes the 1-10 significance score: authority-weighted coverage, corroboration, and AI-rated impact, explained openly.',
  alternates: { canonical: '/methodology' },
}

// Static, content-only page; nothing here reads the database.

export default function MethodologyPage() {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: 'Model Beat methodology',
    url: `${SITE_URL}/methodology`,
    description:
      'How Model Beat groups duplicate AI news coverage into stories and computes each story’s significance score.',
  }

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <NavBar />
      <main className="anc-sw">
        <Link className="anc-day-back" href="/">← Back to Model Beat</Link>
        <div className="anc-kicker">Methodology</div>
        <h1 className="anc-sw-h1">How stories are grouped and scored</h1>
        <p className="anc-sw-lead">
          Every ranking on this site comes from a written-down process, not an editor&apos;s mood
          and not engagement metrics. This page explains that process in plain language, including
          the parts where AI models are involved and the limits of what the score means.
        </p>

        <section className="anc-sw-prose">
          <h2 id="grouping">How stories are grouped</h2>
          <p>
            Model Beat watches roughly 45 feeds (lab blogs, tech press, arXiv, Hacker News, and
            Google News queries that reach 1,300+ outlets) every 3 hours. When several outlets
            cover the same event, those articles are grouped into one story, so the feed shows
            events rather than fifteen copies of the same headline.
          </p>
          <p>
            Grouping compares the meaning of headlines and excerpts using text embeddings, with a
            deliberately strict similarity bar: two different stories shown as one would mislead
            you, while one story split in two is merely quieter. Because short headlines about the
            same event sometimes phrase it too differently for embeddings alone, borderline pairs
            get a second check: a small language model is asked whether two headlines describe the
            same event, and only a clear yes merges them. If that check fails or is unavailable,
            nothing merges. The system&apos;s mistakes are built to lean toward splitting, never
            toward false merging.
          </p>

          <h2 id="significance">How the significance score is computed</h2>
          <p>The 1-10 score on every story combines three signals:</p>
          <ul>
            <li>
              <b>Who is covering it.</b>{" "}Each outlet carries an authority weight: a top lab&apos;s
              own announcement or a major wire service counts for more than an aggregator or a
              syndicated local affiliate. Weights apply per organization, so two blogs owned by
              the same company count once.
            </li>
            <li>
              <b>How many independent organizations corroborate it.</b>{" "}More distinct, credible
              newsrooms raise the score, with diminishing returns and weighted by quality:
              sixteen syndicated copies of one wire story cannot outrank original reporting from
              two major outlets.
            </li>
            <li>
              <b>How consequential the content is.</b>{" "}An LLM rates each
              article&apos;s impact on a 1-10 rubric: routine updates land 3-4, notable launches
              5-6, major releases from top labs 7-8, and 9-10 is reserved for paradigm-shifting
              events. We disclose this openly: an LLM rates impact, and its ratings are bounded so
              one bad grade cannot dominate a well-corroborated story.
            </li>
          </ul>
          <p>
            The three signals multiply together and are compressed onto the 1-10 display scale so
            the top stays meaningful: a single announcement from a top lab lands around 5, a story
            corroborated across many major outlets lands around 8, and 10 is reserved for the
            handful of stories a year that everyone covers. Click any score badge to see that
            story&apos;s own inputs: how many articles, how many sources, and the impact rating.
          </p>

          <h2 id="limits">What the score is not</h2>
          <ul>
            <li>
              <b>Not a truth score.</b>{" "}It measures the weight and breadth of coverage plus rated
              impact, not whether claims in the coverage are correct.
            </li>
            <li>
              <b>Not personalized.</b>{" "}A story that matters enormously to your stack may score 4
              because few outlets covered it. That is what the{' '}
              <Link href="/models">model tracker</Link> and its price-change records are for.
            </li>
            <li>
              <b>Not engagement-based.</b>{" "}Clicks, likes, and shares play no part, which is a
              deliberate anti-hype choice.
            </li>
          </ul>

          <h2 id="citations">Sources and citations</h2>
          <p>
            Every story card names its sources, links directly to the original articles, and shows
            timestamps. Excerpts stay short, and summaries are original text written per story,
            never copied phrasing. Model data comes from{' '}
            <a href="https://epoch.ai" target="_blank" rel="noopener noreferrer">Epoch AI</a>{' '}
            (benchmarks, CC-BY) and{' '}
            <a href="https://openrouter.ai" target="_blank" rel="noopener noreferrer">OpenRouter</a>{' '}
            (pricing and specs), credited on every model page.
          </p>

          <p>
            Think a story was scored wrong? <Link href="/about">Tell me</Link>. The scoring rules
            have changed before in response to measured mistakes, and that is by design.
          </p>
        </section>
      </main>
    </>
  )
}
