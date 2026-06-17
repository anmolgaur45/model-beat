'use client'

// Aurora frontier charts (design handoff). Both charts are the same chart
// mathematically — a scatter plus a running-max envelope — rendered by one
// FrontierChart from a shared model list. Chart 1 plots blended price (log x)
// vs ECI → the value frontier; chart 2 plots release date vs ECI → the record
// staircase. Ported from design_handoff_charts/charts.jsx; hover + label
// declutter preserved, no entrance animation (resting state fully visible).
import { useMemo, useState, type ReactNode } from 'react'
import type { Model } from '@/types/article'

// ── geometry (viewBox units; SVG scales via width:100%) ─────────────────────
const CH_W = 960, CH_H = 460
const CH_M = { top: 30, right: 134, bottom: 46, left: 56 }
const CH_PW = CH_W - CH_M.left - CH_M.right
const CH_PH = CH_H - CH_M.top - CH_M.bottom

type Author = { label: string; hue: number; c: number }
type ChartModel = { name: string; slug: string; author: string; price: number; eci: number; releaseMs: number; release: string }

interface Axis {
  type: 'log' | 'time'
  value: (d: ChartModel) => number
  domain: [number, number]
  ticks: number[]
  format: (v: number) => string | number
  label?: string
}
interface YAxis {
  value: (d: ChartModel) => number
  domain: [number, number]
  ticks: number[]
  format: (v: number) => string | number
}

// ── scales ──────────────────────────────────────────────────────────────────
function makeXScale(type: Axis['type'], domain: [number, number]) {
  if (type === 'log') {
    const l0 = Math.log10(domain[0]), l1 = Math.log10(domain[1])
    return (v: number) => CH_M.left + ((Math.log10(v) - l0) / (l1 - l0)) * CH_PW
  }
  const [t0, t1] = domain
  return (v: number) => CH_M.left + ((v - t0) / (t1 - t0)) * CH_PW
}
function makeYScale(domain: [number, number]) {
  const [y0, y1] = domain
  return (v: number) => CH_M.top + (1 - (v - y0) / (y1 - y0)) * CH_PH
}

// running-max envelope: sorted by x asc, a point joins when its y strictly
// exceeds the max y of all points at lower-or-equal x.
function computeEnvelope(models: ChartModel[], xVal: (d: ChartModel) => number, yVal: (d: ChartModel) => number) {
  const sorted = [...models].sort((a, b) => xVal(a) - xVal(b))
  let max = -Infinity
  const env: ChartModel[] = []
  for (const m of sorted) if (yVal(m) > max) { env.push(m); max = yVal(m) }
  return env
}

type LabelItem = { text: string; mx: number; my: number }
type PlacedLabel = LabelItem & { lx: number; ly: number; anchor: 'start' | 'middle' | 'end'; w: number; bx0: number; leader: boolean }

// label declutter: stack colliding labels upward (or below if they hit the top),
// adding thin leader lines back to the marker.
function declutter(items: LabelItem[], bottomLimit: number): PlacedLabel[] {
  const CHAR = 6.5, PAD = 3
  const placed: { x0: number; x1: number; y0: number; y1: number }[] = []
  const out: PlacedLabel[] = []
  const sorted = [...items].sort((a, b) => a.mx - b.mx)
  for (const it of sorted) {
    const w = it.text.length * CHAR + 4
    let anchor: 'start' | 'middle' | 'end' = 'middle'
    if (it.mx > CH_M.left + CH_PW - 64) anchor = 'end'
    else if (it.mx < CH_M.left + 50) anchor = 'start'
    const x0 = (lx: number) => (anchor === 'middle' ? lx - w / 2 : anchor === 'end' ? lx - w : lx)
    const lx = it.mx
    let ly = it.my - 13
    const hits = (yy: number) => {
      const bx0 = x0(lx), bx1 = bx0 + w, by0 = yy - 11, by1 = yy + 3
      return placed.some((p) => bx0 < p.x1 + PAD && bx1 > p.x0 - PAD && by0 < p.y1 + PAD && by1 > p.y0 - PAD)
    }
    let guard = 0
    while (hits(ly) && ly > CH_M.top + 6 && guard < 60) { ly -= 5; guard++ }
    if (hits(ly)) { // fell off the top — drop below the marker instead
      ly = it.my + 16
      guard = 0
      while (hits(ly) && ly < bottomLimit && guard < 60) { ly += 5; guard++ }
    }
    const bx0 = x0(lx)
    placed.push({ x0: bx0, x1: bx0 + w, y0: ly - 11, y1: ly + 3 })
    out.push({ ...it, lx, ly, anchor, w, bx0, leader: Math.abs(ly - (it.my - 13)) > 7 })
  }
  return out
}

