import { NextRequest, NextResponse } from 'next/server'
import sql from '@/lib/db'
import { checkRateLimit } from '@/lib/rate-limit'

export const maxDuration = 60

/**
 * Resets cluster assignments for articles in the last N hours.
 * After running this, execute the Python pipeline to re-cluster.
 */
export async function POST(req: NextRequest) {
  // Refuse outright when the secret is unset — otherwise the expected value is
  // the literal string "Bearer undefined" and anyone can wipe clusters.
  const secret = process.env.INGEST_SECRET
  const auth = req.headers.get('authorization') ?? ''
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const rl = checkRateLimit('recluster', { maxRequests: 5, windowMs: 10 * 60_000 })
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } },
    )
  }

  let windowHours = 48
  try {
    const body = await req.json()
    if (typeof body.windowHours === 'number') {
      windowHours = Math.min(Math.max(body.windowHours, 1), 168)
    }
  } catch {
    // use default
  }

  const windowStart = new Date(Date.now() - windowHours * 60 * 60 * 1000).toISOString()

  const articles = await sql<{ id: string; cluster_id: string | null }[]>`
    SELECT id, cluster_id FROM articles
    WHERE published_at >= ${windowStart}
    AND embedding IS NOT NULL
  `

  if (articles.length === 0) {
    return NextResponse.json({ message: 'No articles in window', reset: 0 })
  }

  const articleIds = articles.map((a) => a.id)
  const clusterIds = [...new Set(
    articles.map((a) => a.cluster_id).filter(Boolean)
  )] as string[]

  // One transaction (a crash between the update and the delete used to strand
  // unclustered articles next to their still-live clusters). Only clusters left
  // empty are deleted: deleting a cluster that still has members outside the
  // window fired the FK's ON DELETE SET NULL on them, and the pipeline only
  // re-clusters recent articles, so those old members were orphaned forever.
  let clustersDeleted = 0
  await sql.begin(async (tx) => {
    await tx`UPDATE articles SET cluster_id = NULL WHERE id = ANY(${articleIds})`

    if (clusterIds.length > 0) {
      const deleted = await tx`
        DELETE FROM clusters
        WHERE id = ANY(${clusterIds})
        AND NOT EXISTS (SELECT 1 FROM articles a WHERE a.cluster_id = clusters.id)
      `
      clustersDeleted = deleted.count
      // Surviving clusters (kept for their out-of-window members) shrank:
      // refresh their counts and window start.
      await tx`
        UPDATE clusters c SET
          article_count      = (SELECT COUNT(*) FROM articles a WHERE a.cluster_id = c.id),
          first_published_at = (SELECT MIN(published_at) FROM articles a WHERE a.cluster_id = c.id)
        WHERE c.id = ANY(${clusterIds})
        AND EXISTS (SELECT 1 FROM articles a WHERE a.cluster_id = c.id)
      `
    }
  })

  return NextResponse.json({
    windowHours,
    reset: articleIds.length,
    clustersDeleted,
    message: 'Clusters reset. Run the Python pipeline to re-cluster.',
  })
}
