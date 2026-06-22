import sql from '@/lib/db'
import { SITE_URL as SITE } from '@/lib/site'

export const revalidate = 86400

// llms.txt — a curated, plain-text map of the site for AI crawlers/answer engines
// (https://llmstxt.org). Lists the high-value, data-rich pages we want cited.
export async function GET() {
  const models = await sql<{ slug: string; name: string; vendor: string | null }[]>`
    SELECT slug, name, vendor FROM models
    WHERE released_at >= now() - interval '1 year'
    ORDER BY significance DESC NULLS LAST, released_at DESC NULLS LAST
    LIMIT 40
  `

  const modelLines = models
    .map((m) => `- [${m.name}](${SITE}/models/${m.slug}): ${m.vendor ? `${m.vendor} — ` : ''}benchmarks, pricing, specs, and news.`)
    .join('\n')

  const body = `# Model Beat

> Daily AI news organized by day — deduplicated across sources and ranked by significance — plus a model tracker with benchmarks, pricing, and specs for the latest AI models.

Model Beat covers the AI beat every day: model releases, research, company news, and product launches, with every story citing its original sources. The model tracker ranks large language models on standardized benchmarks (data from Epoch AI, CC BY) and on pricing and specifications (from OpenRouter), and links each model to the news about it.

## Key pages
- [AI news today](${SITE}/): the day's most significant AI stories, ranked by significance.
- [Model tracker](${SITE}/models): leaderboard of AI models by benchmark, use case, and price.
- [Compare models](${SITE}/models/compare): side-by-side comparison of AI models — benchmarks, pricing, and context window.

## Models
${modelLines}

## About
- Benchmark and model data: Epoch AI (CC BY). Pricing and specs: OpenRouter.
- All news stories cite their original source with a direct link, timestamp, and author when available.
`

  return new Response(body, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=0, s-maxage=86400, stale-while-revalidate',
    },
  })
}