// ── one chart ───────────────────────────────────────────────────────────────
function FrontierChart({
  icon, title, subtitle, models, authors, x, y, line, accentLabel, gradId, onTip, onHideTip,
}: {
  icon: ReactNode
  title: string
  subtitle: string
  models: ChartModel[]
  authors: Record<string, Author>
  x: Axis
  y: YAxis
  line: 'linear' | 'step'
  accentLabel: string
  gradId: string
  onTip: (d: ChartModel, onEnv: boolean, cx: number, cy: number) => void
  onHideTip: () => void
}) {
  const [hover, setHover] = useState<string | null>(null)
  const sx = useMemo(() => makeXScale(x.type, x.domain), [x])
  const sy = useMemo(() => makeYScale(y.domain), [y])
  const xVal = x.value, yVal = y.value

  const env = useMemo(() => computeEnvelope(models, xVal, yVal), [models, xVal, yVal])
  const envSet = useMemo(() => new Set(env.map((d) => d.name)), [env])
  const byName = useMemo(() => Object.fromEntries(models.map((m) => [m.name, m])), [models])

  const pts = env.map((d) => [sx(xVal(d)), sy(yVal(d))] as const)
  let linePath = '', areaPath = ''
  if (pts.length) {
    if (line === 'step') {
      linePath = `M ${pts[0][0]} ${pts[0][1]}`
      for (let i = 1; i < pts.length; i++) linePath += ` L ${pts[i][0]} ${pts[i - 1][1]} L ${pts[i][0]} ${pts[i][1]}`
    } else {
      linePath = 'M ' + pts.map((p) => `${p[0]} ${p[1]}`).join(' L ')
    }
    const baseY = CH_M.top + CH_PH
    if (line === 'step') {
      areaPath = `M ${pts[0][0]} ${baseY} L ${pts[0][0]} ${pts[0][1]}`
      for (let i = 1; i < pts.length; i++) areaPath += ` L ${pts[i][0]} ${pts[i - 1][1]} L ${pts[i][0]} ${pts[i][1]}`
      areaPath += ` L ${pts[pts.length - 1][0]} ${baseY} Z`
    } else {
      areaPath = `M ${pts[0][0]} ${baseY} L ` + pts.map((p) => `${p[0]} ${p[1]}`).join(' L ') + ` L ${pts[pts.length - 1][0]} ${baseY} Z`
    }
  }

  const labels = declutter(
    env.map((d) => ({ text: d.name, mx: sx(xVal(d)), my: sy(yVal(d)) })),
    CH_M.top + CH_PH - 4,
  )

  const showTip = (d: ChartModel, cx: number, cy: number) => {
    setHover(d.name)
    onTip(d, envSet.has(d.name), cx, cy)
  }
  const hideTip = () => { setHover(null); onHideTip() }
  const dotColor = (d: ChartModel) => `oklch(0.7 ${authors[d.author].c} ${authors[d.author].hue})`

  return (
    <div className="ch-card">
      <div className="ch-head">
        <span className="ic">{icon}</span>
        <div>
          <h2>{title}</h2>
          <p>{subtitle}</p>
        </div>
        <div className="ch-legend">
          <span className="ch-leg"><span className="ln" />{accentLabel}</span>
          <span className="ch-leg"><span className="dt" style={{ background: 'var(--ch-scatter)' }} />Model</span>
        </div>
      </div>

      <svg className="ch-svg" viewBox={`0 0 ${CH_W} ${CH_H}`} role="img" aria-label={title}>
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--ch-line)" stopOpacity="0.22" />
            <stop offset="100%" stopColor="var(--ch-line)" stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {y.ticks.map((t) => (
          <g key={'y' + t}>
            <line className="ch-grid" x1={CH_M.left} y1={sy(t)} x2={CH_M.left + CH_PW} y2={sy(t)} />
            <text className="ch-axis-text" x={CH_M.left - 12} y={sy(t) + 4} textAnchor="end">{y.format(t)}</text>
          </g>
        ))}
        {x.ticks.map((t, i) => (
          <text key={'x' + i} className="ch-axis-text" x={sx(t)} y={CH_M.top + CH_PH + 22} textAnchor="middle">{x.format(t)}</text>
        ))}
        {x.label && <text className="ch-axis-label" x={CH_M.left + CH_PW / 2} y={CH_H - 4} textAnchor="middle">{x.label}</text>}

        <path className="ch-area" d={areaPath} fill={`url(#${gradId})`} />
        <path className="ch-line" d={linePath} />

        {hover && (() => {
          const d = byName[hover]
          return <line className="ch-vline" x1={sx(xVal(d))} y1={CH_M.top} x2={sx(xVal(d))} y2={CH_M.top + CH_PH} />
        })()}

        {models.filter((d) => !envSet.has(d.name)).map((d) => (
          <circle key={d.name} className={'ch-dot' + (hover && hover !== d.name ? ' dim' : '')}
            cx={sx(xVal(d))} cy={sy(yVal(d))} r={hover === d.name ? 5 : 3.2}
            style={hover === d.name ? { fill: dotColor(d) } : undefined} />
        ))}
        {env.map((d) => (
          <circle key={d.name} className={'ch-dot-env' + (hover && hover !== d.name ? ' dim' : '')}
            cx={sx(xVal(d))} cy={sy(yVal(d))} r={hover === d.name ? 6 : 4.5} />
        ))}

        {hover && (() => {
          const d = byName[hover]
          return <circle className="ch-ring on" cx={sx(xVal(d))} cy={sy(yVal(d))} r={10} />
        })()}

        {labels.map((l) => {
          const d = byName[l.text]
          return (
            <g key={l.text}>
              {l.leader && <line className="ch-leader" x1={l.mx} y1={l.my} x2={l.mx} y2={l.ly + 2} />}
              <text className={'ch-lab' + (hover && hover !== l.text ? ' dim' : '') + (hover === l.text ? ' on' : '')}
                x={l.lx} y={l.ly} textAnchor={l.anchor}>{l.text}</text>
              <rect className="ch-lab-hit" x={l.bx0} y={l.ly - 11} width={l.w} height={15}
                onMouseEnter={(e) => showTip(d, e.clientX, e.clientY)}
                onMouseMove={(e) => onTip(d, true, e.clientX, e.clientY)}
                onMouseLeave={hideTip} />
            </g>
          )
        })}

        {models.map((d) => (
          <circle key={'h' + d.name} className="ch-hot" cx={sx(xVal(d))} cy={sy(yVal(d))} r={12}
            onMouseEnter={(e) => showTip(d, e.clientX, e.clientY)}
            onMouseMove={(e) => onTip(d, envSet.has(d.name), e.clientX, e.clientY)}
            onMouseLeave={hideTip} />
        ))}
      </svg>
    </div>
  )
}

