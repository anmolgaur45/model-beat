'use client'

// Aurora frontier charts. The core is one FrontierChart — a scatter plus a
// running-max envelope — reused across several views by feeding it different
// X/Y accessors. It also supports a two-series "groups" mode (one envelope per
// group, e.g. open vs proprietary) and an envelope-off scatter mode (e.g. the
// capability profile). Hover + label declutter preserved; no entrance animation.
import { useMemo, useState, type ReactNode } from 'react'
import type { Model } from '@/types/article'

// ── geometry (viewBox units; SVG scales via width:100%) ─────────────────────
const CH_W = 960, CH_H = 460
const CH_M = { top: 30, right: 134, bottom: 46, left: 56 }
const CH_PW = CH_W - CH_M.left - CH_M.right
const CH_PH = CH_H - CH_M.top - CH_M.bottom

type Author = { label: string; hue: number; c: number }
type ChartModel = {
  name: string; slug: string; author: string
  // metric fields; only the ones a given chart needs are finite
  price: number; eci: number; releaseMs: number; release: string
  value: number; context: number; coding: number; reasoning: number
  openWeight: boolean | null
}

interface Axis {
  type: 'log' | 'time' | 'linear'
  value: (d: ChartModel) => number
  domain: [number, number]
  ticks: number[]
  format: (v: number) => string | number
  label?: string
}
interface YAxis {
  type?: 'linear' | 'log'
  value: (d: ChartModel) => number
  domain: [number, number]
  ticks: number[]
  format: (v: number) => string | number
}
type Group = { of: (d: ChartModel) => string; order: string[]; colors: Record<string, { color: string; label: string }> }

