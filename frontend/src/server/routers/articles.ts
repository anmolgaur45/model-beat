import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { router, publicProcedure } from '../trpc'
import sql from '@/lib/db'
import type { Article, Cluster, DigestTeaser, Model, ModelBenchmark, ModelEvent } from '@/types/article'
import { BUCKETS } from '@/lib/modelBuckets'
import { composeRows, eventDelta, eventRank, floorFactRow, type FloorFact } from '@/lib/digestTeaser'

const CATEGORY_VALUES = [
  'model-releases', 'research-papers', 'company-news', 'product-launches',
  'regulation-policy', 'hardware-infrastructure', 'open-source', 'opinion-analysis', 'uncategorized',
] as const

const zCategory = z.enum(CATEGORY_VALUES).optional()
// Format AND real-calendar check: '2026-99-99' passes the regex but yields an
// Invalid Date whose toISOString() throws — a public-API 500 instead of a 400.
const zDateStr = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => {
    const d = new Date(s + 'T12:00:00Z')
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
  }, 'Invalid calendar date')
  .optional()

// Lightweight related-story shape returned by getCluster for card links.
export type RelatedStory = {
  id: string
  headline: string
  category: string
  significance_score: number
  first_published_at: string
  article_count: number
}

// Article columns to fetch — excludes the large embedding vector
const ARTICLE_COLS = sql`id, title, body_excerpt, source_name, source_url, author, published_at, raw_category, cluster_id, impact_score, created_at`

// ── Search synonym expansion ────────────────────────────────────────────────
const SEARCH_SYNONYMS: Record<string, string[]> = {
  chatgpt:   ['openai', 'gpt'],
  openai:    ['gpt', 'dall-e', 'sora', 'codex', 'whisper'],
  gpt:       ['openai'],
  anthropic: ['claude'],
  claude:    ['anthropic'],
  google:    ['gemini', 'deepmind', 'bard'],
  gemini:    ['google', 'deepmind'],
  deepmind:  ['google', 'gemini'],
  meta:      ['llama', 'meta ai'],
  llama:     ['meta'],
  mistral:   ['mixtral'],
  microsoft: ['copilot', 'phi'],
  copilot:   ['microsoft', 'github'],
  apple:     ['apple intelligence'],
  nvidia:    ['tensorrt', 'cuda'],
  huggingface: ['hugging face', 'transformers'],
  'hugging face': ['huggingface'],
  deepseek:  ['deep seek'],
  qwen:      ['alibaba', 'tongyi'],
  alibaba:   ['qwen', 'tongyi'],
  zhipu:     ['glm', 'chatglm', 'z.ai'],
  chatglm:   ['zhipu', 'glm'],
  kimi:      ['moonshot'],
  moonshot:  ['kimi'],
  cohere:    ['command-r', 'command r'],
  stability: ['stable diffusion', 'sdxl', 'stability ai'],
  'stable diffusion': ['stability', 'sdxl'],
  falcon:    ['tii', 'technology innovation institute'],
  sakana:    ['sakana ai'],
  reka:      ['reka ai', 'reka flash'],
  ai21:      ['jamba', 'ai21 labs'],
  jamba:     ['ai21', 'ai21 labs'],
  sarvam:    ['sarvam ai'],
}

function expandForFTS(query: string): string {
  const lower = query.toLowerCase().trim()
  const synonyms = SEARCH_SYNONYMS[lower]
  if (!synonyms) return query
  return [query, ...synonyms].map((t) => `"${t}"`).join(' OR ')
}

function expandForILIKE(query: string): string[] {
  const lower = query.toLowerCase().trim()
  const synonyms = SEARCH_SYNONYMS[lower]
  if (!synonyms) return [query]
  return [query, ...synonyms]
}

