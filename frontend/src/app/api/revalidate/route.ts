import { createHash, timingSafeEqual } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import sql from '@/lib/db'
import { SITE_URL } from '@/lib/site'
import { BEST_VIEWS } from '@/lib/bestModels'
import { comparePairs } from '@/lib/comparePairs'

export const maxDuration = 60

// IndexNow: instant submit of changed URLs to Bing (and, via Bing's index,
// DuckDuckGo + Ecosia + Yandex). Analytics 2026-07-23 showed a 2-day-old model
// page (Laguna S 2.1) catching the entire launch-day search spike because we
// were one of the few pages that existed for the query — pinging new pages the
// moment they change shortens Bing's discovery lag from days to hours, which is
// where that spike lives. Google ignores IndexNow (no-op for it), which is fine.
// Key is intentionally public: it's served at /<key>.txt to prove domain control.
const INDEXNOW_KEY = '9ea3f5f116df688bc7d57e7137d1fca2'

async function pingIndexNow(paths: string[]) {
  // Only the production apex has the key file; skip previews/local.
  if (SITE_URL !== 'https://themodelbeat.com') return
  const host = 'themodelbeat.com'
  const urlList = paths.map((p) => `${SITE_URL}${p}`)
  if (urlList.length === 0) return
  try {
    await fetch('https://api.indexnow.org/indexnow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host,
        key: INDEXNOW_KEY,
        keyLocation: `${SITE_URL}/${INDEXNOW_KEY}.txt`,
        urlList,
      }),
      signal: AbortSignal.timeout(10_000),
    })
  } catch {
    // A submission failure must never affect revalidation or the response.
  }
}

// Targeted revalidation (durable freshness, 2026-07-22). The pipeline calls this
// after each run instead of triggering a full-site rebuild via the deploy hook.
// A full rebuild every 3h prerendered 274 DB-backed pages in parallel, exhausted
// Cloud SQL's ~47 connections, and failed all-or-nothing (silent 12h staleness).
// This refreshes only the ~60 pages that can change: no heavy parallel build,
// can't exhaust connections, and one page's failure never blocks the others.
//
// Cost: story pages stay SSR (force-dynamic, zero ISR writes — they were the 2,224
// pages behind the original write-budget crisis). Only these aggregate/model/day
// pages enter ISR: ~60 paths x 8 runs/day is at most ~15k writes/month against
// the 200k budget, and a path only rewrites when it's next visited.
// NO layout-wide purge (revalidatePath('/', 'layout') is what over-spent before);
// every path is revalidated individually.
export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  const auth = req.headers.get('authorization') ?? ''
  // Constant-time compare (`!==` stops at the first differing character).
  // Hashing first gives equal lengths, which timingSafeEqual requires.
  const digest = (s: string) => createHash('sha256').update(s).digest()
  if (!secret || !timingSafeEqual(digest(auth), digest(`Bearer ${secret}`))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const done: string[] = []
  const revalidate = (path: string) => {
    try {
      revalidatePath(path)
      done.push(path)
    } catch {
      // One bad path never blocks the rest — the whole point of leaving the
      // all-or-nothing rebuild behind.
    }
  }

  // Fixed aggregate surfaces that change every run. The compare hub, sitemap,
  // feeds and llms.txt are not here: they are dynamic behind a CDN cache
  // (next.config.ts), which revalidatePath can't reach.
  for (const p of ['/', '/models', '/models/changes', '/digest']) {
    revalidate(p)
  }

  // Today + yesterday (UTC) day pages — the only day pages that move.
  const now = new Date()
  for (const offset of [0, 1]) {
    const d = new Date(now.getTime() - offset * 86400_000)
    revalidate(`/day/${d.toISOString().slice(0, 10)}`)
  }

  // Model detail pages that actually changed: a recent launch or a fresh event.
  // Bounded (~5-20 rows); never the whole registry.
  try {
    const changed = await sql<{ slug: string }[]>`
      SELECT DISTINCT slug FROM models m
      WHERE released_at > now() - interval '3 days'
         OR EXISTS (
           SELECT 1 FROM model_events e
           WHERE e.model_id = m.id AND e.detected_at > now() - interval '4 hours'
         )
    `
    for (const m of changed) revalidate(`/models/${m.slug}`)
  } catch {
    // A DB blip here must not fail the aggregate revalidations above.
  }

  // IndexNow gets only the pages above, whose content follows the news.
  const changedPaths = [...done]

  // Rankings and curated comparisons rank against the whole registry, so any
  // model change can move them. Until 2026-10-16 they only refreshed on a
  // deploy, 5-10 days apart. ~40 paths, regenerated only when next visited.
  for (const v of BEST_VIEWS) revalidate(`/models/best/${v.key}`)
  try {
    for (const p of await comparePairs()) revalidate(`/models/compare/${p.a}-vs-${p.b}`)
  } catch {
    // Same: a DB blip must not fail the revalidations above.
  }

  await pingIndexNow(changedPaths)

  return NextResponse.json({ revalidated: done.length, paths: done, at: now.toISOString() })
}
