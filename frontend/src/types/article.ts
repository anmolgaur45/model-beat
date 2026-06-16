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
}
