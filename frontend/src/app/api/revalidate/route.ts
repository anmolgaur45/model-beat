import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import sql from '@/lib/db'
import { storyPath } from '@/lib/story'

// Called by the pipeline after each run. Purges are TARGETED: the old
// revalidatePath('/', 'layout') invalidated every ISR page (~3,400) eight
// times a day, and crawler re-visits after each purge burned ISR writes at
// ~100k/day — 75% of the Hobby plan's 200k/month in 36 hours (Vercel limit
// email, 2026-07-12). Only the surfaces a run actually changes get purged;
// everything else ages out on its own (long) revalidate window.
export async function POST(request: Request) {
  const auth = request.headers.get('authorization')

  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  // Fixed surfaces that reflect every run.
  revalidatePath('/')
  revalidatePath('/digest')
  revalidatePath('/models')
  revalidatePath('/models/changes')

  // Today's and yesterday's day pages (late coverage lands on yesterday).
  const now = new Date()
  const day = (d: Date) => d.toISOString().slice(0, 10)
  revalidatePath(`/day/${day(now)}`)
  revalidatePath(`/day/${day(new Date(now.getTime() - 86_400_000))}`)

  // Only the stories whose coverage changed in this run's window; their
  // pages otherwise sit on a 7-day TTL. Path must match the cached URL, so
  // build it with the same storyPath helper the links use.
  const changed = await sql<{ id: string; headline: string }[]>`
    SELECT DISTINCT c.id, c.headline
    FROM clusters c JOIN articles a ON a.cluster_id = c.id
    WHERE a.created_at > now() - interval '4 hours'
  `
  for (const c of changed) revalidatePath(storyPath(c))

  return NextResponse.json({
    revalidated: true,
    stories: changed.length,
    at: new Date().toISOString(),
  })
}
