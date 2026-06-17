import type { Metadata } from 'next'
import Link from 'next/link'
import { appRouter } from '@/server/routers/_app'
import { createContext } from '@/server/trpc'
import type { Model, ModelBenchmark } from '@/types/article'
import { BUCKETS } from '@/lib/modelBuckets'
import { CompareControls } from '@/components/CompareControls'
import { NavBar } from '@/components/NavBar'

export const revalidate = 3600

const SITE = process.env.NEXT_PUBLIC_URL ?? 'http://localhost:3000'
const SLUG_RE = /^[a-z0-9-]+$/

function parseSlugs(raw: string | string[] | undefined): string[] {
  const joined = Array.isArray(raw) ? raw.join(',') : (raw ?? '')
  return [...new Set(
    joined.split(',').map((s) => s.trim().toLowerCase()).filter((s) => SLUG_RE.test(s)),
  )].slice(0, 4)
}

async function loadModels(slugs: string[]): Promise<Model[]> {
  if (slugs.length === 0) return []
  const caller = appRouter.createCaller(createContext())
  return caller.articles.getModelsByIds({ slugs }).catch(() => [] as Model[])
}

// Lightweight roster for the inline picker (name/slug/vendor only).
async function loadRoster(): Promise<{ slug: string; name: string; vendor: string | null }[]> {
  const caller = appRouter.createCaller(createContext())
  const all = await caller.articles.getModels({ limit: 300 }).catch(() => [] as Model[])
  return all.map((m) => ({ slug: m.slug, name: m.name, vendor: m.vendor }))
}

