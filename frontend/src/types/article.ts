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
  first_published_at: string // ISO timestamp (when the story first broke)
  last_activity_at?: string // ISO timestamp (newest member article; timeline grouping)
  article_count: number
  summary: string | null // AI synthesis (Phase J); null when not yet generated
  created_at: string
  // joined from articles when fetched
  articles?: Article[]
  // models this story covers, for internal cross-linking to /models/[slug]
  models?: { slug: string; name: string }[]
  // every member is arXiv (computed over ALL members in getClusters, not the
  // 3-article display cap) — drives the papers shelf split
  paper_only?: boolean
  // score-receipt inputs (computed over ALL members, pre display cap):
  // distinct outlets covering the story, and the highest LLM impact rating
  source_count?: number
  max_impact?: number | null
}

// Model registry (Phase K) — Epoch AI–backed canonical model + its benchmarks.
export interface ModelBenchmark {
  benchmark: string // 'Epoch Capabilities Index', 'GPQA Diamond', ...
  score: number // native scale (fraction for %, raw value for index)
  unit: string // '%' | 'index' | 'elo' | 'min'
  percentile?: number | null // rank vs all last-year models (Phase O4); 0–100
  source?: string // 'epoch' | 'aa' — which dataset the score came from
}

// Phase V: one row of a model's changelog (price/context/benchmark/catalog),
// written append-only by the pipeline. Legacy price events (price_scope null)
// are filtered out at the query layer.
export interface ModelEvent {
  id: string
  event_type: string // 'price' | 'context' | 'benchmark' | 'catalog' | ...
  price_scope: string | null // 'vendor' | 'floor' for price events
  summary: string
  detected_at: string // ISO timestamp
  // joined for the /models/changes feed
  model_slug?: string
  model_name?: string
  model_vendor?: string | null
}

// Phase W: the digest teaser — composed rows (real movement first, catalog
// bursts collapsed to one line, top stories mixed in) from the trailing 7
// days. Powers the floating signup card and /digest's live week section.
export interface DigestTeaserEvent extends ModelEvent {
  delta: string | null // signed relative change, e.g. '+57.9%'; null = no chip
  tone: 'good' | 'bad' | 'neutral'
}

export interface TeaserRow {
  key: string
  kind: 'event' | 'story'
  text: string
  chip: string | null // '+57.9%', 'NEW' — or null for no chip
  tone: 'good' | 'bad' | 'neutral'
  // Destination for surfaces that link rows (/digest). The floating card
  // deliberately ignores this: its rows are never links (see roadmap rules).
  href?: string
}

// No issue/week state: the rows are a live rolling-week view, and labels that
// claimed identity with the sent issue proved false the moment post-send
// events landed (caught by Anmol 2026-07-10). Surfaces label it "This week on
// the beat" and link the sent issue BY DATE instead.
export interface DigestTeaser {
  rows: TeaserRow[]
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
  updated_at?: string | null // last registry sync (freshness signal)
  // pricing & specs from OpenRouter (Phase O1); null when not served by OpenRouter
  openrouter_id: string | null
  price_in: number | null // USD per 1M input tokens (cheapest credible provider once endpoint-synced, Phase U)
  price_out: number | null // USD per 1M output tokens
  // Phase U: the first-party provider's list price + who serves the credible floor
  vendor_price_in?: number | null
  vendor_price_out?: number | null
  floor_provider?: string | null
  floor_quant?: string | null
  context_window: number | null
  input_modalities: string | null // comma-joined, e.g. 'text, image'
  output_modalities: string | null
  // joined when fetched
  benchmarks?: ModelBenchmark[]
  headline_score?: number | null // ECI for the index view
  coverage_count?: number // # of linked news clusters
  buckets?: Record<string, number | null> // per use-case percentile composite (Phase O2)
}
