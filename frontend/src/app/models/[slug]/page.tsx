import { cache } from 'react'
import type { Metadata } from 'next'
import { SITE_URL } from '@/lib/site'
import { notFound } from 'next/navigation'
import { appRouter } from '@/server/routers/_app'
import { createContext } from '@/server/trpc'
import type { Model, ModelBenchmark, Cluster, Article } from '@/types/article'
import { ModelTelemetry, type ModelView, type BenchRowView, type IndexGauge } from '@/components/ModelTelemetry'
import { BUCKETS } from '@/lib/modelBuckets'
import { benchmarkMeta, GROUP_ORDER, GROUP_LABELS } from '@/lib/benchmarks'

export const revalidate = 3600

const SLUG_RE = /^[a-z0-9-]+$/
const SITE = SITE_URL

type ModelDetail = Model & {
  benchmarks: ModelBenchmark[]
  clusters: (Cluster & { articles: Article[] })[]
}

const loadModel = cache(async (slug: string): Promise<ModelDetail | null> => {
  const caller = appRouter.createCaller(createContext())
  return caller.articles.getModelBySlug({ slug }) as Promise<ModelDetail | null>
})

// ── formatting ──────────────────────────────────────────────────────────────
function fmtReleased(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}
function fmtContext(n: number | null): string {
  if (!n) return '—'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`
  return `${n}`
}
function usd(n: number | null): string {
  if (n == null) return '—'
  return n % 1 === 0 ? `$${n}` : `$${n.toFixed(2)}`
}
function scoreLabel(b: ModelBenchmark): string {
  if (b.unit === '%') return `${(b.score * 100).toFixed(1)}%`
  if (b.unit === 'min') return b.score >= 60 ? `${(b.score / 60).toFixed(1)} h` : `${Math.round(b.score)} min`
  return `${Math.round(b.score)}` // index (ECI) / elo (Arena)
}
function sourceLink(m: Model): { url: string; label: string } {
  if (m.primary_url) return { url: m.primary_url, label: 'Announcement' }
  const q = encodeURIComponent(`${m.name} ${m.vendor ?? ''} announcement`.trim())
  return { url: `https://www.google.com/search?q=${q}`, label: 'Find source' }
}
function synopsis(m: Model): string {
  const parts: string[] = [m.family ? `a ${m.family}-family AI model` : 'an AI model']
  if (m.vendor) parts.push(`from ${m.vendor}`)
  if (m.released_at) parts.push(`released ${fmtReleased(m.released_at)}`)
  return `${m.name} is ${parts.join(', ')}.`
}
function parseMods(s: string | null): string[] {
  if (!s) return []
  return s.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean)
}

// Map a real model + its benchmarks into the MODEL contract the design renders from.
function toView(model: ModelDetail): ModelView {
  const pctOf = new Map(model.benchmarks.map((b) => [b.benchmark, b.percentile ?? null]))
  const composite = (names: string[]): number | null => {
    const vals = names.map((n) => pctOf.get(n)).filter((v): v is number => v != null)
    return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null
  }
  const bucket = Object.fromEntries(BUCKETS.map((b) => [b.key, composite(b.benchmarks)])) as Record<string, number | null>
  const present = BUCKETS.map((b) => bucket[b.key]).filter((v): v is number => v != null)
  const overall = present.length ? Math.round(present.reduce((a, b) => a + b, 0) / present.length) : null

  const indices: IndexGauge[] = []
  if (overall != null) indices.push({ value: overall, label: 'Intelligence Index', percentile: overall })
  if (bucket.coding != null) indices.push({ value: bucket.coding, label: 'Coding Index', percentile: bucket.coding })
  if (bucket.agentic != null) indices.push({ value: bucket.agentic, label: 'Agentic Index', percentile: bucket.agentic })

  // benchmark cards grouped (ECI lives in the gauges, not the grid)
  const byGroup = new Map<string, BenchRowView[]>()
  for (const b of model.benchmarks) {
    if (b.benchmark === 'Epoch Capabilities Index') continue
    const meta = benchmarkMeta(b.benchmark)
    const group = meta?.group && meta.group !== 'overall' ? meta.group : 'reasoning'
    const pct = b.unit === '%' ? Math.round(b.score * 1000) / 10 : (b.percentile ?? 0)
    const arr = byGroup.get(group) ?? []
    arr.push({
      name: b.benchmark,
      blurb: meta?.blurb ?? '',
      pct,
      scoreLabel: scoreLabel(b),
      desc: meta?.desc ?? '',
      evaluator: meta?.evaluator,
      domain: meta?.domain,
      url: meta?.url,
    })
    byGroup.set(group, arr)
  }
  const groups = GROUP_ORDER.filter((g) => byGroup.has(g)).map((g) => ({ name: GROUP_LABELS[g], rows: byGroup.get(g)! }))

  const src = sourceLink(model)
  return {
    org: model.vendor ?? '',
    name: model.name,
    monogram: (model.vendor ?? model.name).trim().charAt(0).toUpperCase(),
    slugDisplay: model.openrouter_id ?? model.slug,
    modelSlug: model.slug,
    description: model.description ?? synopsis(model),
    modalities: { in: parseMods(model.input_modalities), out: parseMods(model.output_modalities) },
    priceIn: usd(model.price_in),
    priceOut: usd(model.price_out),
    context: fmtContext(model.context_window),
    released: fmtReleased(model.released_at),
    providers: model.benchmarks.length > 0 ? ['Epoch AI'] : [],
    indices,
    groups,
    sourceUrl: src.url,
    sourceLabel: src.label,
    news: model.clusters.map((c) => {
      const primary = c.articles[0]
      return {
        headline: c.headline,
        url: primary?.source_url ?? null,
        source: primary?.source_name ?? '',
        date: fmtReleased(c.first_published_at),
      }
    }),
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  if (!SLUG_RE.test(slug)) return {}
  const model = await loadModel(slug).catch(() => null)
  if (!model) return {}
  const description = (model.description ?? synopsis(model)).slice(0, 200)
  const url = `${SITE}/models/${slug}`
  return {
    title: `${model.name} — specs, benchmarks & news`,
    description,
    alternates: { canonical: url },
    openGraph: {
      type: 'article',
      title: `${model.name} — specs, benchmarks & news`,
      description,
      url,
      images: [{ url: `/api/og?title=${encodeURIComponent(model.name)}`, width: 1200, height: 630 }],
    },
    twitter: {
      card: 'summary_large_image',
      title: `${model.name} — specs, benchmarks & news`,
      description,
      images: [`/api/og?title=${encodeURIComponent(model.name)}`],
    },
  }
}

export default async function ModelPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  if (!SLUG_RE.test(slug)) notFound()

  const model = await loadModel(slug)
  if (!model) notFound()

  const view = toView(model)

  const jsonLd = [
    {
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: model.name,
      applicationCategory: 'Artificial Intelligence',
      operatingSystem: 'Cloud',
      ...(model.vendor ? { author: { '@type': 'Organization', name: model.vendor } } : {}),
      ...(model.released_at ? { datePublished: model.released_at } : {}),
      description: model.description ?? synopsis(model),
      url: `${SITE}/models/${slug}`,
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: SITE },
        { '@type': 'ListItem', position: 2, name: 'Model tracker', item: `${SITE}/models` },
        { '@type': 'ListItem', position: 3, name: model.name, item: `${SITE}/models/${slug}` },
      ],
    },
  ]

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <ModelTelemetry view={view} />
    </>
  )
}
