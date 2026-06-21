export type Category =
  | 'model-releases'
  | 'research-papers'
  | 'company-news'
  | 'product-launches'
  | 'regulation-policy'
  | 'hardware-infrastructure'
  | 'open-source'
  | 'opinion-analysis'
  | 'uncategorized'

export interface Article {
  id: string
  title: string
  body_excerpt: string | null
  source_name: string
  source_url: string
  author: string | null
  published_at: string // ISO timestamp
  raw_category: string | null
  cluster_id: string | null
  impact_score: number | null
  created_at: string
}

export interface Cluster {
  id: string
  headline: string
  category: Category
  significance_score: number
  first_published_at: string // ISO timestamp
  article_count: number
  summary: string | null // AI synthesis (Phase J); null when not yet generated
  created_at: string
  // joined from articles when fetched
  articles?: Article[]
  // models this story covers, for internal cross-linking to /models/[slug]
  models?: { slug: string; name: string }[]
}

// Model registry (Phase K) — Epoch AI–backed canonical model + its benchmarks.
export interface ModelBenchmark {
  benchmark: string // 'Epoch Capabilities Index', 'GPQA Diamond', ...
  score: number // native scale (fraction for %, raw value for index)
  unit: string // '%' | 'index' | 'elo' | 'min'
  percentile?: number | null // rank vs all last-year models (Phase O4); 0–100
}

export interface Model {
  id: string
  slug: string
  name: string
  vendor: string | null
  family: string | null
  released_at: string | null // ISO timestamp
  parameters: string | null // human-readable, e.g. '3T'
  accessibility: string | null
  is_open_weight: boolean | null
  description: string | null
  primary_url: string | null
  significance: number
  // pricing & specs from OpenRouter (Phase O1); null when not served by OpenRouter
  openrouter_id: string | null
  price_in: number | null // USD per 1M input tokens
  price_out: number | null // USD per 1M output tokens
  context_window: number | null
  input_modalities: string | null // comma-joined, e.g. 'text, image'
  output_modalities: string | null
  // joined when fetched
  benchmarks?: ModelBenchmark[]
  headline_score?: number | null // ECI for the index view
  coverage_count?: number // # of linked news clusters
  buckets?: Record<string, number | null> // per use-case percentile composite (Phase O2)
}