// ── author colors (muted; low chroma on purpose) ────────────────────────────
const KNOWN_AUTHORS: Record<string, { label: string; hue: number; c: number }> = {
  openai: { label: 'OpenAI', hue: 160, c: 0.06 },
  anthropic: { label: 'Anthropic', hue: 40, c: 0.10 },
  google: { label: 'Google', hue: 250, c: 0.11 },
  deepseek: { label: 'DeepSeek', hue: 275, c: 0.11 },
  xai: { label: 'xAI', hue: 250, c: 0.01 },
  qwen: { label: 'Qwen', hue: 320, c: 0.12 },
  minimax: { label: 'MiniMax', hue: 350, c: 0.11 },
  mistral: { label: 'Mistral', hue: 55, c: 0.12 },
  meta: { label: 'Meta', hue: 235, c: 0.10 },
  moonshot: { label: 'Moonshot', hue: 20, c: 0.10 },
  nvidia: { label: 'NVIDIA', hue: 140, c: 0.09 },
  microsoft: { label: 'Microsoft', hue: 220, c: 0.07 },
  cohere: { label: 'Cohere', hue: 300, c: 0.09 },
  zhipu: { label: 'Zhipu', hue: 200, c: 0.08 },
}
const VENDOR_KEY: Record<string, string> = {
  'openai': 'openai', 'anthropic': 'anthropic', 'google': 'google', 'google deepmind': 'google',
  'deepmind': 'google', 'meta': 'meta', 'meta ai': 'meta', 'mistral': 'mistral', 'mistral ai': 'mistral',
  'deepseek': 'deepseek', 'alibaba': 'qwen', 'qwen': 'qwen', 'minimax': 'minimax', 'moonshot': 'moonshot',
  'moonshot ai': 'moonshot', 'xai': 'xai', 'nvidia': 'nvidia', 'microsoft': 'microsoft', 'cohere': 'cohere',
  'zhipu': 'zhipu', 'zhipu ai': 'zhipu', 'z.ai': 'zhipu',
}
function authorKey(vendor: string | null): string {
  const v = (vendor ?? '').trim().toLowerCase()
  return VENDOR_KEY[v] ?? (v ? v.replace(/[^a-z0-9]+/g, '-') : 'unknown')
}

