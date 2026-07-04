import Link from 'next/link'
import type { Model, ModelBenchmark } from '@/types/article'
import { BUCKETS } from '@/lib/modelBuckets'

// Side-by-side comparison table, shared by the interactive /models/compare tool
// and the static /models/compare/[pair] SEO pages so they never diverge.

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
  if (b.unit === 'min') return b.score >= 60 ? `${(b.score / 60).toFixed(1)} h` : `${Math.round(b.score)} min`
  return `${Math.round(b.score)}`
}

// Index of the best value in a row, or null when fewer than two models have one.
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

type Row = { label: string; cells: string[]; best: number | null }

export function CompareTable({ models }: { models: Model[] }) {
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

  // A real <table> (not a styled div grid) so answer engines and parsers can
  // lift the head-to-head specs; row-label <th scope="row"> cells stay sticky
  // during horizontal scroll on narrow screens.
  const renderSection = (title: string, rows: Row[]) => (
    <tbody key={title}>
      <tr className="anc-cmp-section">
        <th scope="colgroup" colSpan={models.length + 1} className="anc-cmp-sectlabel">
          {title}
        </th>
      </tr>
      {rows.map((row) => (
        <tr className="anc-cmp-row" key={`${title}-${row.label}`}>
          <th scope="row" className="anc-cmp-rl">{row.label}</th>
          {row.cells.map((cell, i) => (
            <td key={i} className={`anc-cmp-cell${row.best === i ? ' is-best' : ''}`}>
              {cell}
            </td>
          ))}
        </tr>
      ))}
    </tbody>
  )

  return (
    <>
      <div className="anc-cmp-scroll">
        <table className="anc-cmp">
          <thead>
            <tr className="anc-cmp-head">
              <th scope="col" className="anc-cmp-rl"><span className="sr-only">Attribute</span></th>
              {models.map((m) => (
                <th scope="col" className="anc-cmp-modelhd" key={m.id}>
                  <Link href={`/models/${m.slug}`}>{m.name}</Link>
                  <span className="anc-cmp-modelmeta">
                    {m.vendor ?? '—'}
                    {m.coverage_count ? ` · ${m.coverage_count} in the news` : ''}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          {renderSection('Scores', scoreRows)}
          {renderSection('Specifications', specRows)}
          {benchRows.length > 0 && renderSection('Benchmarks', benchRows)}
        </table>
      </div>

      <p className="anc-cmp-legend">
        Use-case scores are 0–100 percentile composites across each area’s benchmarks, ranked against
        every model from the past year. Highlighted cells lead each row. Open a model for the full picture.
      </p>
    </>
  )
}
