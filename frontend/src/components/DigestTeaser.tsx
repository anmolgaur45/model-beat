import { appRouter } from '@/server/routers/_app'
import { createContext } from '@/server/trpc'
import { DigestTeaserCard } from '@/components/DigestTeaserCard'
import type { DigestTeaser as Teaser } from '@/types/article'

// The card sits in the root layout, so on dynamic pages (every /story render)
// it ran its 3 queries per request, on top of the page's own (2026-10-16 health
// check). It shows a week of data, so one fetch per server instance every 10
// minutes is plenty; same pattern as substantiveDays() in lib/days.ts.
const TTL_MS = 10 * 60 * 1000

let cached: { at: number; teaser: Promise<Teaser> } | null = null

function loadTeaser(): Promise<Teaser> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.teaser
  const teaser = appRouter.createCaller(createContext()).articles.getDigestTeaser()
  // Don't keep a rejected promise for the full TTL.
  teaser.catch(() => {
    if (cached?.teaser === teaser) cached = null
  })
  cached = { at: Date.now(), teaser }
  return teaser
}

// Phase W: server wrapper for the floating digest signup widget — fetches the
// composed teaser rows (trailing 7 days) once per page render and hands them
// to the client island, which handles pathname copy, scroll-triggered
// visibility, and dismissal. A signup card must never take a page down, so
// any fetch failure renders nothing.
export async function DigestTeaser() {
  try {
    const teaser = await loadTeaser()
    if (teaser.rows.length === 0) return null
    return <DigestTeaserCard teaser={teaser} />
  } catch {
    return null
  }
}
