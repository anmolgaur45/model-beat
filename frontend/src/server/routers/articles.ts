import { z } from 'zod'
import { router, publicProcedure } from '../trpc'
import sql from '@/lib/db'
import type { Article, Cluster } from '@/types/article'

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
      return sql<{ headline: string; significance_score: number }[]>`
        SELECT headline, significance_score FROM clusters
        WHERE first_published_at >= ${since}
        ORDER BY significance_score DESC
        LIMIT ${input.limit}
      `
    }),


  getClusters: publicProcedure
    .input(
      z.object({
        date: z.string().optional(),
        category: z.string().optional(),
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

      const clusters = await sql<Cluster[]>`
        SELECT * FROM clusters
        WHERE 1=1
        ${categoryFilter}
        ${dateFilter}
        ORDER BY significance_score DESC
        LIMIT ${input.limit}
      `

      if (clusters.length === 0) return []

      const clusterIds = clusters.map((c) => c.id)
      const articles = await sql<Article[]>`
        SELECT * FROM articles
        WHERE cluster_id = ANY(${clusterIds})
        ORDER BY significance_base DESC
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

  getCluster: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input }) => {
      const [cluster] = await sql<Cluster[]>`
        SELECT * FROM clusters WHERE id = ${input.id}
      `

      if (!cluster) {
        // Fallback: treat id as article id (pre-clustering)
        const [article] = await sql<Article[]>`
          SELECT * FROM articles WHERE id = ${input.id}
        `
        if (!article) throw new Error('Not found')
        return {
          id: article.id,
          headline: article.title,
          category: article.raw_category ?? 'uncategorized',
          significance_score: 0,
          first_published_at: article.published_at,
          article_count: 1,
          created_at: article.created_at,
          articles: [article],
        } as Cluster & { articles: Article[] }
      }

      const articles = await sql<Article[]>`
        SELECT * FROM articles
        WHERE cluster_id = ${input.id}
        ORDER BY significance_base DESC
      `

      return { ...cluster, articles } as Cluster & { articles: Article[] }
    }),

  search: publicProcedure
    .input(
      z.object({
        query: z.string().min(1).max(200),
        category: z.string().optional(),
        dateFrom: z.string().optional(),
        dateTo: z.string().optional(),
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
      if (input.dateFrom) {
        const s = new Date(input.dateFrom)
        s.setUTCHours(0, 0, 0, 0)
        dateFromFilter = sql`AND first_published_at >= ${s.toISOString()}`
      }

      let dateToFilter = sql``
      if (input.dateTo) {
        const e = new Date(input.dateTo)
        e.setUTCHours(23, 59, 59, 999)
        dateToFilter = sql`AND first_published_at <= ${e.toISOString()}`
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
      const patterns = ilikeTerms.map((t) => `%${t}%`)
      const sourceArticles = await sql<{ cluster_id: string }[]>`
        SELECT DISTINCT cluster_id FROM articles
        WHERE cluster_id IS NOT NULL
        AND source_name ILIKE ANY(${patterns})
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
        SELECT * FROM articles
        WHERE cluster_id = ANY(${clusterIds})
        ORDER BY significance_base DESC
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
})
