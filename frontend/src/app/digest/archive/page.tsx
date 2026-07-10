import type { Metadata } from 'next'
import Link from 'next/link'
import { SITE_URL } from '@/lib/site'
import { NavBar } from '@/components/NavBar'
import { listIssues } from '@/lib/digestIssues'

const SITE = SITE_URL

export const metadata: Metadata = {
  title: 'Past issues of The Model Beat Digest',
  description:
    'Every sent issue of the free weekly Model Beat digest, published in full: the AI stories that mattered, new models, price moves and deprecations.',
  alternates: { canonical: `${SITE}/digest/archive` },
}

function fmtDate(iso: string): string {
  return new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC',
  })
}

export default function DigestIssuesPage() {
  const issues = listIssues()

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: 'Past issues of The Model Beat Digest',
    url: `${SITE}/digest/archive`,
    hasPart: issues.map((i) => ({
      '@type': 'Article',
      headline: i.title,
      datePublished: i.date,
      url: `${SITE}/digest/${i.date}`,
    })),
  }

  return (
    <div className="aurora-stage">
      <div className="aurora-layer">
        <div className="aurora-blob aurora-blob-1" />
        <div className="aurora-blob aurora-blob-2" />
        <div className="aurora-blob aurora-blob-3" />
      </div>

      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <NavBar />

      <main className="anc-sw">
        <Link className="anc-day-back" href="/digest">← The digest</Link>
        <div className="anc-kicker">Past issues</div>
        <h1 className="anc-sw-h1">Every issue, in the open</h1>
        <p className="anc-sw-lead">
          The Model Beat Digest goes out every Thursday, free. Each sent issue is published here
          in full: read a few, then <Link href="/digest">get the next one in your inbox</Link>.
        </p>

        {issues.length === 0 ? (
          <p className="anc-sw-lead">The first issue lands here after the next Thursday send.</p>
        ) : (
          <div className="anc-iss-list">
            {issues.map((i) => (
              <Link key={i.date} href={`/digest/${i.date}`} className="anc-iss-card">
                <span className="anc-iss-date">{fmtDate(i.date)}</span>
                <span className="anc-iss-title">{i.title}</span>
                {i.preview && <span className="anc-iss-preview">{i.preview}</span>}
                <span className="anc-iss-read">Read the issue →</span>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
