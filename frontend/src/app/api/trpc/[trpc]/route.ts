import { fetchRequestHandler } from '@trpc/server/adapters/fetch'
import { appRouter } from '@/server/routers/_app'
import { createContext } from '@/server/trpc'

// Edge cache for read-only public queries (2026-10-09). Picking a date on the
// homepage ran the iad1 function and three Cloud SQL queries on every click with
// nothing cached (0.6-1.6s warm, several seconds cold). `Vercel-CDN-Cache-Control`
// caches at Vercel's edge only: zero ISR writes, the same mechanism /story uses
// (next.config.ts). The context is empty (no per-user data), so a cached
// response is identical for every visitor. Search and everything else stay live.
const SHORT = 'max-age=300, stale-while-revalidate=1800, stale-if-error=86400'
// A past day's list only moves when one of its stories later gains coverage
// (peak_date), so 3h, the pipeline cadence, is fresh enough.
const LONG = 'max-age=10800, stale-while-revalidate=86400, stale-if-error=86400'

function clustersPolicy(input: unknown): string {
  const date = (input as { date?: unknown } | undefined)?.date
  if (typeof date !== 'string') return SHORT
  // Two days of slack: visitors east of UTC are already on tomorrow's date.
  const cutoff = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10)
  return date < cutoff ? LONG : SHORT
}

const CACHEABLE: Record<string, (input: unknown) => string> = {
  'articles.getClusters': clustersPolicy,
  'articles.getTopStories': () => SHORT,
  'articles.getRecap': () => SHORT,
}

const handler = (req: Request) =>
  fetchRequestHandler({
    endpoint: '/api/trpc',
    req,
    router: appRouter,
    createContext,
    responseMeta({ info, type, errors }) {
      if (req.method !== 'GET' || type !== 'query' || errors.length > 0 || !info?.calls.length) return {}
      const policies: string[] = []
      for (const call of info.calls) {
        const policy = CACHEABLE[call.path]
        if (!policy) return {}
        policies.push(policy(call.result()))
      }
      // A batched request is only as cacheable as its freshest member.
      return { headers: { 'Vercel-CDN-Cache-Control': policies.includes(SHORT) ? SHORT : LONG } }
    },
  })

export { handler as GET, handler as POST }
