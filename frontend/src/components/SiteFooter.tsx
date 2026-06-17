import Link from 'next/link'
import { unstable_cache } from 'next/cache'
import sql from '@/lib/db'
import { BrandLockup } from '@/components/BrandLockup'

const SITE = process.env.NEXT_PUBLIC_URL ?? 'http://localhost:3000'

// Cached across requests (1h) so the footer doesn't query the DB on every page load.
const getRecentDays = unstable_cache(
  async (): Promise<string[]> => {
    try {
      const rows = await sql<{ day: string }[]>`
        SELECT DISTINCT to_char(first_published_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day
        FROM clusters
        WHERE first_published_at >= now() - interval '14 days'
        ORDER BY day DESC
        LIMIT 14
      `
      return rows.map((r) => r.day)
    } catch {
      return []
    }
  },
  ['footer-recent-days'],
  { revalidate: 3600 },
)

function shortLabel(day: string): string {
  return new Date(day + 'T12:00:00Z').toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

export async function SiteFooter() {
  const days = await getRecentDays()

  return (
    <footer className="anc-footer">
      <div className="anc-footer-inner">
        <div className="anc-footer-brand">
          <Link href="/" className="anc-footer-name" aria-label="Model Beat — Covering the AI beat, every day.">
            <BrandLockup tag />
          </Link>
          <p>The AI news that actually mattered — deduplicated, ranked by significance, every source cited.</p>
        </div>

        <nav className="anc-footer-col" aria-label="Site">
          <h2>Browse</h2>
          <Link href="/">Today</Link>
          <Link href="/models">Model tracker</Link>
          <a href="/feed.xml">RSS feed</a>
        </nav>

        {days.length > 0 && (
          <nav className="anc-footer-col" aria-label="Recent days">
            <h2>Recent archive</h2>
            <div className="anc-footer-days">
              {days.map((day) => (
                <Link key={day} href={`/day/${day}`}>{shortLabel(day)}</Link>
              ))}
            </div>
          </nav>
        )}
      </div>
      <div className="anc-footer-base">© {new Date().getUTCFullYear()} Model Beat</div>
    </footer>
  )
}
