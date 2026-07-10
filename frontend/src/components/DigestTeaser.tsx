import { appRouter } from '@/server/routers/_app'
import { createContext } from '@/server/trpc'
import { DigestTeaserCard } from '@/components/DigestTeaserCard'

// Phase W: server wrapper for the floating digest signup widget — fetches the
// composed teaser rows (trailing 7 days) once per page render and hands them
// to the client island, which handles pathname copy, scroll-triggered
// visibility, and dismissal. A signup card must never take a page down, so
// any fetch failure renders nothing.
export async function DigestTeaser() {
  try {
    const caller = appRouter.createCaller(createContext())
    const teaser = await caller.articles.getDigestTeaser()
    if (teaser.rows.length === 0) return null
    return <DigestTeaserCard teaser={teaser} />
  } catch {
    return null
  }
}