// Build the ECI lookup + per-bucket percentile-composite scorer from the full
// set of (model, benchmark, score) rows. Percentile is computed across whatever
// population is passed in, so callers must pass the *whole* registry's rows for
// scores to be comparable (a 90% GPQA and a 32% FrontierMath rank on one scale).
// Shared by getModels (index) and getModelsByIds (compare). All higher-is-better.
function buildScoreMaps(allBench: { model_id: string; benchmark: string; score: number }[]) {
  const eciByModel = new Map<string, number>()
  const byBenchmark = new Map<string, { m: string; s: number }[]>()
  for (const r of allBench) {
    if (r.benchmark === 'Epoch Capabilities Index') eciByModel.set(r.model_id, r.score)
    const arr = byBenchmark.get(r.benchmark) ?? []
    arr.push({ m: r.model_id, s: r.score })
    byBenchmark.set(r.benchmark, arr)
  }
  const pctByBenchmark = new Map<string, Map<string, number>>()
  for (const [bench, arr] of byBenchmark) {
    const n = arr.length
    const mp = new Map<string, number>()
    for (const { m, s } of arr) {
      const below = arr.filter((x) => x.s < s).length
      mp.set(m, n > 1 ? Math.round((below / (n - 1)) * 100) : 100)
    }
    pctByBenchmark.set(bench, mp)
  }
  const bucketScore = (modelId: string, benches: string[]): number | null => {
    const vals: number[] = []
    for (const b of benches) {
      const p = pctByBenchmark.get(b)?.get(modelId)
      if (p != null) vals.push(p)
    }
    return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null
  }
  return { eciByModel, bucketScore }
}