// ── scales ──────────────────────────────────────────────────────────────────
function makeXScale(type: Axis['type'], domain: [number, number]) {
  if (type === 'log') {
    const l0 = Math.log10(domain[0]), l1 = Math.log10(domain[1])
    return (v: number) => CH_M.left + ((Math.log10(v) - l0) / (l1 - l0)) * CH_PW
  }
  const [t0, t1] = domain
  return (v: number) => CH_M.left + ((v - t0) / (t1 - t0)) * CH_PW
}
function makeYScale(domain: [number, number], type: YAxis['type'] = 'linear') {
  if (type === 'log') {
    const l0 = Math.log10(domain[0]), l1 = Math.log10(domain[1])
    return (v: number) => CH_M.top + (1 - (Math.log10(v) - l0) / (l1 - l0)) * CH_PH
  }
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

function envPath(pts: ReadonlyArray<readonly [number, number]>, line: 'linear' | 'step') {
  if (!pts.length) return ''
  if (line === 'step') {
    let p = `M ${pts[0][0]} ${pts[0][1]}`
    for (let i = 1; i < pts.length; i++) p += ` L ${pts[i][0]} ${pts[i - 1][1]} L ${pts[i][0]} ${pts[i][1]}`
    return p
  }
  return 'M ' + pts.map((p) => `${p[0]} ${p[1]}`).join(' L ')
}

// ── one chart ───────────────────────────────────────────────────────────────
function FrontierChart({
  icon, title, subtitle, models, authors, x, y, line, accentLabel, gradId, onTip, onHideTip,
  envelope = true, labels = true, diagonal = false, groups,
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
  envelope?: boolean
  labels?: boolean
  diagonal?: boolean
  groups?: Group
}) {
  const [hover, setHover] = useState<string | null>(null)
  const sx = useMemo(() => makeXScale(x.type, x.domain), [x])
  const sy = useMemo(() => makeYScale(y.domain, y.type), [y])
  const xVal = x.value, yVal = y.value

  // one envelope normally; one per group in groups mode
  const envByGroup = useMemo(() => {
    if (!envelope) return [] as { key: string; env: ChartModel[]; color: string }[]
    if (groups) {
      return groups.order.map((k) => ({
        key: k,
        env: computeEnvelope(models.filter((m) => groups.of(m) === k), xVal, yVal),
        color: groups.colors[k].color,
      }))
    }
    return [{ key: '_', env: computeEnvelope(models, xVal, yVal), color: 'var(--ch-line)' }]
  }, [models, xVal, yVal, envelope, groups])

  const envSet = useMemo(() => new Set(envByGroup.flatMap((g) => g.env.map((d) => d.name))), [envByGroup])
  const byName = useMemo(() => Object.fromEntries(models.map((m) => [m.name, m])), [models])
  const colorOf = (d: ChartModel) => (groups ? groups.colors[groups.of(d)].color : `oklch(0.7 ${authors[d.author].c} ${authors[d.author].hue})`)

  const labelItems = labels ? envByGroup.flatMap((g) => g.env).map((d) => ({ text: d.name, mx: sx(xVal(d)), my: sy(yVal(d)) })) : []
  const placedLabels = declutter(labelItems, CH_M.top + CH_PH - 4)

  const showTip = (d: ChartModel, cx: number, cy: number) => { setHover(d.name); onTip(d, envSet.has(d.name), cx, cy) }
  const hideTip = () => { setHover(null); onHideTip() }

  return (
    <div className="ch-card">
      <div className="ch-head">
        <span className="ic">{icon}</span>
        <div>
          <h2>{title}</h2>
          <p>{subtitle}</p>
        </div>
        <div className="ch-legend">
          {groups ? (
            groups.order.map((k) => (
              <span className="ch-leg" key={k}><span className="ln" style={{ background: groups.colors[k].color }} />{groups.colors[k].label}</span>
            ))
          ) : (
            <>
              {envelope && <span className="ch-leg"><span className="ln" />{accentLabel}</span>}
              <span className="ch-leg"><span className="dt" style={{ background: 'var(--ch-scatter)' }} />Model</span>
            </>
          )}
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

        {diagonal && (
          <line className="ch-ref" x1={sx(x.domain[0])} y1={sy(y.domain[0])} x2={sx(x.domain[1])} y2={sy(y.domain[1])} />
        )}

        {/* envelope area only for single-series charts (groups draw lines only) */}
        {!groups && envelope && envByGroup[0]?.env.length > 0 && (() => {
          const pts = envByGroup[0].env.map((d) => [sx(xVal(d)), sy(yVal(d))] as const)
          const baseY = CH_M.top + CH_PH
          const lp = envPath(pts, line)
          let ap: string
          if (line === 'step') {
            ap = `M ${pts[0][0]} ${baseY} L ${pts[0][0]} ${pts[0][1]}`
            for (let i = 1; i < pts.length; i++) ap += ` L ${pts[i][0]} ${pts[i - 1][1]} L ${pts[i][0]} ${pts[i][1]}`
            ap += ` L ${pts[pts.length - 1][0]} ${baseY} Z`
          } else {
            ap = `M ${pts[0][0]} ${baseY} L ` + pts.map((p) => `${p[0]} ${p[1]}`).join(' L ') + ` L ${pts[pts.length - 1][0]} ${baseY} Z`
          }
          return (<>
            <path className="ch-area" d={ap} fill={`url(#${gradId})`} />
            <path className="ch-line" d={lp} />
          </>)
        })()}

        {/* group envelope lines (no fill) */}
        {groups && envByGroup.map((g) => g.env.length > 0 && (
          <path key={'gl' + g.key} className="ch-line" style={{ stroke: g.color }}
            d={envPath(g.env.map((d) => [sx(xVal(d)), sy(yVal(d))] as const), line)} />
        ))}

        {hover && byName[hover] && (
          <line className="ch-vline" x1={sx(xVal(byName[hover]))} y1={CH_M.top} x2={sx(xVal(byName[hover]))} y2={CH_M.top + CH_PH} />
        )}

        {models.filter((d) => !envSet.has(d.name)).map((d) => (
          <circle key={d.name} className={'ch-dot' + (hover && hover !== d.name ? ' dim' : '')}
            cx={sx(xVal(d))} cy={sy(yVal(d))} r={hover === d.name ? 5 : 3.2}
            style={hover === d.name || groups ? { fill: colorOf(d) } : undefined} />
        ))}
        {envByGroup.flatMap((g) => g.env).map((d) => (
          <circle key={d.name} className={'ch-dot-env' + (hover && hover !== d.name ? ' dim' : '')}
            cx={sx(xVal(d))} cy={sy(yVal(d))} r={hover === d.name ? 6 : 4.5}
            style={groups ? { fill: colorOf(d) } : undefined} />
        ))}

        {hover && byName[hover] && (
          <circle className="ch-ring on" cx={sx(xVal(byName[hover]))} cy={sy(yVal(byName[hover]))} r={10} />
        )}

        {placedLabels.map((l) => {
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

// open vs proprietary palette (muted, theme-stable)
const OPEN_COLOR = 'oklch(0.74 0.13 162)'
const CLOSED_COLOR = 'oklch(0.70 0.10 285)'

function blendedPrice(m: Model): number | null {
  if (m.price_in == null || m.price_out == null) return null
  const p = (m.price_in + m.price_out) / 2
  return p > 0 ? p : null
}
const fmtPrice = (v: number) => (v >= 1 ? '$' + (v % 1 === 0 ? v : v.toFixed(1)) : '$' + v)
const fmtMonthYear = (ms: number) => new Date(ms).toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' })
const fmtFullDate = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
const fmtTokens = (v: number) => (v >= 1_000_000 ? `${+(v / 1_000_000).toFixed(v % 1_000_000 ? 1 : 0)}M` : v >= 1000 ? `${Math.round(v / 1000)}K` : `${v}`)

function niceYTicks(min: number, max: number, n = 5): number[] {
  const out: number[] = []
  for (let i = 0; i < n; i++) out.push(Math.round(min + (i / (n - 1)) * (max - min)))
  return [...new Set(out)]
}
// powers of ten inside the domain (for log Y axes)
function pow10Ticks(min: number, max: number): number[] {
  const out: number[] = []
  for (let p = Math.ceil(Math.log10(min)); Math.pow(10, p) <= max * 1.0001; p++) out.push(Math.pow(10, p))
  return out.length >= 2 ? out : [min, max]
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

type TipKind = 'price' | 'date' | 'context' | 'split' | 'cap'
type Tip = {
  d: ChartModel
  onEnv: boolean
  kind: TipKind
  accent: string
  authorLabel: string
  rows: { k: string; v: string }[]
  badge: string | null
  left: number
  top: number
}

const DAY = 86_400_000

// ── ranked horizontal bars (e.g. best value) ────────────────────────────────
function RankBars({ icon, title, subtitle, unit, items }: {
  icon: ReactNode
  title: string
  subtitle: string
  unit: string
  items: { name: string; color: string; value: number; eci: number; price: number }[]
}) {
  const max = Math.max(...items.map((i) => i.value), 1)
  return (
    <div className="ch-card">
      <div className="ch-head"><span className="ic">{icon}</span><div><h2>{title}</h2><p>{subtitle}</p></div></div>
      <div className="ch-bars">
        {items.map((it) => (
          <div className="ch-bar-row" key={it.name} title={`ECI ${it.eci.toFixed(0)} · $${it.price.toFixed(2)} / 1M`}>
            <span className="ch-bar-name">{it.name}</span>
            <span className="ch-bar-track"><span className="ch-bar-fill" style={{ width: `${(it.value / max) * 100}%`, background: it.color }} /></span>
            <span className="ch-bar-val">{Math.round(it.value).toLocaleString()}</span>
          </div>
        ))}
      </div>
      <p className="ch-footnote">{unit}</p>
    </div>
  )
}

// ── monthly count columns (release cadence) ─────────────────────────────────
function ReleaseColumns({ icon, title, subtitle, months }: {
  icon: ReactNode
  title: string
  subtitle: string
  months: { ms: number; label: string; count: number }[]
}) {
  const max = Math.max(...months.map((m) => m.count), 1)
  let lastYear = ''
  return (
    <div className="ch-card">
      <div className="ch-head"><span className="ic">{icon}</span><div><h2>{title}</h2><p>{subtitle}</p></div></div>
      <div className="ch-cols">
        {months.map((m) => (
          <div className="ch-col" key={m.ms}
            title={`${new Date(m.ms).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })} · ${m.count} ${m.count === 1 ? 'release' : 'releases'}`}>
            <span className="ch-col-n">{m.count || ''}</span>
            <span className="ch-col-bar" style={{ height: `${(m.count / max) * 100}%` }} />
          </div>
        ))}
      </div>
      <div className="ch-cols-x">
        {months.map((m) => {
          const yr = new Date(m.ms).toLocaleDateString('en-US', { year: '2-digit', timeZone: 'UTC' })
          const showYr = yr !== lastYear
          lastYear = yr
          return <span key={m.ms}>{m.label}{showYr ? ` ’${yr}` : ''}</span>
        })}
      </div>
    </div>
  )
}

// ── the charts + shared tooltip ─────────────────────────────────────────────
export function ModelLandscape({ models }: { models: Model[] }) {
  const [tip, setTip] = useState<Tip | null>(null)

  const data = useMemo(() => {
    // colors for every vendor that appears anywhere
    const authorsMap: Record<string, Author> = {}
    const labelFor = new Map(models.map((m) => [authorKey(m.vendor), m.vendor]))
    for (const m of models) {
      const k = authorKey(m.vendor)
      if (authorsMap[k]) continue
      authorsMap[k] = KNOWN_AUTHORS[k] ?? { label: labelFor.get(k) ?? 'Unknown', hue: 250, c: 0 }
    }

    const toCM = (m: Model): ChartModel => ({
      name: m.name,
      slug: m.slug,
      author: authorKey(m.vendor),
      price: blendedPrice(m) ?? NaN,
      eci: (m.headline_score ?? NaN) as number,
      releaseMs: m.released_at ? new Date(m.released_at).getTime() : NaN,
      release: m.released_at ?? '',
      value: NaN,
      context: m.context_window ?? NaN,
      coding: m.buckets?.coding ?? NaN,
      reasoning: m.buckets?.reasoning ?? NaN,
      openWeight: m.is_open_weight ?? null,
    })

    const eciBase = models.filter((m) => m.headline_score != null && m.released_at).map(toCM)
    const priceModels = eciBase.filter((m) => Number.isFinite(m.price) && m.price > 0)
    const valueModels = priceModels.map((m) => ({ ...m, value: m.eci / m.price }))
    const contextModels = models.filter((m) => m.context_window != null && m.released_at).map(toCM)
    const openClosed = eciBase.filter((m) => m.openWeight === true || m.openWeight === false)
    const capModels = models
      .filter((m) => m.buckets?.coding != null && m.buckets?.reasoning != null)
      .map(toCM)

    // ECI Y axis shared by the price + time + split charts
    const ecis = eciBase.map((m) => m.eci)
    const eMin = ecis.length ? Math.min(...ecis) : 0
    const eMax = ecis.length ? Math.max(...ecis) : 1
    const yPad = (eMax - eMin) * 0.08 || 1
    const eciDomain: [number, number] = [eMin - yPad, eMax + yPad]
    const eciAxis: YAxis = { value: (d) => d.eci, domain: eciDomain, ticks: niceYTicks(eciDomain[0], eciDomain[1]), format: (v) => v }

    // ranked best-value list (intelligence per dollar), top dozen
    const colorFor = (k: string) => `oklch(0.7 ${authorsMap[k].c} ${authorsMap[k].hue})`
    const valueRank = [...valueModels]
      .sort((a, b) => b.value - a.value)
      .slice(0, 12)
      .map((m) => ({ name: m.name, color: colorFor(m.author), value: m.value, eci: m.eci, price: m.price }))

    // release cadence: count per calendar month, gaps filled so spacing is even
    const monthMap = new Map<number, { count: number; names: string[] }>()
    for (const m of models) {
      if (!m.released_at) continue
      const d = new Date(m.released_at)
      const ms = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)
      const cur = monthMap.get(ms) ?? { count: 0, names: [] }
      cur.count++; cur.names.push(m.name)
      monthMap.set(ms, cur)
    }
    const releasesByMonth: { ms: number; label: string; count: number }[] = []
    if (monthMap.size) {
      const keys = [...monthMap.keys()].sort((a, b) => a - b)
      const cursor = new Date(keys[0])
      while (cursor.getTime() <= keys[keys.length - 1]) {
        const ms = cursor.getTime()
        releasesByMonth.push({
          ms,
          label: cursor.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' }),
          count: monthMap.get(ms)?.count ?? 0,
        })
        cursor.setUTCMonth(cursor.getUTCMonth() + 1)
      }
    }

    return { authors: authorsMap, eciBase, priceModels, valueModels, contextModels, openClosed, capModels, eciAxis, valueRank, releasesByMonth }
  }, [models])

  const { authors, eciBase, priceModels, contextModels, openClosed, capModels, eciAxis, valueRank, releasesByMonth } = data

  const showTip = (d: ChartModel, onEnv: boolean, cx: number, cy: number, kind: TipKind) => {
    const accent = kind === 'split'
      ? (d.openWeight ? OPEN_COLOR : CLOSED_COLOR)
      : `oklch(0.7 ${authors[d.author].c} ${authors[d.author].hue})`
    const rows: { k: string; v: string }[] = []
    let badge: string | null = null
    if (kind === 'price') {
      rows.push({ k: 'Blended price', v: `$${d.price.toFixed(2)} / 1M` }, { k: 'Capability (ECI)', v: d.eci.toFixed(1) })
      badge = onEnv ? 'On value frontier' : null
    } else if (kind === 'date') {
      rows.push({ k: 'Released', v: fmtFullDate(d.release) }, { k: 'Capability (ECI)', v: d.eci.toFixed(1) })
      badge = onEnv ? 'Record setter' : null
    } else if (kind === 'context') {
      rows.push({ k: 'Released', v: fmtFullDate(d.release) }, { k: 'Context window', v: `${fmtTokens(d.context)} tokens` })
      badge = onEnv ? 'Longest yet' : null
    } else if (kind === 'split') {
      rows.push({ k: 'Released', v: fmtFullDate(d.release) }, { k: 'Capability (ECI)', v: d.eci.toFixed(1) }, { k: 'Access', v: d.openWeight ? 'Open-weight' : 'Proprietary' })
      badge = onEnv ? 'Frontier' : null
    } else {
      rows.push({ k: 'Coding', v: `${Math.round(d.coding)} pct` }, { k: 'Reasoning', v: `${Math.round(d.reasoning)} pct` })
    }
    const left = Math.max(14, Math.min(cx + 16, window.innerWidth - 244))
    const top = Math.max(14, Math.min(cy + 16, window.innerHeight - 190))
    setTip({ d, onEnv, kind, accent, authorLabel: authors[d.author].label, rows, badge, left, top })
  }
  const hideTip = () => setTip(null)

  const priceDomain = useMemo<[number, number]>(() => {
    if (priceModels.length < 2) return [0.1, 100]
    const ps = priceModels.map((m) => m.price)
    return [Math.min(...ps) * 0.8, Math.max(...ps) * 1.2]
  }, [priceModels])

  const timeDomain = useMemo<[number, number]>(() => {
    const ts = eciBase.map((m) => m.releaseMs).filter(Number.isFinite)
    if (!ts.length) return [0, 1]
    const min = Math.min(...ts), max = Math.max(...ts)
    if (min === max) return [min - 30 * DAY, max + 30 * DAY]
    return [min - 6 * DAY, max + 6 * DAY]
  }, [eciBase])

  const ctxTimeDomain = useMemo<[number, number]>(() => {
    const ts = contextModels.map((m) => m.releaseMs).filter(Number.isFinite)
    if (!ts.length) return timeDomain
    const min = Math.min(...ts), max = Math.max(...ts)
    return [min - 6 * DAY, max + 6 * DAY]
  }, [contextModels, timeDomain])

  const ctxDomain = useMemo<[number, number]>(() => {
    if (contextModels.length < 2) return [1000, 1_000_000]
    const cs = contextModels.map((m) => m.context)
    return [Math.min(...cs) * 0.8, Math.max(...cs) * 1.2]
  }, [contextModels])

  const dotIcon = (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2.5 13.5h11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /><circle cx="4" cy="10" r="1.5" fill="currentColor" /><circle cx="7.5" cy="7" r="1.5" fill="currentColor" /><circle cx="11" cy="4" r="1.5" fill="currentColor" /></svg>
  )
  const stepIcon = (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2.5 12.5V10h3V7h3V4h4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
  )
  const coinIcon = (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.4" /><path d="M8 5v6M6.5 6.4h2.2a1.1 1.1 0 0 1 0 2.2H7.3a1.1 1.1 0 0 0 0 2.2H9.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
  )
  const ctxIcon = (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2.5 4.5h11M2.5 8h7M2.5 11.5h9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
  )
  const splitIcon = (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 12.5l3.5-4 2 2.2L13 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /><path d="M3 8.5l3.5 1 2-1.5L13 9.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" opacity="0.5" /></svg>
  )
  const scatterIcon = (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="4.5" cy="11" r="1.4" fill="currentColor" /><circle cx="8" cy="7.5" r="1.4" fill="currentColor" /><circle cx="11.5" cy="4.5" r="1.4" fill="currentColor" /><circle cx="11" cy="10" r="1.4" fill="currentColor" /><circle cx="5.5" cy="5.5" r="1.4" fill="currentColor" /></svg>
  )
  const colsIcon = (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="2.5" y="9" width="2.6" height="4.5" rx="0.6" fill="currentColor" /><rect x="6.7" y="5.5" width="2.6" height="8" rx="0.6" fill="currentColor" /><rect x="10.9" y="7.5" width="2.6" height="6" rx="0.6" fill="currentColor" /></svg>
  )

  const access: Group = {
    of: (d) => (d.openWeight ? 'open' : 'closed'),
    order: ['closed', 'open'],
    colors: { open: { color: OPEN_COLOR, label: 'Open-weight' }, closed: { color: CLOSED_COLOR, label: 'Proprietary' } },
  }

  return (
    <div className="ch-embed">
      {priceModels.length >= 2 && (
        <FrontierChart
          icon={dotIcon}
          title="Price vs intelligence"
          subtitle="Blended API price (log scale) against the capability index. The line traces the value frontier — the cheapest model at each capability level."
          models={priceModels} authors={authors}
          x={{ type: 'log', value: (d) => d.price, domain: priceDomain, ticks: priceTicks(priceDomain), format: fmtPrice, label: 'Blended price ($ / 1M tokens)' }}
          y={eciAxis} line="linear" accentLabel="Value frontier" gradId="chGradPrice"
          onTip={(d, e, cx, cy) => showTip(d, e, cx, cy, 'price')} onHideTip={hideTip}
        />
      )}

      {eciBase.length >= 2 && (
        <FrontierChart
          icon={stepIcon}
          title="How the frontier moved"
          subtitle="Every model from the past year plotted by release date and intelligence. The line is the record envelope — each step up set a new high-water mark."
          models={eciBase} authors={authors}
          x={{ type: 'time', value: (d) => d.releaseMs, domain: timeDomain, ticks: monthTicks(timeDomain[0], timeDomain[1]), format: fmtMonthYear, label: 'Release date' }}
          y={eciAxis} line="step" accentLabel="Record envelope" gradId="chGradTime"
          onTip={(d, e, cx, cy) => showTip(d, e, cx, cy, 'date')} onHideTip={hideTip}
        />
      )}

      {releasesByMonth.length >= 2 && (
        <ReleaseColumns
          icon={colsIcon}
          title="Model releases per month"
          subtitle="How many of the tracked models launched each month. The pace of notable releases, straight from the calendar."
          months={releasesByMonth}
        />
      )}

      {contextModels.length >= 2 && (
        <FrontierChart
          icon={ctxIcon}
          title="Context windows over time"
          subtitle="The maximum context length on offer (log scale), by release date. The line is the record — the context race ran from a few thousand tokens to over a million."
          models={contextModels} authors={authors}
          x={{ type: 'time', value: (d) => d.releaseMs, domain: ctxTimeDomain, ticks: monthTicks(ctxTimeDomain[0], ctxTimeDomain[1]), format: fmtMonthYear, label: 'Release date' }}
          y={{ type: 'log', value: (d) => d.context, domain: ctxDomain, ticks: pow10Ticks(ctxDomain[0], ctxDomain[1]), format: fmtTokens }}
          line="step" accentLabel="Record" gradId="chGradCtx"
          onTip={(d, e, cx, cy) => showTip(d, e, cx, cy, 'context')} onHideTip={hideTip}
        />
      )}

      {openClosed.length >= 4 && (
        <FrontierChart
          icon={splitIcon}
          title="Open-weight vs proprietary"
          subtitle="The intelligence frontier over time, split by access. Two record envelopes show how far open-weight releases trail (or keep pace with) closed models."
          models={openClosed} authors={authors} groups={access}
          x={{ type: 'time', value: (d) => d.releaseMs, domain: timeDomain, ticks: monthTicks(timeDomain[0], timeDomain[1]), format: fmtMonthYear, label: 'Release date' }}
          y={eciAxis} line="step" accentLabel="Frontier" gradId="chGradSplit"
          onTip={(d, e, cx, cy) => showTip(d, e, cx, cy, 'split')} onHideTip={hideTip}
        />
      )}

      {valueRank.length >= 3 && (
        <RankBars
          icon={coinIcon}
          title="Best value: intelligence per dollar"
          subtitle="Capability index (ECI) divided by blended API price — higher means more capability for the money. The strongest value on offer, ranked."
          unit="ECI per $1 of blended price (per 1M tokens) · hover a bar for its score and price"
          items={valueRank}
        />
      )}

      {capModels.length >= 4 && (
        <FrontierChart
          icon={scatterIcon}
          title="Coding vs reasoning"
          subtitle="Each model's coding percentile against its reasoning percentile. The diagonal marks balanced models; points off it lean toward one skill. Top-right is strong at both."
          models={capModels} authors={authors} envelope={false} labels={false} diagonal
          x={{ type: 'linear', value: (d) => d.coding, domain: [0, 100], ticks: [0, 25, 50, 75, 100], format: (v) => v, label: 'Coding percentile  ·  reasoning on the vertical axis' }}
          y={{ value: (d) => d.reasoning, domain: [0, 100], ticks: [0, 25, 50, 75, 100], format: (v) => v }}
          line="linear" accentLabel="" gradId="chGradCap"
          onTip={(d, e, cx, cy) => showTip(d, e, cx, cy, 'cap')} onHideTip={hideTip}
        />
      )}

      <p className="ch-footnote">
        Benchmarks &amp; model data from Epoch AI (CC BY); pricing blended across providers via OpenRouter. ECI = Epoch Capabilities Index; percentiles rank a model against the others tracked here.
      </p>

      {tip && (
        <div className="ch-tip" style={{ left: tip.left, top: tip.top }}>
          <div className="nm">
            <span className="sw" style={{ background: tip.accent }} />
            {tip.d.name}
          </div>
          <div className="auth">{tip.authorLabel}</div>
          <div className="rows">
            {tip.rows.map((r) => (
              <div className="row" key={r.k}><span className="k">{r.k}</span><span className="v">{r.v}</span></div>
            ))}
          </div>
          {tip.badge && <span className="badge">{tip.badge}</span>}
        </div>
      )}
    </div>
  )
}
