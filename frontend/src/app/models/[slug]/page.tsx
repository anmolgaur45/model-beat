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
import { flagshipModels, pairKey } from '@/lib/comparePairs'

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
function accessLabel(m: Model): string | null {
  if (m.accessibility) return m.accessibility
  if (m.is_open_weight === true) return 'Open weights'
  if (m.is_open_weight === false) return 'Proprietary'
  return null
}
function fmtUpdated(iso: string | null | undefined): string {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
}

// Top benchmarks by percentile rank — drives the "strongest results" FAQ answer.
function topBenchmarks(model: ModelDetail, n: number): ModelBenchmark[] {
  return model.benchmarks
    .filter((b) => b.benchmark !== 'Epoch Capabilities Index' && b.percentile != null)
    .sort((a, b) => (b.percentile ?? 0) - (a.percentile ?? 0))
    .slice(0, n)
}

// Data-driven Q&A, included only when we actually hold the answer. Powers both
// the on-page FAQ (GEO/citeable) and the FAQPage JSON-LD.
function buildFaq(model: ModelDetail): { q: string; a: string }[] {
  const faq: { q: string; a: string }[] = []
  const name = model.name

  faq.push({ q: `What is ${name}?`, a: model.description ?? synopsis(model) })

  if (model.vendor) {
    const bits = [`${name} is an AI model developed by ${model.vendor}`]
    if (model.family) bits.push(`part of the ${model.family} family`)
    if (model.released_at) bits.push(`released ${fmtReleased(model.released_at)}`)
    faq.push({ q: `Who created ${name}?`, a: `${bits.join(', ')}.` })
  }

  if (model.price_in != null || model.price_out != null) {
    faq.push({
      q: `How much does ${name} cost?`,
      a: `${name} is priced at ${usd(model.price_in)} per million input tokens and ${usd(model.price_out)} per million output tokens (representative pricing via OpenRouter).`,
    })
  }

  if (model.context_window) {
    faq.push({
      q: `What is ${name}'s context window?`,
      a: `${name} supports a context window of up to ${fmtContext(model.context_window)} tokens.`,
    })
  }

  const top = topBenchmarks(model, 3)
  if (top.length > 0) {
    const parts = top.map((b) => `${scoreLabel(b)} on ${b.benchmark}`)
    faq.push({
      q: `How does ${name} perform on benchmarks?`,
      a: `On standardized evaluations tracked by Epoch AI, ${name} scores ${parts.join(', ')}.`,
    })
  }

  const access = accessLabel(model)
  if (access) {
    const open = model.is_open_weight === true || /open/i.test(access)
    faq.push({
      q: `Is ${name} open source?`,
      a: open
        ? `${name} is released with open weights (${access}), so the model can be downloaded and self-hosted.`
        : `${name} is a proprietary model (${access}), available through its provider's API rather than as a downloadable open-weight model.`,
    })
  }

  return faq
}

// One-line, data-dense meta description tuned for entity queries.
function metaDescription(model: ModelDetail): string {
  const facts: string[] = []
  const top = topBenchmarks(model, 1)[0]
  if (top) facts.push(`scores ${scoreLabel(top)} on ${top.benchmark}`)
  if (model.price_in != null) facts.push(`${usd(model.price_in)}/${usd(model.price_out)} per 1M tokens`)
  if (model.context_window) facts.push(`${fmtContext(model.context_window)} context`)
  const lead = `${model.name}${model.vendor ? ` by ${model.vendor}` : ''}`
  const factPart = facts.length ? `${facts.join(', ')}. ` : ''
  const desc = `${lead}: ${factPart}Compare benchmarks, pricing and specs, plus the latest ${model.name} news.`
  return desc.length > 160 ? `${desc.slice(0, 157)}…` : desc
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

  // "Strongest at": the use-case buckets where this model genuinely ranks high.
  const bestAt = BUCKETS
    .map((b) => ({ label: b.label, pct: bucket[b.key] }))
    .filter((x): x is { label: string; pct: number } => x.pct != null && x.pct >= 60)
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 3)

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
    bestAt,
    faq: buildFaq(model),
    updated: fmtUpdated(model.updated_at),
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
  const title = `${model.name} — benchmarks, pricing & specs`
  const description = metaDescription(model)
  const url = `${SITE}/models/${slug}`
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      type: 'article',
      title,
      description,
      url,
      images: [{ url: `/api/og?title=${encodeURIComponent(model.name)}`, width: 1200, height: 630 }],
    },
    twitter: {
      card: 'summary_large_image',
      title,
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

  // Internal links to comparison pages — this model vs the frontier flagships.
  const flagships = await flagshipModels()
  view.compareWith = flagships
    .filter((f) => f.slug !== model.slug)
    .slice(0, 5)
    .map((f) => ({ name: f.name, href: `/models/compare/${pairKey(model.slug, f.slug)}` }))

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
    ...(view.faq.length > 0
      ? [{
          '@context': 'https://schema.org',
          '@type': 'FAQPage',
          mainEntity: view.faq.map((f) => ({
            '@type': 'Question',
            name: f.q,
            acceptedAnswer: { '@type': 'Answer', text: f.a },
          })),
        }]
      : []),
  ]

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <ModelTelemetry view={view} />
    </>
  )
}