function blendedPrice(m: Model): number | null {
  if (m.price_in == null || m.price_out == null) return null
  const p = (m.price_in + m.price_out) / 2
  return p > 0 ? p : null
}
const fmtPrice = (v: number) => (v >= 1 ? '$' + (v % 1 === 0 ? v : v.toFixed(1)) : '$' + v)
const fmtMonthYear = (ms: number) => new Date(ms).toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' })
const fmtFullDate = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })

function niceYTicks(min: number, max: number, n = 5): number[] {
  const out: number[] = []
  for (let i = 0; i < n; i++) out.push(Math.round(min + (i / (n - 1)) * (max - min)))
  return [...new Set(out)]
}
function priceTicks(domain: [number, number]): number[] {
  return [0.03, 0.1, 0.3, 1, 3, 10, 30, 100, 300].filter((t) => t >= domain[0] && t <= domain[1])
}
function monthTicks(t0: number, t1: number, maxTicks = 7): number[] {
  const ticks: number[] = []
  const d = new Date(t0)
  d.setUTCDate(1)
  if (new Date(t0).getUTCDate() > 1) d.setUTCMonth(d.getUTCMonth() + 1)
  while (d.getTime() <= t1) { ticks.push(d.getTime()); d.setUTCMonth(d.getUTCMonth() + 1) }
  if (ticks.length > maxTicks) {
    const step = Math.ceil(ticks.length / maxTicks)
    return ticks.filter((_, i) => i % step === 0)
  }
  return ticks
}

type Tip = {
  d: ChartModel
  onEnv: boolean
  kind: 'price' | 'date'
  rows: { k: string; v: string }[]
  left: number
  top: number
}

const DAY = 86_400_000