export const articlesRouter = router({
  getTopStories: publicProcedure
    .input(
      z.object({
        days: z.number().min(1).max(30).default(7),
        limit: z.number().min(1).max(20).default(6),
      }),
    )
    .query(async ({ input }) => {
      const since = new Date(Date.now() - input.days * 86_400_000).toISOString()
      // Carry the primary article's source URL (highest-significance article in
      // the cluster) so the ticker headlines can link to the original. id +
      // first_published_at feed the homepage's top-this-week ItemList permalinks.
      return sql<{ id: string; headline: string; significance_score: number; first_published_at: string; source_url: string | null }[]>`
        SELECT c.id, c.headline, c.significance_score, c.first_published_at, a.source_url
        FROM clusters c
        LEFT JOIN LATERAL (
          SELECT source_url FROM articles
          WHERE cluster_id = c.id
          ORDER BY significance_base DESC NULLS LAST
          LIMIT 1
        ) a ON true
        WHERE c.first_published_at >= ${since}
        ORDER BY c.significance_score DESC
        LIMIT ${input.limit}
      `
    }),


  // "Catch me up" — the most significant stories across the last N days.
  // Floor + cap: only clusters scoring >= minScore, at most `limit` of them.
  getRecap: publicProcedure
    .input(
      z.object({
        days: z.number().min(1).max(30).default(7),
        limit: z.number().min(1).max(60).default(40),
        minScore: z.number().min(1).max(10).default(6),
      }),
    )
    .query(async ({ input }) => {
      const since = new Date(Date.now() - input.days * 86_400_000).toISOString()

      const clusters = await sql<Cluster[]>`
        SELECT * FROM clusters
        WHERE first_published_at >= ${since}
          AND significance_score >= ${input.minScore}
        ORDER BY significance_score DESC, first_published_at DESC
        LIMIT ${input.limit}
      `

      if (clusters.length === 0) return []

      const clusterIds = clusters.map((c) => c.id)
      const articles = await sql<Article[]>`
        SELECT ${ARTICLE_COLS} FROM articles
        WHERE cluster_id = ANY(${clusterIds})
        ORDER BY significance_base DESC NULLS LAST
      `

      const articlesByCluster = new Map<string, Article[]>()
      for (const article of articles) {
        if (!article.cluster_id) continue
        const arr = articlesByCluster.get(article.cluster_id) ?? []
        if (arr.length < 3) arr.push(article)
        articlesByCluster.set(article.cluster_id, arr)
      }

      return clusters
        .map((c) => ({ ...c, articles: articlesByCluster.get(c.id) ?? [] }))
        .filter((c) => c.articles.length > 0) as (Cluster & { articles: Article[] })[]
    }),

  // Model-release tracker: model-releases clusters in reverse-chronological order
  getModelReleases: publicProcedure
    .input(
      z.object({
        days: z.number().min(1).max(365).default(60),
        limit: z.number().min(1).max(100).default(50),
      }),
    )
    .query(async ({ input }) => {
      const since = new Date(Date.now() - input.days * 86_400_000).toISOString()

      const clusters = await sql<Cluster[]>`
        SELECT * FROM clusters
        WHERE category = 'model-releases'
          AND first_published_at >= ${since}
          AND significance_score > 0
        ORDER BY first_published_at DESC
        LIMIT ${input.limit}
      `

      if (clusters.length === 0) return []

      const clusterIds = clusters.map((c) => c.id)
      const articles = await sql<Article[]>`
        SELECT ${ARTICLE_COLS} FROM articles
        WHERE cluster_id = ANY(${clusterIds})
        ORDER BY significance_base DESC NULLS LAST
      `

      const articlesByCluster = new Map<string, Article[]>()
      for (const article of articles) {
        if (!article.cluster_id) continue
        const arr = articlesByCluster.get(article.cluster_id) ?? []
        if (arr.length < 3) arr.push(article)
        articlesByCluster.set(article.cluster_id, arr)
      }

      return clusters
        .map((c) => ({ ...c, articles: articlesByCluster.get(c.id) ?? [] }))
        .filter((c) => c.articles.length > 0) as (Cluster & { articles: Article[] })[]
    }),

  getClusters: publicProcedure
    .input(
      z.object({
        date: zDateStr,
        category: zCategory,
        limit: z.number().min(1).max(100).default(50),
      }),
    )
    .query(async ({ input }) => {
      const categoryFilter = input.category
        ? sql`AND category = ${input.category}`
        : sql``

      let dateFilter = sql``
      if (input.date) {
        const start = new Date(input.date)
        start.setUTCHours(0, 0, 0, 0)
        const end = new Date(input.date)
        end.setUTCHours(23, 59, 59, 999)
        dateFilter = sql`AND first_published_at >= ${start.toISOString()} AND first_published_at <= ${end.toISOString()}`
      }

      // Paper-only clusters sort AFTER news clusters (not just below in the UI):
      // the nightly arXiv dump lands ~150 authority-5 papers that outscore
      // overnight single-outlet stories, and with a flat score ordering they
      // exhausted the fetch limit, leaving "Today" showing 1 story + a paper
      // shelf until news outscored them later in the day (2026-07-10).
      const clusters = await sql<Cluster[]>`
        SELECT * FROM clusters
        WHERE 1=1
        ${categoryFilter}
        ${dateFilter}
        ORDER BY
          (SELECT COALESCE(bool_and(a.source_name LIKE 'arXiv%'), false)
           FROM articles a WHERE a.cluster_id = clusters.id) ASC,
          significance_score DESC
        LIMIT ${input.limit}
      `

      if (clusters.length === 0) return []

      const clusterIds = clusters.map((c) => c.id)
      const articles = await sql<Article[]>`
        SELECT ${ARTICLE_COLS} FROM articles
        WHERE cluster_id = ANY(${clusterIds})
        ORDER BY significance_base DESC NULLS LAST
      `

      const articlesByCluster = new Map<string, Article[]>()
      // paper_only is judged over ALL members before the 3-article display cap:
      // with only the top 3 (arXiv authority 5 outranks aggregator-attributed
      // outlets at 3), a cluster of three arXiv near-dupes plus a real outlet
      // would look all-arXiv and get shelved despite having news coverage.
      const allArxiv = new Map<string, boolean>()
      // Score-receipt inputs, also over ALL members: distinct outlets and the
      // highest LLM impact rating (shown in the badge's "why this score" popover).
      const sourcesByCluster = new Map<string, Set<string>>()
      const maxImpactByCluster = new Map<string, number>()
      for (const article of articles) {
        if (!article.cluster_id) continue
        const arr = articlesByCluster.get(article.cluster_id) ?? []
        if (arr.length < 3) arr.push(article)
        articlesByCluster.set(article.cluster_id, arr)
        allArxiv.set(
          article.cluster_id,
          (allArxiv.get(article.cluster_id) ?? true) && article.source_name.startsWith('arXiv'),
        )
        const srcs = sourcesByCluster.get(article.cluster_id) ?? new Set<string>()
        srcs.add(article.source_name)
        sourcesByCluster.set(article.cluster_id, srcs)
        if (article.impact_score != null) {
          maxImpactByCluster.set(
            article.cluster_id,
            Math.max(maxImpactByCluster.get(article.cluster_id) ?? 0, article.impact_score),
          )
        }
      }

      // Models this story is about (SEO cross-linking) — links a release story
      // to its /models/[slug] page. Most clusters have none; cap at 3.
      const modelLinks = await sql<{ cluster_id: string; slug: string; name: string }[]>`
        SELECT mc.cluster_id, m.slug, m.name
        FROM model_clusters mc
        JOIN models m ON m.id = mc.model_id
        WHERE mc.cluster_id = ANY(${clusterIds})
        ORDER BY m.released_at DESC NULLS LAST
      `
      const modelsByCluster = new Map<string, { slug: string; name: string }[]>()
      for (const r of modelLinks) {
        const arr = modelsByCluster.get(r.cluster_id) ?? []
        if (arr.length < 3) arr.push({ slug: r.slug, name: r.name })
        modelsByCluster.set(r.cluster_id, arr)
      }

      return clusters
        .map((c) => ({
          ...c,
          articles: articlesByCluster.get(c.id) ?? [],
          models: modelsByCluster.get(c.id) ?? [],
          paper_only: allArxiv.get(c.id) ?? false,
          source_count: sourcesByCluster.get(c.id)?.size ?? 0,
          max_impact: maxImpactByCluster.get(c.id) ?? null,
        }))
        .filter((c) => c.articles.length > 0) as (Cluster & { articles: Article[] })[]
    }),

  getCluster: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input }) => {
      const [cluster] = await sql<Cluster[]>`
        SELECT * FROM clusters WHERE id = ${input.id}
      `

      if (!cluster) {
        // Fallback: treat id as article id (pre-clustering)
        const [article] = await sql<Article[]>`
          SELECT ${ARTICLE_COLS} FROM articles WHERE id = ${input.id}
        `
        // Typed code so callers can tell "row missing" (404) apart from a DB
        // failure — the story page must never turn a transient error into a 404.
        if (!article) throw new TRPCError({ code: 'NOT_FOUND', message: 'Not found' })
        return {
          id: article.id,
          headline: article.title,
          category: article.raw_category ?? 'uncategorized',
          significance_score: 0,
          first_published_at: article.published_at,
          article_count: 1,
          summary: null,
          created_at: article.created_at,
          articles: [article],
          models: [] as { slug: string; name: string }[],
          related: [] as RelatedStory[],
          source_count: 1,
          max_impact: article.impact_score,
        }
      }

      const articles = await sql<Article[]>`
        SELECT ${ARTICLE_COLS} FROM articles
        WHERE cluster_id = ${input.id}
        ORDER BY significance_base DESC NULLS LAST
      `

      // Models this story is about, for cross-linking to /models/[slug]. Cap 3.
      const models = await sql<{ slug: string; name: string }[]>`
        SELECT m.slug, m.name
        FROM model_clusters mc
        JOIN models m ON m.id = mc.model_id
        WHERE mc.cluster_id = ${input.id}
        ORDER BY m.released_at DESC NULLS LAST
        LIMIT 3
      `

      // Related stories: first those sharing a model with this one; if none,
      // same-category stories near in time. Lightweight shape for card links.
      let related = await sql<RelatedStory[]>`
        SELECT id, headline, category, significance_score, first_published_at, article_count
        FROM clusters
        WHERE id IN (
          SELECT DISTINCT cluster_id FROM model_clusters
          WHERE model_id IN (SELECT model_id FROM model_clusters WHERE cluster_id = ${input.id})
            AND cluster_id <> ${input.id}
        )
        ORDER BY significance_score DESC, first_published_at DESC
        LIMIT 4
      `
      if (related.length === 0) {
        related = await sql<RelatedStory[]>`
          SELECT id, headline, category, significance_score, first_published_at, article_count
          FROM clusters
          WHERE category = ${cluster.category} AND id <> ${input.id}
            AND first_published_at BETWEEN ${cluster.first_published_at}::timestamptz - interval '4 days'
              AND ${cluster.first_published_at}::timestamptz + interval '4 days'
          ORDER BY significance_score DESC
          LIMIT 4
        `
      }

      const impacts = articles.map((a) => a.impact_score).filter((v): v is number => v != null)
      return {
        ...cluster,
        articles,
        models,
        related,
        source_count: new Set(articles.map((a) => a.source_name)).size,
        max_impact: impacts.length ? Math.max(...impacts) : null,
      }
    }),

  search: publicProcedure
    .input(
      z.object({
        query: z.string().min(1).max(200).refine(
          (q) => !/[%_]/.test(q),
          'Search query may not contain wildcard characters',
        ),
        category: zCategory,
        dateFrom: zDateStr,
        dateTo: zDateStr,
        limit: z.number().min(1).max(50).default(20),
        offset: z.number().min(0).default(0),
      }),
    )
    .query(async ({ input }) => {
      const ftsQuery = expandForFTS(input.query)

      const categoryFilter = input.category
        ? sql`AND category = ${input.category}`
        : sql``

      let dateFromFilter = sql``
      let artDateFromFilter = sql``
      if (input.dateFrom) {
        const s = new Date(input.dateFrom)
        s.setUTCHours(0, 0, 0, 0)
        dateFromFilter = sql`AND first_published_at >= ${s.toISOString()}`
        artDateFromFilter = sql`AND published_at >= ${s.toISOString()}`
      }

      let dateToFilter = sql``
      let artDateToFilter = sql``
      if (input.dateTo) {
        const e = new Date(input.dateTo)
        e.setUTCHours(23, 59, 59, 999)
        dateToFilter = sql`AND first_published_at <= ${e.toISOString()}`
        artDateToFilter = sql`AND published_at <= ${e.toISOString()}`
      }

      // Query 1: FTS on cluster headlines
      const headlineClusters = await sql<Cluster[]>`
        SELECT * FROM clusters
        WHERE headline_tsv @@ websearch_to_tsquery('english', ${ftsQuery})
        ${categoryFilter}
        ${dateFromFilter}
        ${dateToFilter}
        ORDER BY significance_score DESC
        LIMIT 100
      `

      // Query 2: source_name ILIKE match on articles
      const ilikeTerms = expandForILIKE(input.query)
      // No % or _ in terms needed since the user query was already validated above
      const patterns = ilikeTerms.map((t) => `%${t}%`)
      // Newest-first with the date filter pushed down: the unordered 500-id cap
      // used to sample arbitrary (often old) clusters for prolific sources, so a
      // date-filtered source search could return nothing despite recent matches.
      // Duplicate cluster_ids are collapsed by the extraIds Set below.
      const sourceArticles = await sql<{ cluster_id: string }[]>`
        SELECT cluster_id FROM articles
        WHERE cluster_id IS NOT NULL
        AND source_name ILIKE ANY(${patterns})
        ${artDateFromFilter}
        ${artDateToFilter}
        ORDER BY published_at DESC
        LIMIT 500
      `

      // Build unified cluster map (headline results first)
      const clusterMap = new Map<string, Cluster>()
      for (const c of headlineClusters) clusterMap.set(c.id, c)

      const extraIds = [...new Set(
        sourceArticles
          .map((a) => a.cluster_id)
          .filter((id) => !!id && !clusterMap.has(id))
      )]

      if (extraIds.length > 0) {
        const extraClusters = await sql<Cluster[]>`
          SELECT * FROM clusters
          WHERE id = ANY(${extraIds})
          ${categoryFilter}
          ${dateFromFilter}
          ${dateToFilter}
          ORDER BY significance_score DESC
          LIMIT 100
        `
        for (const c of extraClusters) clusterMap.set(c.id, c)
      }

      if (clusterMap.size === 0) return []

      // Hybrid sort: significance × recency (half-life 60 days)
      const now = Date.now()
      const sortedClusters = [...clusterMap.values()].sort((a, b) => {
        const daysA = (now - new Date(a.first_published_at).getTime()) / 86_400_000
        const daysB = (now - new Date(b.first_published_at).getTime()) / 86_400_000
        const hybridA = (a.significance_score ?? 0) / (1 + daysA / 60)
        const hybridB = (b.significance_score ?? 0) / (1 + daysB / 60)
        return hybridB - hybridA
      })

      const page = sortedClusters.slice(input.offset, input.offset + input.limit)
      if (page.length === 0) return []

      const clusterIds = page.map((c) => c.id)
      const articles = await sql<Article[]>`
        SELECT ${ARTICLE_COLS} FROM articles
        WHERE cluster_id = ANY(${clusterIds})
        ORDER BY significance_base DESC NULLS LAST
      `

      const byCluster = new Map<string, Article[]>()
      for (const article of articles) {
        if (!article.cluster_id) continue
        const arr = byCluster.get(article.cluster_id) ?? []
        if (arr.length < 3) arr.push(article)
        byCluster.set(article.cluster_id, arr)
      }

      return page
        .map((c) => ({ ...c, articles: byCluster.get(c.id) ?? [] }))
        .filter((c) => c.articles.length > 0) as (Cluster & { articles: Article[] })[]
    }),

  getLastIngested: publicProcedure.query(async () => {
    const [row] = await sql<{ ran_at: string }[]>`
      SELECT ran_at FROM pipeline_runs ORDER BY ran_at DESC LIMIT 1
    `
    return row?.ran_at ?? null
  }),

  // ── Model registry (Phase K) ──────────────────────────────────────────────
  // Canonical models released in the last year (Epoch AI–backed), newest first,
  // each with its headline Epoch Capabilities Index and news-coverage count.
  getModels: publicProcedure
    .input(z.object({ limit: z.number().min(1).max(300).default(200) }).optional())
    .query(async ({ input }) => {
      const limit = input?.limit ?? 200
      const models = await sql<Model[]>`
        SELECT * FROM models
        WHERE released_at >= now() - interval '1 year'
        ORDER BY released_at DESC NULLS LAST
        LIMIT ${limit}
      `
      if (models.length === 0) return []

      const ids = models.map((m) => m.id)

      // All benchmark scores → ECI headline + per-bucket percentile composites.
      const allBench = await sql<{ model_id: string; benchmark: string; score: number }[]>`
        SELECT model_id, benchmark, score FROM model_benchmarks
        WHERE model_id = ANY(${ids})
      `
      const { eciByModel, bucketScore } = buildScoreMaps(allBench)

      const coverage = await sql<{ model_id: string; n: number }[]>`
        SELECT model_id, count(*)::int AS n FROM model_clusters
        WHERE model_id = ANY(${ids}) GROUP BY model_id
      `
      const coverageByModel = new Map(coverage.map((r) => [r.model_id, r.n]))

      return models.map((m) => ({
        ...m,
        headline_score: eciByModel.get(m.id) ?? null,
        coverage_count: coverageByModel.get(m.id) ?? 0,
        buckets: Object.fromEntries(
          BUCKETS.map((b) => [b.key, bucketScore(m.id, b.benchmarks)]),
        ),
      })) as Model[]
    }),

  // A single model with all its benchmark scores and linked news coverage.
  getModelBySlug: publicProcedure
    .input(z.object({ slug: z.string().min(1).max(120).regex(/^[a-z0-9-]+$/) }))
    .query(async ({ input }) => {
      const [model] = await sql<Model[]>`SELECT * FROM models WHERE slug = ${input.slug}`
      if (!model) return null

      const benchmarks = await sql<ModelBenchmark[]>`
        SELECT benchmark, score, unit, source FROM model_benchmarks
        WHERE model_id = ${model.id}
        ORDER BY (unit = 'index') DESC, benchmark
      `

      // Percentile rank for each benchmark vs every last-year model, so the page
      // can show "where this lands among all models" as a uniform bar (Phase O4).
      // The model itself is always in the population: once it ages past a year,
      // excluding it lets `below` reach n and the math exceed 100%.
      if (benchmarks.length > 0) {
        const names = benchmarks.map((b) => b.benchmark)
        const pop = await sql<{ benchmark: string; score: number }[]>`
          SELECT mb.benchmark, mb.score FROM model_benchmarks mb
          JOIN models m ON m.id = mb.model_id
          WHERE (m.released_at >= now() - interval '1 year' OR m.id = ${model.id})
            AND mb.benchmark = ANY(${names})
        `
        const byBench = new Map<string, number[]>()
        for (const r of pop) {
          const arr = byBench.get(r.benchmark) ?? []
          arr.push(r.score)
          byBench.set(r.benchmark, arr)
        }
        for (const b of benchmarks) {
          const arr = byBench.get(b.benchmark) ?? []
          const n = arr.length
          const below = arr.filter((s) => s < b.score).length
          b.percentile = n > 1 ? Math.min(100, Math.round((below / (n - 1)) * 100)) : 100
        }
      }

      const clusters = await sql<Cluster[]>`
        SELECT c.* FROM clusters c
        JOIN model_clusters mc ON mc.cluster_id = c.id
        WHERE mc.model_id = ${model.id}
        ORDER BY c.first_published_at DESC
        LIMIT 30
      `

      let withArticles: (Cluster & { articles: Article[] })[] = []
      if (clusters.length > 0) {
        const cids = clusters.map((c) => c.id)
        const articles = await sql<Article[]>`
          SELECT ${ARTICLE_COLS} FROM articles
          WHERE cluster_id = ANY(${cids})
          ORDER BY significance_base DESC NULLS LAST
        `
        const byCluster = new Map<string, Article[]>()
        for (const a of articles) {
          if (!a.cluster_id) continue
          const arr = byCluster.get(a.cluster_id) ?? []
          if (arr.length < 3) arr.push(a)
          byCluster.set(a.cluster_id, arr)
        }
        withArticles = clusters.map((c) => ({ ...c, articles: byCluster.get(c.id) ?? [] }))
      }

      // Phase V changelog. Legacy blended-base price events (price_scope IS
      // NULL, pre-2026-07-10) are excluded from every display surface — they
      // are the noise Phase U replaced.
      const events = await sql<ModelEvent[]>`
        SELECT id, event_type, price_scope, summary, detected_at FROM model_events
        WHERE model_id = ${model.id}
          AND NOT (event_type = 'price' AND price_scope IS NULL)
        ORDER BY detected_at DESC
        LIMIT 40
      `

      return { ...model, benchmarks, clusters: withArticles, events }
    }),

  // Phase V: the change feed — recent model_events across all models, joined to
  // their model for the vendor-grouped /models/changes page and RSS feed.
  getModelEvents: publicProcedure
    .input(z.object({ days: z.number().min(1).max(90).default(30) }))
    .query(async ({ input }) => {
      return sql<ModelEvent[]>`
        SELECT e.id, e.event_type, e.price_scope, e.summary, e.detected_at,
               m.slug AS model_slug, m.name AS model_name, m.vendor AS model_vendor
        FROM model_events e
        JOIN models m ON m.id = e.model_id
        WHERE e.detected_at >= now() - make_interval(days => ${input.days})
          AND NOT (e.event_type = 'price' AND e.price_scope IS NULL)
        ORDER BY e.detected_at DESC
        LIMIT 300
      `
    }),

  // Phase W: the digest teaser — composed rows (movement events first, catalog
  // bursts collapsed, top stories mixed in) from the trailing 7 days, for the
  // floating signup card and /digest's live week section. Rolling window with
  // NO reset at send time: Thu-Sat the same query naturally shows the
  // just-shipped issue's material, so the card is never empty on the
  // high-traffic send day.
  getDigestTeaser: publicProcedure
    .input(z.object({ rows: z.number().min(3).max(6).default(3) }).optional())
    .query(async ({ input }): Promise<DigestTeaser> => {
    const maxRows = input?.rows ?? 3
    const [eventRows, stories, facts] = await Promise.all([
      sql<(ModelEvent & { old_value: string | null; new_value: string | null })[]>`
        SELECT e.id, e.event_type, e.price_scope, e.summary, e.detected_at,
               e.old_value, e.new_value,
               m.slug AS model_slug, m.name AS model_name, m.vendor AS model_vendor
        FROM model_events e
        JOIN models m ON m.id = e.model_id
        WHERE e.detected_at >= now() - interval '7 days'
          AND NOT (e.event_type = 'price' AND e.price_scope IS NULL)
        ORDER BY e.detected_at DESC
        LIMIT 100
      `,
      sql<{ id: string; headline: string }[]>`
        SELECT id, headline FROM clusters
        WHERE first_published_at >= now() - interval '7 days'
        ORDER BY significance_score DESC, first_published_at DESC
        LIMIT 3
      `,
      // The registry's insider hook: the endpoint-synced model with the
      // biggest credible-floor discount vs its vendor list price (Phase U
      // data no aggregator surfaces). Feeds one fact row when the week has
      // no movement events of its own. Candidates need real news coverage
      // (>= 3 linked clusters): a huge discount on a model nobody writes
      // about is trivia, not a hook (the first pick was MiniMax-M2.5 at
      // 75% off with zero coverage — accurate and worthless).
      sql<FloorFact[]>`
        SELECT m.slug, m.name, m.price_in, m.vendor_price_in, m.floor_provider
        FROM models m
        JOIN (
          SELECT model_id, count(*) AS n FROM model_clusters GROUP BY model_id
        ) c ON c.model_id = m.id AND c.n >= 3
        WHERE m.pending_prices IS NOT NULL
          AND m.vendor_price_in > 0 AND m.price_in > 0
          AND m.price_in < m.vendor_price_in AND m.floor_provider IS NOT NULL
        ORDER BY m.price_in / m.vendor_price_in ASC
        LIMIT 1
      `,
    ])
    const events = eventRows
      .sort(
        (a, b) =>
          eventRank(a.event_type, a.price_scope) - eventRank(b.event_type, b.price_scope) ||
          +new Date(b.detected_at) - +new Date(a.detected_at),
      )
      .map(({ old_value, new_value, ...e }) => ({
        ...e,
        ...eventDelta(e.event_type, old_value, new_value),
      }))
    const fact = facts[0] ? floorFactRow(facts[0]) : null
    return { rows: composeRows(events, stories, fact, maxRows) }
  }),

  // Compare view (Phase O3): 2–4 models side by side, each with full benchmark
  // rows, ECI headline, and per-bucket composites. Bucket percentiles are ranked
  // against the whole last-year registry (same population as getModels), so the
  // numbers match what the leaderboard shows. Returned in the requested order.
  getModelsByIds: publicProcedure
    .input(
      z.object({
        slugs: z.array(z.string().min(1).max(120).regex(/^[a-z0-9-]+$/)).min(1).max(4),
      }),
    )
    .query(async ({ input }) => {
      const slugs = [...new Set(input.slugs)]
      const models = await sql<Model[]>`SELECT * FROM models WHERE slug = ANY(${slugs})`
      if (models.length === 0) return []

      const ids = models.map((m) => m.id)

      // Population for percentile ranking: the whole last-year registry, plus
      // the requested models themselves — a model past its first anniversary
      // would otherwise drop out of its own population and silently lose its
      // headline and bucket scores in still-live compare URLs.
      const allBench = await sql<{ model_id: string; benchmark: string; score: number }[]>`
        SELECT mb.model_id, mb.benchmark, mb.score
        FROM model_benchmarks mb
        JOIN models m ON m.id = mb.model_id
        WHERE m.released_at >= now() - interval '1 year' OR m.id = ANY(${ids})
      `
      const { eciByModel, bucketScore } = buildScoreMaps(allBench)
      const benchRows = await sql<(ModelBenchmark & { model_id: string })[]>`
        SELECT model_id, benchmark, score, unit FROM model_benchmarks
        WHERE model_id = ANY(${ids})
        ORDER BY (unit = 'index') DESC, benchmark
      `
      const benchByModel = new Map<string, ModelBenchmark[]>()
      for (const r of benchRows) {
        const arr = benchByModel.get(r.model_id) ?? []
        arr.push({ benchmark: r.benchmark, score: r.score, unit: r.unit })
        benchByModel.set(r.model_id, arr)
      }

      const coverage = await sql<{ model_id: string; n: number }[]>`
        SELECT model_id, count(*)::int AS n FROM model_clusters
        WHERE model_id = ANY(${ids}) GROUP BY model_id
      `
      const coverageByModel = new Map(coverage.map((r) => [r.model_id, r.n]))

      const enriched = models.map((m) => ({
        ...m,
        benchmarks: benchByModel.get(m.id) ?? [],
        headline_score: eciByModel.get(m.id) ?? null,
        coverage_count: coverageByModel.get(m.id) ?? 0,
        buckets: Object.fromEntries(
          BUCKETS.map((b) => [b.key, bucketScore(m.id, b.benchmarks)]),
        ),
      })) as Model[]

      // Preserve the requested order (deduped).
      const bySlug = new Map(enriched.map((m) => [m.slug, m]))
      return slugs.map((s) => bySlug.get(s)).filter(Boolean) as Model[]
    }),
})
