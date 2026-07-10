import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { SITE_URL } from '@/lib/site'
import { NavBar } from '@/components/NavBar'
import { DigestForm } from '@/components/DigestForm'
import { getIssue, listIssues } from '@/lib/digestIssues'

const SITE = SITE_URL

// Phase W4: a sent issue as a page — the full free sample one click from the
// signup form, plus the SEO archive and sponsor proof. Fully static: pages
// exist only for committed content files.
export const dynamicParams = false

export function generateStaticParams() {
  return listIssues().map((i) => ({ date: i.date }))
}

export async function generateMetadata({ params }: { params: Promise<{ date: string }> }): Promise<Metadata> {
  const { date } = await params
  const issue = getIssue(date)
  if (!issue) return {}
  return {
    title: `${issue.meta.title} | Digest ${date}`,
    description: issue.meta.preview || `The Model Beat Digest issue of ${date}.`,
    alternates: { canonical: `${SITE}/digest/${date}` },
  }
}

function fmtDate(iso: string): string {
  return new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC',
  })
}

export default async function DigestIssuePage({ params }: { params: Promise<{ date: string }> }) {
  const { date } = await params
  const issue = getIssue(date)
  if (!issue) notFound()

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: issue.meta.title,
    datePublished: issue.meta.date,
    url: `${SITE}/digest/${issue.meta.date}`,
    author: { '@type': 'Person', name: 'Anmol Gaur', url: `${SITE}/about` },
    publisher: { '@type': 'NewsMediaOrganization', name: 'Model Beat', url: SITE },
    description: issue.meta.preview,
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
        <Link className="anc-day-back" href="/digest/archive">← All issues</Link>
        <div className="anc-kicker">The Model Beat Digest · {fmtDate(issue.meta.date)}</div>
        <h1 className="anc-sw-h1">{issue.meta.title}</h1>
        {issue.meta.preview && <p className="anc-sw-lead">{issue.meta.preview}</p>}

        <section className="anc-sw-prose anc-issue" dangerouslySetInnerHTML={{ __html: issue.html }} />

        <section className="anc-sw-cta">
          <h2>Get the next issue</h2>
          <p>Free, weekly, unsubscribe anytime. That&rsquo;s the whole pitch.</p>
          <DigestForm source="digest-issue" />
          <p className="anc-sw-fineprint">
            Free forever. No spam. One-click unsubscribe. See our <Link href="/privacy">Privacy Policy</Link>.
          </p>
        </section>
      </main>
    </div>
  )
}