// ── formatting (mirrors the per-model page) ─────────────────────────────────
function fmtReleased(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  })
}
function fmtContext(n: number | null): string {
  if (!n) return '—'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`
  return `${n}`
}
function fmtUsd(n: number | null): string {
  return n == null ? '—' : `$${n.toFixed(2)}`
}
function accessLabel(m: Model): string {
  if (m.accessibility) return m.accessibility
  if (m.is_open_weight === true) return 'Open weights'
  if (m.is_open_weight === false) return 'Proprietary'
  return '—'
}
function fmtScore(b: ModelBenchmark): string {
  if (b.unit === '%') return `${Math.round(b.score * 100)}%`
  if (b.unit === 'min') {
    return b.score >= 60 ? `${(b.score / 60).toFixed(1)} h` : `${Math.round(b.score)} min`
  }
  return `${Math.round(b.score)}`
}

// Index of the best value among the models for a row, or null when fewer than
// two models have a value (nothing meaningful to highlight).
function bestIndex(raw: (number | null)[], higherBetter: boolean): number | null {
  let best: number | null = null
  let idx: number | null = null
  raw.forEach((v, i) => {
    if (v == null) return
    if (best == null || (higherBetter ? v > best : v < best)) {
      best = v
      idx = i
    }
  })
  return raw.filter((v) => v != null).length >= 2 ? idx : null
}

type Row = {
  label: string
  cells: string[]
  best: number | null
}

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ ids?: string | string[] }>
}): Promise<Metadata> {
  const { ids } = await searchParams
  const slugs = parseSlugs(ids)
  const models = await loadModels(slugs)
  const names = models.map((m) => m.name)
  const title = names.length >= 2
    ? `${names.join(' vs ')} — comparison`
    : 'Compare AI models'
  const description = names.length >= 2
    ? `Side-by-side comparison of ${names.join(', ')}: benchmarks, pricing, context window, and capabilities.`
    : 'Compare AI models side by side — benchmarks, pricing, context window, and use-case rankings.'
  const url = `${SITE}/models/compare${slugs.length ? `?ids=${slugs.join(',')}` : ''}`
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { type: 'website', title, description, url },
  }
}

export default async function ComparePage({
  searchParams,
}: {
  searchParams: Promise<{ ids?: string | string[] }>
}) {
  const { ids } = await searchParams
  const slugs = parseSlugs(ids)
  const [models, roster] = await Promise.all([loadModels(slugs), loadRoster()])
  // selection in roster order, only valid slugs
  const selected = models.map((m) => m.slug)

  const nav = <NavBar />

  const hasTable = models.length >= 2

  // ── build comparison rows ─────────────────────────────────────────────────
  const specRows: Row[] = [
    { label: 'Developer', cells: models.map((m) => m.vendor ?? '—'), best: null },
    { label: 'Family', cells: models.map((m) => m.family ?? '—'), best: null },
    { label: 'Released', cells: models.map((m) => fmtReleased(m.released_at)), best: null },
    { label: 'Parameters', cells: models.map((m) => m.parameters ?? '—'), best: null },
    { label: 'Availability', cells: models.map((m) => accessLabel(m)), best: null },
    {
      label: 'Context window',
      cells: models.map((m) => fmtContext(m.context_window)),
      best: bestIndex(models.map((m) => m.context_window), true),
    },
    {
      label: 'Price — $/M input',
      cells: models.map((m) => fmtUsd(m.price_in)),
      best: bestIndex(models.map((m) => m.price_in), false),
    },
    {
      label: 'Price — $/M output',
      cells: models.map((m) => fmtUsd(m.price_out)),
      best: bestIndex(models.map((m) => m.price_out), false),
    },
    { label: 'Inputs', cells: models.map((m) => m.input_modalities ?? '—'), best: null },
    { label: 'Outputs', cells: models.map((m) => m.output_modalities ?? '—'), best: null },
  ]

  const scoreRows: Row[] = [
    {
      label: 'Intelligence (ECI)',
      cells: models.map((m) => (m.headline_score == null ? '—' : `${Math.round(m.headline_score)}`)),
      best: bestIndex(models.map((m) => m.headline_score ?? null), true),
    },
    ...BUCKETS.map((b) => ({
      label: b.label,
      cells: models.map((m) => {
        const v = m.buckets?.[b.key]
        return v == null ? '—' : `${v}`
      }),
      best: bestIndex(models.map((m) => m.buckets?.[b.key] ?? null), true),
    })),
  ]

  // Benchmarks: union across the compared models (ECI lives in the scores block),
  // preserving the index-first / alphabetical order the query already applied.
  const benchOrder: string[] = []
  const benchByModel = models.map((m) => {
    const map = new Map<string, ModelBenchmark>()
    for (const b of m.benchmarks ?? []) {
      if (b.benchmark === 'Epoch Capabilities Index') continue
      map.set(b.benchmark, b)
      if (!benchOrder.includes(b.benchmark)) benchOrder.push(b.benchmark)
    }
    return map
  })
  const benchRows: Row[] = benchOrder.map((name) => {
    const cells = benchByModel.map((map) => {
      const b = map.get(name)
      return b ? fmtScore(b) : '—'
    })
    const raw = benchByModel.map((map) => map.get(name)?.score ?? null)
    return { label: name, cells, best: bestIndex(raw, true) }
  })

  const colWidth = `minmax(180px, 1.4fr) repeat(${models.length}, minmax(120px, 1fr))`

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: `Comparison: ${models.map((m) => m.name).join(' vs ')}`,
    itemListElement: models.map((m, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      url: `${SITE}/models/${m.slug}`,
      name: m.name,
    })),
  }

  const renderSection = (title: string, rows: Row[]) => (
    <div key={title}>
      <div className="anc-cmp-section" style={{ gridTemplateColumns: colWidth }}>
        <span className="anc-cmp-sectlabel">{title}</span>
        {models.map((m) => <span key={m.id} />)}
      </div>
      {rows.map((row) => (
        <div className="anc-cmp-row" key={`${title}-${row.label}`} style={{ gridTemplateColumns: colWidth }}>
          <span className="anc-cmp-rl">{row.label}</span>
          {row.cells.map((cell, i) => (
            <span
              key={i}
              className={`anc-cmp-cell${row.best === i ? ' is-best' : ''}`}
            >
              {cell}
            </span>
          ))}
        </div>
      ))}
    </div>
  )

  return (
    <div className="aurora-stage">
      <div className="aurora-layer">
        <div className="aurora-blob aurora-blob-1" />
        <div className="aurora-blob aurora-blob-2" />
        <div className="aurora-blob aurora-blob-3" />
      </div>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      {nav}

      <main className="anc-cmpwrap">
        <Link className="anc-day-back" href="/models">← All models</Link>
        <div className="anc-kicker">Compare</div>
        <h1 className="anc-date-heading">
          {hasTable ? models.map((m) => m.name).join('  vs  ') : 'Compare models'}
        </h1>

        <p className="anc-cmp-pick-sub">
          {hasTable
            ? 'Add, remove, or swap models to compare them side by side.'
            : models.length === 1
              ? 'Add at least one more model to see the side-by-side comparison.'
              : 'Pick two to four models to compare benchmarks, pricing, and capabilities side by side.'}
        </p>

        <CompareControls all={roster} selected={selected} />

        {hasTable ? (
          <>
            <div className="anc-cmp-scroll">
              <div className="anc-cmp">
                {/* model header row */}
                <div className="anc-cmp-row anc-cmp-head" style={{ gridTemplateColumns: colWidth }}>
                  <span className="anc-cmp-rl" />
                  {models.map((m) => (
                    <span className="anc-cmp-modelhd" key={m.id}>
                      <Link href={`/models/${m.slug}`}>{m.name}</Link>
                      <span className="anc-cmp-modelmeta">
                        {m.vendor ?? '—'}
                        {m.coverage_count ? ` · ${m.coverage_count} in the news` : ''}
                      </span>
                    </span>
                  ))}
                </div>

                {renderSection('Scores', scoreRows)}
                {renderSection('Specifications', specRows)}
                {benchRows.length > 0 && renderSection('Benchmarks', benchRows)}
              </div>
            </div>

            <p className="anc-cmp-legend">
              Use-case scores are 0–100 percentile composites across each area’s
              benchmarks, ranked against every model from the past year. Highlighted
              cells lead each row. Open a model for the full picture.
            </p>
          </>
        ) : (
          <div className="anc-cmp-emptytable">
            {models.length === 1
              ? `${models[0].name} is ready — add another model above to compare.`
              : 'Your comparison will appear here once you’ve picked at least two models.'}
          </div>
        )}

        <p className="anc-epoch-credit">
          Benchmarks &amp; model data from{' '}
          <a href="https://epoch.ai/data/ai-models" target="_blank" rel="noopener noreferrer">
            Epoch AI
          </a>{' '}
          (CC BY); pricing &amp; specs from{' '}
          <a href="https://openrouter.ai/models" target="_blank" rel="noopener noreferrer">
            OpenRouter
          </a>
          . ECI = Epoch Capabilities Index.
        </p>
      </main>
    </div>
  )
}