// ── the two charts + shared tooltip (replaces the old landscape) ────────────
export function ModelLandscape({ models }: { models: Model[] }) {
  const [tip, setTip] = useState<Tip | null>(null)

  const { authors, priceModels, timeModels, yAxis } = useMemo(() => {
    const base: ChartModel[] = models
      .filter((m) => m.headline_score != null && m.released_at)
      .map((m) => ({
        name: m.name,
        slug: m.slug,
        author: authorKey(m.vendor),
        price: blendedPrice(m) ?? NaN,
        eci: m.headline_score as number,
        releaseMs: new Date(m.released_at as string).getTime(),
        release: m.released_at as string,
      }))

    const authorsMap: Record<string, Author> = {}
    const labelFor = new Map(models.map((m) => [authorKey(m.vendor), m.vendor]))
    for (const cm of base) {
      if (authorsMap[cm.author]) continue
      const known = KNOWN_AUTHORS[cm.author]
      authorsMap[cm.author] = known ?? { label: labelFor.get(cm.author) ?? 'Unknown', hue: 250, c: 0 }
    }

    const priceModels = base.filter((m) => Number.isFinite(m.price) && m.price > 0)
    const timeModels = base.filter((m) => Number.isFinite(m.releaseMs))

    const ecis = base.map((m) => m.eci)
    const eMin = ecis.length ? Math.min(...ecis) : 0
    const eMax = ecis.length ? Math.max(...ecis) : 1
    const yPad = (eMax - eMin) * 0.08 || 1
    const yDomain: [number, number] = [eMin - yPad, eMax + yPad]
    const yAxis: YAxis = {
      value: (d) => d.eci,
      domain: yDomain,
      ticks: niceYTicks(yDomain[0], yDomain[1]),
      format: (v) => v,
    }
    return { authors: authorsMap, priceModels, timeModels, yAxis }
  }, [models])

  const showTip = (d: ChartModel, onEnv: boolean, cx: number, cy: number, kind: 'price' | 'date') => {
    const rows = kind === 'price'
      ? [{ k: 'Blended price', v: `$${d.price.toFixed(2)} / 1M` }, { k: 'Capability (ECI)', v: d.eci.toFixed(1) }]
      : [{ k: 'Released', v: fmtFullDate(d.release) }, { k: 'Capability (ECI)', v: d.eci.toFixed(1) }]
    const left = Math.max(14, Math.min(cx + 16, window.innerWidth - 244))
    const top = Math.max(14, Math.min(cy + 16, window.innerHeight - 170))
    setTip({ d, onEnv, kind, rows, left, top })
  }
  const hideTip = () => setTip(null)

  const priceDomain = useMemo<[number, number]>(() => {
    if (priceModels.length < 2) return [0.1, 100]
    const ps = priceModels.map((m) => m.price)
    return [Math.min(...ps) * 0.8, Math.max(...ps) * 1.2]
  }, [priceModels])

  const timeDomain = useMemo<[number, number]>(() => {
    if (timeModels.length === 0) return [0, 1]
    const ts = timeModels.map((m) => m.releaseMs)
    const min = Math.min(...ts), max = Math.max(...ts)
    if (min === max) return [min - 30 * DAY, max + 30 * DAY]
    return [min - 6 * DAY, max + 6 * DAY]
  }, [timeModels])

  const barIcon = (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2.5 13.5h11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /><circle cx="4" cy="10" r="1.5" fill="currentColor" /><circle cx="7.5" cy="7" r="1.5" fill="currentColor" /><circle cx="11" cy="4" r="1.5" fill="currentColor" /></svg>
  )
  const stepIcon = (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2.5 12.5V10h3V7h3V4h4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
  )

  return (
    <div className="ch-embed">
      {priceModels.length >= 2 && (
        <FrontierChart
          icon={barIcon}
          title="Price vs intelligence"
          subtitle="Blended API price (log scale) against the capability index. The line traces the value frontier — the cheapest model at each capability level."
          models={priceModels}
          authors={authors}
          x={{ type: 'log', value: (d) => d.price, domain: priceDomain, ticks: priceTicks(priceDomain), format: fmtPrice, label: 'Blended price ($ / 1M tokens)' }}
          y={yAxis}
          line="linear"
          accentLabel="Value frontier"
          gradId="chAreaGradPrice"
          onTip={(d, onEnv, cx, cy) => showTip(d, onEnv, cx, cy, 'price')}
          onHideTip={hideTip}
        />
      )}

      {timeModels.length >= 2 && (
        <FrontierChart
          icon={stepIcon}
          title="How the frontier moved"
          subtitle="Every model from the past year plotted by release date and intelligence. The line is the record envelope — each step up set a new high-water mark."
          models={timeModels}
          authors={authors}
          x={{ type: 'time', value: (d) => d.releaseMs, domain: timeDomain, ticks: monthTicks(timeDomain[0], timeDomain[1]), format: fmtMonthYear, label: 'Release date' }}
          y={yAxis}
          line="step"
          accentLabel="Record envelope"
          gradId="chAreaGradTime"
          onTip={(d, onEnv, cx, cy) => showTip(d, onEnv, cx, cy, 'date')}
          onHideTip={hideTip}
        />
      )}

      <p className="ch-footnote">
        Benchmarks &amp; model data from Epoch AI (CC BY); pricing blended across providers via OpenRouter. ECI = Epoch Capabilities Index.
      </p>

      {tip && (
        <div className="ch-tip" style={{ left: tip.left, top: tip.top }}>
          <div className="nm">
            <span className="sw" style={{ background: `oklch(0.7 ${authors[tip.d.author].c} ${authors[tip.d.author].hue})` }} />
            {tip.d.name}
          </div>
          <div className="auth">{authors[tip.d.author].label}</div>
          <div className="rows">
            {tip.rows.map((r) => (
              <div className="row" key={r.k}><span className="k">{r.k}</span><span className="v">{r.v}</span></div>
            ))}
          </div>
          {tip.onEnv && <span className="badge">{tip.kind === 'price' ? 'On value frontier' : 'Record setter'}</span>}
        </div>
      )}
    </div>
  )
}
