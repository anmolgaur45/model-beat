import sql from '@/lib/db'

// A day is "substantive" if it carries at least this many clusters that have
// real (non-arXiv) coverage. Same bar everywhere: the day page's robots meta,
// the prev/next archive chain, the sitemap, and the prerender list.
export const DAY_INDEX_MIN_STORIES = 3

export type SubstantiveDay = { day: string; last: string }

// This query is expensive and does not get cheaper on its own: it walks every
// cluster in a 370-day window and probes `articles`, which is ~318 MB on a
// 0.6 GB db-f1-micro, so a cold run sequential-scans and takes ~30s. It used to
// run THREE times over, once in generateStaticParams, once in the sitemap, and
// once PER DAY PAGE for the prev/next links. On Vercel's single-worker builder
// that last one alone was ~46 x 30s, which blew Next's 60s per-page limit,
// triggered its 3x retry, and turned a 1-minute deploy into a 25-minute one
// (2026-08-27). The result is one small list, identical for every caller, so it
// is computed once per process and shared.
//
// The 370-day window is a superset of every caller's needs. Per-day counts come
// from GROUP BY day, so narrowing the window afterwards in JS gives exactly the
// same answer as narrowing it in SQL.
const TTL_MS = 10 * 60 * 1000

let cached: { at: number; rows: Promise<SubstantiveDay[]> } | null = null

export function substantiveDays(): Promise<SubstantiveDay[]> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.rows

  const rows = sql<SubstantiveDay[]>`
    SELECT to_char(first_published_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
           max(created_at) AS last
    FROM clusters c
    WHERE first_published_at >= now() - interval '370 days'
      AND EXISTS (SELECT 1 FROM articles a
                  WHERE a.cluster_id = c.id AND a.source_name NOT LIKE 'arXiv%')
    GROUP BY day
    HAVING count(*) >= ${DAY_INDEX_MIN_STORIES}
    ORDER BY day DESC
  `.then((r) => [...r]) as Promise<SubstantiveDay[]>

  // Don't poison the cache with a rejected promise: a transient DB error would
  // otherwise be served for the full TTL.
  rows.catch(() => {
    if (cached?.rows === rows) cached = null
  })

  cached = { at: Date.now(), rows }
  return rows
}

/** Nearest substantive days on either side, the crawlable archive chain. */
export async function adjacentDays(
  date: string,
): Promise<{ prev: string | null; next: string | null }> {
  const days = await substantiveDays()
  let prev: string | null = null
  let next: string | null = null
  // days is sorted DESC, so the first entry below `date` is the nearest previous
  // and the last entry above it is the nearest next.
  for (const { day } of days) {
    if (day < date) {
      if (prev === null || day > prev) prev = day
    } else if (day > date) {
      if (next === null || day < next) next = day
    }
  }
  return { prev, next }
}

/** Days to prerender: the recent slice of the substantive set. */
export async function recentSubstantiveDays(windowDays: number): Promise<string[]> {
  const days = await substantiveDays()
  const cutoff = new Date(Date.now() - windowDays * 86_400_000)
    .toISOString()
    .slice(0, 10)
  return days.filter((d) => d.day >= cutoff).map((d) => d.day)
}
