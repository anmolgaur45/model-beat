import sql from '@/lib/db'
import { SITE_URL as SITE } from '@/lib/site'
import { comparePairs, pairModelNames } from '@/lib/comparePairs'
import { BEST_VIEWS } from '@/lib/bestModels'

export const dynamic = 'force-static'

// llms.txt — a curated, plain-text map of the site for AI crawlers/answer engines
// (https://llmstxt.org). Lists the high-value, data-rich pages we want cited,
// with one datum per model line so a crawler has a reason to prioritize it.
export async function GET() {
  const models = await sql<{
    slug: string
    name: string
    vendor: string | null
    price_in: number | null
    price_out: number | null
    context_window: number | null
    eci: number | null
  }[]>`
    SELECT m.slug, m.name, m.vendor, m.price_in, m.price_out, m.context_window,
      (SELECT score FROM model_benchmarks mb
        WHERE mb.model_id = m.id AND mb.benchmark = 'Epoch Capabilities Index') AS eci
    FROM models m
    WHERE m.released_at >= now() - interval '1 year'
    ORDER BY m.significance DESC NULLS LAST, m.released_at DESC NULLS LAST
    LIMIT 40
  `

  const fmtCtx = (n: number) =>
    n >= 1_000_000
      ? `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
      : `${Math.round(n / 1000)}K`
  const modelLines = models
    .map((m) => {
      const facts: string[] = []
      if (m.eci != null) facts.push(`ECI ${Math.round(m.eci)}`)
      if (m.price_in != null && m.price_out != null) facts.push(`$${m.price_in}/$${m.price_out} per 1M tokens`)
      if (m.context_window) facts.push(`${fmtCtx(m.context_window)} context`)
      const data = facts.length ? facts.join(', ') : 'benchmarks, pricing, specs, and news'
      return `- [${m.name}](${SITE}/models/${m.slug}): ${m.vendor ? `${m.vendor}. ` : ''}${data}.`
    })
    .join('\n')

  const [pairs, names] = await Promise.all([
    comparePairs().catch(() => []),
    pairModelNames().catch(() => new Map<string, string>()),
  ])
  const compareLines = pairs
    .map((p) => {
      const aName = names.get(p.a) ?? p.a
      const bName = names.get(p.b) ?? p.b
      return `- [${aName} vs ${bName}](${SITE}/models/compare/${p.a}-vs-${p.b}): side-by-side benchmarks and pricing.`
    })
    .join('\n')

  const rankingLines = BEST_VIEWS
    .map((v) => `- [${v.titleBase}](${SITE}/models/best/${v.key})`)
    .join('\n')

  const body = `# Model Beat

> Daily AI news organized by day — deduplicated across sources and ranked by significance — plus a model tracker with benchmarks, pricing, and specs for the latest AI models.

Model Beat covers the AI beat every day: model releases, research, company news, and product launches, with every story citing its original sources. The model tracker ranks large language models on standardized benchmarks (data from Epoch AI, CC BY, and Artificial Analysis) and on pricing and specifications (from OpenRouter), and links each model to the news about it.

## Key pages
- [AI news today](${SITE}/): the day's most significant AI stories, ranked by significance.
- [Model tracker](${SITE}/models): leaderboard of AI models by benchmark, use case, and price.
- [Compare models](${SITE}/models/compare): side-by-side comparison of AI models — benchmarks, pricing, and context window.
- [Weekly digest](${SITE}/digest): the week in AI models by email, every Thursday.
- [About](${SITE}/about): who runs Model Beat, methodology, and data sources.

## Rankings
${rankingLines}

## Comparisons
${compareLines}

## Models
${modelLines}

## About
- Benchmark and model data: Epoch AI (CC BY) and Artificial Analysis. Pricing and specs: OpenRouter.
- All news stories cite their original source with a direct link, timestamp, and author when available.
`

  return new Response(body, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=0, s-maxage=86400, stale-while-revalidate',
    },
  })
}
