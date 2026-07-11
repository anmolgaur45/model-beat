import type { Metadata } from 'next'
import Link from 'next/link'
import { SITE_URL } from '@/lib/site'
import { NavBar } from '@/components/NavBar'

const SITE = SITE_URL
const CONTACT = 'anmolgaur45@gmail.com'
const UPDATED = 'July 11, 2026'

export const metadata: Metadata = {
  title: 'Terms of Service',
  description: 'The terms for using Model Beat: what the service is, what you can rely on, and where the data comes from.',
  alternates: { canonical: `${SITE}/terms` },
}

export default function TermsPage() {
  return (
    <div className="aurora-stage">
      <div className="aurora-layer">
        <div className="aurora-blob aurora-blob-1" />
        <div className="aurora-blob aurora-blob-2" />
        <div className="aurora-blob aurora-blob-3" />
      </div>

      <NavBar />

      <main className="anc-legal">
        <Link className="anc-day-back" href="/">← Back to Model Beat</Link>
        <div className="anc-kicker">Legal</div>
        <h1>Terms of Service</h1>
        <p className="anc-legal-updated">Last updated {UPDATED}</p>

        <h2>What Model Beat is</h2>
        <p>
          Model Beat aggregates AI industry news and tracks AI models, benchmarks, and pricing. We
          show headlines, short excerpts, and our own summaries and scores, and every story links to
          the original source. The full articles belong to the publications that wrote them.
        </p>

        <h2>Using the site</h2>
        <p>
          The site and the weekly digest are free. Use them for anything lawful, including inside
          your company. Don&rsquo;t do things that degrade the service for others, such as flooding
          the site or the signup forms with automated requests.
        </p>

        <h2>Data accuracy</h2>
        <p>
          Benchmark scores, prices, and context windows come from public sources we cite (Epoch AI,
          OpenRouter, Artificial Analysis, and the providers themselves) and are refreshed
          automatically. We work to keep them correct but they can lag or contain errors, so verify
          against the provider before decisions that depend on them. Significance scores and
          summaries are our own editorial output, produced the way our{' '}
          <Link href="/methodology">methodology</Link> describes.
        </p>

        <h2>No warranty</h2>
        <p>
          The service is provided as is, without warranties of any kind. To the extent the law
          allows, we are not liable for losses arising from use of the site, the data, or the
          digest. Nothing here is investment, legal, or purchasing advice.
        </p>

        <h2>The digest</h2>
        <p>
          Subscribing means we email you the digest, normally weekly. Every issue has a one-click
          unsubscribe, and our <Link href="/privacy">Privacy Policy</Link> covers how we handle your
          email address.
        </p>

        <h2>Our content</h2>
        <p>
          You may quote and share our summaries, scores, and charts with attribution and a link.
          Third-party headlines and excerpts remain the property of their publishers.
        </p>

        <h2>Changes</h2>
        <p>
          We may update these terms as the product evolves; the date above always reflects the
          current version. Material changes will be noted in the digest or on the site.
        </p>

        <h2>Contact</h2>
        <p>
          Questions about these terms: <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.
        </p>
      </main>
    </div>
  )
}
