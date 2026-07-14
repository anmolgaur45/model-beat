'use client'

// Aurora frontier charts. The core is one FrontierChart — a scatter plus a
// running-max envelope — reused across several views by feeding it different
// X/Y accessors. It also supports a two-series "groups" mode (one envelope per
// group, e.g. open vs proprietary) and an envelope-off scatter mode (e.g. the
// hype map). Geometry is parameterized: phones get a compact variant (taller
// aspect, larger type in viewBox units, fewer ticks/labels) instead of a
// shrunken desktop chart, every mark is tappable (tap = tooltip, tap away =
// dismiss), and each SVG chart can expand into a fullscreen overlay.
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Model } from '@/types/article'

// ── geometry (viewBox units; SVG scales via width:100%) ─────────────────────
interface Geom {
  W: number; H: number
  M: { top: number; right: number; bottom: number; left: number }
  PW: number; PH: number
  maxXTicks: number; yTickN: number
  labelCap: number // max direct labels on the plot
  charW: number // approx label glyph width (viewBox units) for declutter
}
function makeGeom(compact: boolean): Geom {
  const g = compact
    ? { W: 430, H: 440, M: { top: 28, right: 18, bottom: 48, left: 46 }, maxXTicks: 4, yTickN: 4, labelCap: 5, charW: 7.6 }
    : { W: 960, H: 460, M: { top: 30, right: 134, bottom: 46, left: 56 }, maxXTicks: 7, yTickN: 5, labelCap: 24, charW: 6.5 }
  return { ...g, PW: g.W - g.M.left - g.M.right, PH: g.H - g.M.top - g.M.bottom }
}

// Compact below 641px CSS width — matches where the chart's rendered scale
// would make desktop-geometry text unreadable.
function useCompact(): boolean {
  const [compact, setCompact] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 640px)')
    const on = () => setCompact(mq.matches)
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return compact
}

type Author = { label: string; hue: number; c: number }
type ChartModel = {
  name: string; slug: string; author: string
  // metric fields; only the ones a given chart needs are finite
  price: number; eci: number; releaseMs: number; release: string
  value: number; context: number; coverage: number
  openWeight: boolean | null
}

interface Axis {
  type: 'log' | 'time' | 'linear' | 'sqrt'
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
function makeXScale(type: Axis['type'], domain: [number, number], g: Geom) {
  if (type === 'log') {
    const l0 = Math.log10(domain[0]), l1 = Math.log10(domain[1])
    return (v: number) => g.M.left + ((Math.log10(v) - l0) / (l1 - l0)) * g.PW
  }
  if (type === 'sqrt') {
    const s0 = Math.sqrt(domain[0]), s1 = Math.sqrt(domain[1])
    return (v: number) => g.M.left + ((Math.sqrt(v) - s0) / (s1 - s0)) * g.PW
  }
  const [t0, t1] = domain
  return (v: number) => g.M.left + ((v - t0) / (t1 - t0)) * g.PW
}
function makeYScale(domain: [number, number], g: Geom, type: YAxis['type'] = 'linear') {
  if (type === 'log') {
    const l0 = Math.log10(domain[0]), l1 = Math.log10(domain[1])
    return (v: number) => g.M.top + (1 - (Math.log10(v) - l0) / (l1 - l0)) * g.PH
  }
  const [y0, y1] = domain
  return (v: number) => g.M.top + (1 - (v - y0) / (y1 - y0)) * g.PH
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

// evenly-spaced subset that always keeps the first and last element
function capEvenly<T>(arr: T[], n: number): T[] {
  if (arr.length <= n) return arr
  const out: T[] = []
  for (let i = 0; i < n; i++) out.push(arr[Math.round((i / (n - 1)) * (arr.length - 1))])
  return [...new Set(out)]
}

type LabelItem = { text: string; mx: number; my: number }
type PlacedLabel = LabelItem & { lx: number; ly: number; anchor: 'start' | 'middle' | 'end'; w: number; bx0: number; leader: boolean }

// label declutter: stack colliding labels upward (or below if they hit the top),
// adding thin leader lines back to the marker.
function declutter(items: LabelItem[], g: Geom): PlacedLabel[] {
  const PAD = 3
  const bottomLimit = g.M.top + g.PH - 4
  const placed: { x0: number; x1: number; y0: number; y1: number }[] = []
  const out: PlacedLabel[] = []
  const sorted = [...items].sort((a, b) => a.mx - b.mx)
  for (const it of sorted) {
    const w = it.text.length * g.charW + 4
    let anchor: 'start' | 'middle' | 'end' = 'middle'
    if (it.mx > g.M.left + g.PW - 64) anchor = 'end'
    else if (it.mx < g.M.left + 50) anchor = 'start'
    const x0 = (lx: number) => (anchor === 'middle' ? lx - w / 2 : anchor === 'end' ? lx - w : lx)
    const lx = it.mx
    let ly = it.my - 13
    const hits = (yy: number) => {
      const bx0 = x0(lx), bx1 = bx0 + w, by0 = yy - 11, by1 = yy + 3
      return placed.some((p) => bx0 < p.x1 + PAD && bx1 > p.x0 - PAD && by0 < p.y1 + PAD && by1 > p.y0 - PAD)
    }
    let guard = 0
    while (hits(ly) && ly > g.M.top + 6 && guard < 60) { ly -= 5; guard++ }
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

// evenly thin a tick list down to a maximum count (keeps first + last)
function thinTicks(ticks: number[], max: number): number[] {
  return capEvenly(ticks, max)
}

// ── one chart ───────────────────────────────────────────────────────────────
function FrontierChart({
  icon, title, subtitle, models, authors, x, y, line, accentLabel, gradId, onTip, onHideTip, geom, onExpand,
  envelope = true, labels = true, diagonal = false, groups, refX, refY, quadLabels, quadTint, dotColor, legendItems, pickLabels,
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
  geom: Geom
  onExpand?: () => void
  envelope?: boolean
  labels?: boolean
  diagonal?: boolean
  groups?: Group
  refX?: number // vertical quadrant divider (data units)
  refY?: number // horizontal quadrant divider (data units)
  quadLabels?: [string, string, string, string] // TL, TRb, BL, BR corner captions
  quadTint?: { tl: string; br: string } // faint washes behind the story corners
  dotColor?: (d: ChartModel) => string | undefined // per-dot story color
  legendItems?: { color: string; label: string }[] // legend override
  pickLabels?: (models: ChartModel[]) => ChartModel[] // labels when envelope is off
}) {
  const [hover, setHover] = useState<string | null>(null)
  const g = geom
  const sx = useMemo(() => makeXScale(x.type, x.domain, g), [x, g])
  const sy = useMemo(() => makeYScale(y.domain, g, y.type), [y, g])
  const xVal = x.value, yVal = y.value
  const xTicks = useMemo(() => thinTicks(x.ticks, g.maxXTicks), [x.ticks, g.maxXTicks])
  const yTicks = useMemo(() => thinTicks(y.ticks, g.yTickN), [y.ticks, g.yTickN])

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

  const envSet = useMemo(() => new Set(envByGroup.flatMap((gr) => gr.env.map((d) => d.name))), [envByGroup])
  const byName = useMemo(() => Object.fromEntries(models.map((m) => [m.name, m])), [models])
  const colorOf = (d: ChartModel) => (groups ? groups.colors[groups.of(d)].color : `oklch(0.7 ${authors[d.author].c} ${authors[d.author].hue})`)

  const labelModels = labels
    ? envelope
      ? capEvenly(envByGroup.flatMap((gr) => gr.env), g.labelCap)
      : capEvenly(pickLabels ? pickLabels(models) : [], g.labelCap)
    : []
  const placedLabels = declutter(labelModels.map((d) => ({ text: d.name, mx: sx(xVal(d)), my: sy(yVal(d)) })), g)

  const showTip = (d: ChartModel, cx: number, cy: number) => { setHover(d.name); onTip(d, envSet.has(d.name), cx, cy) }
  const hideTip = () => { setHover(null); onHideTip() }
  // Tap targets: click toggles the tooltip (touch has no hover); clicking the
  // chart background dismisses it. Mouse users keep plain hover.
  const tapTip = (d: ChartModel) => (e: React.MouseEvent) => {
    e.stopPropagation()
    if (hover === d.name) hideTip()
    else showTip(d, e.clientX, e.clientY)
  }

  return (
    <div className="ch-card">
      <div className="ch-head">
        <span className="ic">{icon}</span>
        <div>
          <h2>{title}</h2>
          <p>{subtitle}</p>
        </div>
        <div className="ch-legend">
          {legendItems ? (
            legendItems.map((li) => (
              <span className="ch-leg" key={li.label}><span className="dt" style={{ background: li.color }} />{li.label}</span>
            ))
          ) : groups ? (
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
        {onExpand && (
          <button className="ch-expand" onClick={onExpand} aria-label={`Expand ${title} chart`} title="Expand">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M8.5 2h3.5v3.5M5.5 12H2V8.5M12 2L8 6M2 12l4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
        )}
      </div>

      <svg
        className={'ch-svg' + (g.W < 600 ? ' is-compact' : '')}
        viewBox={`0 0 ${g.W} ${g.H}`}
        role="img"
        aria-label={title}
        onClick={hideTip}
      >
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--ch-line)" stopOpacity="0.22" />
            <stop offset="100%" stopColor="var(--ch-line)" stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {yTicks.map((t) => (
          <g key={'y' + t}>
            <line className="ch-grid" x1={g.M.left} y1={sy(t)} x2={g.M.left + g.PW} y2={sy(t)} />
            <text className="ch-axis-text" x={g.M.left - 12} y={sy(t) + 4} textAnchor="end">{y.format(t)}</text>
          </g>
        ))}
        {xTicks.map((t, i) => (
          <text key={'x' + i} className="ch-axis-text" x={sx(t)} y={g.M.top + g.PH + 22} textAnchor="middle">{x.format(t)}</text>
        ))}
        {x.label && <text className="ch-axis-label" x={g.M.left + g.PW / 2} y={g.H - 4} textAnchor="middle">{x.label}</text>}

        {diagonal && (
          <line className="ch-ref" x1={sx(x.domain[0])} y1={sy(y.domain[0])} x2={sx(x.domain[1])} y2={sy(y.domain[1])} />
        )}
        {/* faint washes behind the two story corners, under everything else */}
        {quadTint && refX != null && refY != null && (
          <>
            <rect x={g.M.left} y={g.M.top} width={sx(refX) - g.M.left} height={sy(refY) - g.M.top}
              fill={quadTint.tl} opacity="0.055" />
            <rect x={sx(refX)} y={sy(refY)} width={g.M.left + g.PW - sx(refX)} height={g.M.top + g.PH - sy(refY)}
              fill={quadTint.br} opacity="0.055" />
          </>
        )}
        {refX != null && (
          <line className="ch-div" x1={sx(refX)} y1={g.M.top} x2={sx(refX)} y2={g.M.top + g.PH} />
        )}
        {refY != null && (
          <line className="ch-div" x1={g.M.left} y1={sy(refY)} x2={g.M.left + g.PW} y2={sy(refY)} />
        )}
        {quadLabels && (
          <>
            <text className="ch-quad" x={g.M.left + 8} y={g.M.top + 14} textAnchor="start">{quadLabels[0]}</text>
            <text className="ch-quad" x={g.M.left + g.PW - 8} y={g.M.top + 14} textAnchor="end">{quadLabels[1]}</text>
            <text className="ch-quad" x={g.M.left + 8} y={g.M.top + g.PH - 8} textAnchor="start">{quadLabels[2]}</text>
            <text className="ch-quad" x={g.M.left + g.PW - 8} y={g.M.top + g.PH - 8} textAnchor="end">{quadLabels[3]}</text>
          </>
        )}

        {/* envelope area only for single-series charts (groups draw lines only) */}
        {!groups && envelope && envByGroup[0]?.env.length > 0 && (() => {
          const pts = envByGroup[0].env.map((d) => [sx(xVal(d)), sy(yVal(d))] as const)
          const baseY = g.M.top + g.PH
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
        {groups && envByGroup.map((gr) => gr.env.length > 0 && (
          <path key={'gl' + gr.key} className="ch-line" style={{ stroke: gr.color }}
            d={envPath(gr.env.map((d) => [sx(xVal(d)), sy(yVal(d))] as const), line)} />
        ))}

        {hover && byName[hover] && (
          <line className="ch-vline" x1={sx(xVal(byName[hover]))} y1={g.M.top} x2={sx(xVal(byName[hover]))} y2={g.M.top + g.PH} />
        )}

        {models.filter((d) => !envSet.has(d.name)).map((d) => {
          const story = dotColor?.(d)
          return (
            <circle key={d.name} className={'ch-dot' + (hover && hover !== d.name ? ' dim' : '')}
              cx={sx(xVal(d))} cy={sy(yVal(d))} r={hover === d.name ? 5 : story ? 3.8 : 3.2}
              style={story ? { fill: story } : hover === d.name || groups ? { fill: colorOf(d) } : undefined} />
          )
        })}
        {envByGroup.flatMap((gr) => gr.env).map((d) => (
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
                onMouseLeave={hideTip}
                onClick={tapTip(d)} />
            </g>
          )
        })}

        {models.map((d) => (
          <circle key={'h' + d.name} className="ch-hot" cx={sx(xVal(d))} cy={sy(yVal(d))} r={g.W < 600 ? 15 : 12}
            onMouseEnter={(e) => showTip(d, e.clientX, e.clientY)}
            onMouseMove={(e) => onTip(d, envSet.has(d.name), e.clientX, e.clientY)}
            onMouseLeave={hideTip}
            onClick={tapTip(d)} />
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
// log-axis ticks; 1 renders as "≤1" (zero-coverage models clamp there)
function coverageTicks(max: number): number[] {
  return [1, 3, 10, 30, 100, 300].filter((t) => t <= max)
}

type TipKind = 'price' | 'date' | 'context' | 'split' | 'hype'
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

// ── list price vs street price (Phase U registry data) ─────────────────────
function DiscountBars({ icon, title, subtitle, items }: {
  icon: ReactNode
  title: string
  subtitle: string
  items: { name: string; color: string; pct: number; list: number; street: number; provider: string }[]
}) {
  const max = Math.max(...items.map((i) => i.pct), 1)
  const usd = (v: number) => (v >= 10 ? `$${v.toFixed(0)}` : `$${v.toFixed(2)}`)
  return (
    <div className="ch-card">
      <div className="ch-head"><span className="ic">{icon}</span><div><h2>{title}</h2><p>{subtitle}</p></div></div>
      <div className="ch-bars">
        {items.map((it) => (
          <div className="ch-disc" key={it.name}>
            <div className="ch-bar-row" title={`List ${usd(it.list)}/M → ${usd(it.street)}/M via ${it.provider}`}>
              <span className="ch-bar-name">{it.name}</span>
              <span className="ch-bar-track"><span className="ch-bar-fill" style={{ width: `${(it.pct / max) * 100}%`, background: it.color }} /></span>
              <span className="ch-bar-val">-{Math.round(it.pct)}%</span>
            </div>
            <div className="ch-disc-sub">{usd(it.list)} list · {usd(it.street)} via {it.provider}</div>
          </div>
        ))}
      </div>
      <p className="ch-footnote">$ per 1M input tokens: the vendor&rsquo;s list price against the cheapest credible provider on OpenRouter (promos, degraded quants, and short-context deployments excluded).</p>
    </div>
  )
}

// ── fullscreen chart overlay ────────────────────────────────────────────────
function ChartOverlay({ title, onClose, children, compactViewport }: {
  title: string
  onClose: () => void
  children: ReactNode
  compactViewport: boolean
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [onClose])
  return (
    <div className="ch-overlay" role="dialog" aria-modal="true" aria-label={title} onClick={onClose}>
      <div className="ch-overlay-panel" onClick={(e) => e.stopPropagation()}>
        <div className="ch-overlay-bar">
          <span className="ch-overlay-title">{title}</span>
          {compactViewport && <span className="ch-overlay-hint">Rotate your phone for the full-width view</span>}
          <button className="ch-overlay-close" onClick={onClose} aria-label="Close chart">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

// ── the charts + shared tooltip ─────────────────────────────────────────────
export function ModelLandscape({ models }: { models: Model[] }) {
  const [tip, setTip] = useState<Tip | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const compact = useCompact()
  const pageGeom = useMemo(() => makeGeom(compact), [compact])
  // The overlay gets desktop geometry whenever the viewport is wide enough
  // (including a rotated phone); a portrait phone keeps compact geometry and
  // shows the rotate hint instead of rendering unreadable desktop text.
  const overlayGeom = pageGeom

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
      coverage: m.coverage_count ?? 0,
      openWeight: m.is_open_weight ?? null,
    })

    const eciBase = models.filter((m) => m.headline_score != null && m.released_at).map(toCM)
    const priceModels = eciBase.filter((m) => Number.isFinite(m.price) && m.price > 0)
    const valueModels = priceModels.map((m) => ({ ...m, value: m.eci / m.price }))
    const contextModels = models.filter((m) => m.context_window != null && m.released_at).map(toCM)
    const openClosed = eciBase.filter((m) => m.openWeight === true || m.openWeight === false)
    // hype map: every model with a capability score (zero coverage is a signal
    // too — that's the "under the radar" quadrant)
    const hypeModels = eciBase

    // ECI Y axis shared by the price + time + split + hype charts
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

    // list vs street: vendor list price against the credible floor (input $/M)
    const discounts = models
      .filter((m) =>
        m.vendor_price_in != null && m.vendor_price_in > 0 &&
        m.price_in != null && m.price_in > 0 && m.price_in < m.vendor_price_in &&
        m.floor_provider != null)
      .map((m) => ({
        name: m.name,
        color: colorFor(authorKey(m.vendor)),
        pct: (1 - (m.price_in as number) / (m.vendor_price_in as number)) * 100,
        list: m.vendor_price_in as number,
        street: m.price_in as number,
        provider: m.floor_provider as string,
      }))
      .filter((d) => d.pct >= 5)
      .sort((a, b) => b.pct - a.pct)
      .slice(0, 10)

    return { authors: authorsMap, eciBase, priceModels, contextModels, openClosed, hypeModels, eciAxis, valueRank, discounts }
  }, [models])

  const { authors, eciBase, priceModels, contextModels, openClosed, hypeModels, eciAxis, valueRank, discounts } = data

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
      rows.push({ k: 'News stories', v: `${d.coverage}` }, { k: 'Capability (ECI)', v: d.eci.toFixed(1) })
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

  // Log coverage axis from 1 (zero-coverage models clamp to 1; "no stories"
  // and "one story" are the same editorial fact). The domain is anchored so
  // the geometric center — which IS the visual center on a log scale — sits
  // at 10 stories: double-digit coverage means the model broke through.
  // Symmetric quadrants AND a threshold that means something. (v1 median
  // split was lopsided; v2 sqrt-center split ran the fence through Fable 5
  // and GPT-5, emptying "hyped and delivering" — both were fence artifacts.)
  const hypeDomain = useMemo<[number, number]>(() => {
    const max = Math.max(...hypeModels.map((m) => m.coverage), 10)
    return [1, Math.max(100, max * 1.15)]
  }, [hypeModels])
  const hypeMids = useMemo(() => ({
    x: Math.sqrt(hypeDomain[0] * hypeDomain[1]), // geometric center of the log axis
    y: (eciAxis.domain[0] + eciAxis.domain[1]) / 2,
  }), [hypeDomain, eciAxis])

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
  const flameIcon = (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 2s3.8 3 3.8 6.6a3.8 3.8 0 0 1-7.6 0C4.2 6.4 6 5 6 5s-.2 1.6.8 2.4C7.4 5.4 8 2 8 2z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" /></svg>
  )
  const tagIcon = (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8.6 2.5H13.5v4.9l-6.1 6.1a1.4 1.4 0 0 1-2 0L2.5 10.6a1.4 1.4 0 0 1 0-2l6.1-6.1z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" /><circle cx="10.8" cy="5.2" r="1" fill="currentColor" /></svg>
  )

  const access: Group = {
    of: (d) => (d.openWeight ? 'open' : 'closed'),
    order: ['closed', 'open'],
    colors: { open: { color: OPEN_COLOR, label: 'Open-weight' }, closed: { color: CLOSED_COLOR, label: 'Proprietary' } },
  }

  // hype-map story colors + labels: emphasize the two interesting corners
  const HYPE_QUIET = 'oklch(0.74 0.13 162)'
  const HYPE_HEAT = 'oklch(0.72 0.14 60)'
  const hypeQuad = (d: ChartModel) =>
    d.coverage < hypeMids.x && d.eci >= hypeMids.y ? 'quiet'
    : d.coverage >= hypeMids.x && d.eci < hypeMids.y ? 'heat'
    : null
  const hypeDotColor = (d: ChartModel) =>
    hypeQuad(d) === 'quiet' ? HYPE_QUIET : hypeQuad(d) === 'heat' ? HYPE_HEAT : undefined
  const pickHypeLabels = (ms: ChartModel[]) => {
    const quiet = ms.filter((m) => hypeQuad(m) === 'quiet').sort((a, b) => b.eci - a.eci).slice(0, 3)
    const heat = ms.filter((m) => hypeQuad(m) === 'heat').sort((a, b) => b.coverage - a.coverage).slice(0, 2)
    const delivering = ms.filter((m) => m.coverage >= hypeMids.x && m.eci >= hypeMids.y)
      .sort((a, b) => b.coverage - a.coverage).slice(0, 2)
    return [...new Map([...quiet, ...heat, ...delivering].map((m) => [m.name, m])).values()]
  }

  // Every SVG chart, defined once so the inline flow and the fullscreen
  // overlay render the same config at different geometries.
  const chartDefs: { id: string; title: string; when: boolean; render: (g: Geom, onExpand?: () => void) => ReactNode }[] = [
    {
      id: 'price', title: 'Price vs intelligence', when: priceModels.length >= 2,
      render: (g, onExpand) => (
        <FrontierChart
          icon={dotIcon}
          title="Price vs intelligence"
          subtitle="Blended API price (log scale) against the capability index. The line traces the value frontier — the cheapest model at each capability level."
          models={priceModels} authors={authors} geom={g} onExpand={onExpand}
          x={{ type: 'log', value: (d) => d.price, domain: priceDomain, ticks: priceTicks(priceDomain), format: fmtPrice, label: 'Blended price ($ / 1M tokens)' }}
          y={eciAxis} line="linear" accentLabel="Value frontier" gradId={`chGradPrice${onExpand ? '' : 'X'}`}
          onTip={(d, e, cx, cy) => showTip(d, e, cx, cy, 'price')} onHideTip={hideTip}
        />
      ),
    },
    {
      id: 'hype', title: 'Coverage vs capability', when: hypeModels.length >= 4,
      render: (g, onExpand) => (
        <FrontierChart
          icon={flameIcon}
          title="Coverage vs capability"
          subtitle="Attention is not ability. Green models score higher than their news coverage suggests; amber models draw headlines their benchmark scores don't back up."
          models={hypeModels} authors={authors} geom={g} onExpand={onExpand}
          envelope={false} labels pickLabels={pickHypeLabels}
          refX={hypeMids.x} refY={hypeMids.y}
          quadTint={{ tl: HYPE_QUIET, br: HYPE_HEAT }}
          dotColor={hypeDotColor}
          legendItems={[{ color: HYPE_QUIET, label: 'Quietly strong' }, { color: HYPE_HEAT, label: 'More heat than light' }]}
          quadLabels={['quietly strong', 'hyped and delivering', 'under the radar', 'more heat than light']}
          x={{ type: 'log', value: (d) => Math.max(1, d.coverage), domain: hypeDomain, ticks: coverageTicks(hypeDomain[1]), format: (v) => (v === 1 ? '≤1' : v), label: 'News stories covering the model' }}
          y={eciAxis} line="linear" accentLabel="" gradId={`chGradHype${onExpand ? '' : 'X'}`}
          onTip={(d, e, cx, cy) => showTip(d, e, cx, cy, 'hype')} onHideTip={hideTip}
        />
      ),
    },
    {
      id: 'time', title: 'How the frontier moved', when: eciBase.length >= 2,
      render: (g, onExpand) => (
        <FrontierChart
          icon={stepIcon}
          title="How the frontier moved"
          subtitle="Every model from the past year plotted by release date and intelligence. The line is the record envelope — each step up set a new high-water mark."
          models={eciBase} authors={authors} geom={g} onExpand={onExpand}
          x={{ type: 'time', value: (d) => d.releaseMs, domain: timeDomain, ticks: monthTicks(timeDomain[0], timeDomain[1]), format: fmtMonthYear, label: 'Release date' }}
          y={eciAxis} line="step" accentLabel="Record envelope" gradId={`chGradTime${onExpand ? '' : 'X'}`}
          onTip={(d, e, cx, cy) => showTip(d, e, cx, cy, 'date')} onHideTip={hideTip}
        />
      ),
    },
    {
      id: 'ctx', title: 'Context windows over time', when: contextModels.length >= 2,
      render: (g, onExpand) => (
        <FrontierChart
          icon={ctxIcon}
          title="Context windows over time"
          subtitle="The maximum context length on offer (log scale), by release date. The line is the record — the context race ran from a few thousand tokens to over a million."
          models={contextModels} authors={authors} geom={g} onExpand={onExpand}
          x={{ type: 'time', value: (d) => d.releaseMs, domain: ctxTimeDomain, ticks: monthTicks(ctxTimeDomain[0], ctxTimeDomain[1]), format: fmtMonthYear, label: 'Release date' }}
          y={{ type: 'log', value: (d) => d.context, domain: ctxDomain, ticks: pow10Ticks(ctxDomain[0], ctxDomain[1]), format: fmtTokens }}
          line="step" accentLabel="Record" gradId={`chGradCtx${onExpand ? '' : 'X'}`}
          onTip={(d, e, cx, cy) => showTip(d, e, cx, cy, 'context')} onHideTip={hideTip}
        />
      ),
    },
    {
      id: 'split', title: 'Open-weight vs proprietary', when: openClosed.length >= 4,
      render: (g, onExpand) => (
        <FrontierChart
          icon={splitIcon}
          title="Open-weight vs proprietary"
          subtitle="The intelligence frontier over time, split by access. Two record envelopes show how far open-weight releases trail (or keep pace with) closed models."
          models={openClosed} authors={authors} groups={access} geom={g} onExpand={onExpand}
          x={{ type: 'time', value: (d) => d.releaseMs, domain: timeDomain, ticks: monthTicks(timeDomain[0], timeDomain[1]), format: fmtMonthYear, label: 'Release date' }}
          y={eciAxis} line="step" accentLabel="Frontier" gradId={`chGradSplit${onExpand ? '' : 'X'}`}
          onTip={(d, e, cx, cy) => showTip(d, e, cx, cy, 'split')} onHideTip={hideTip}
        />
      ),
    },
  ]

  const expandedDef = chartDefs.find((c) => c.id === expanded)

  return (
    <div className="ch-embed">
      {chartDefs.map((c) => c.when && (
        <div key={c.id}>{c.render(pageGeom, () => setExpanded(c.id))}</div>
      ))}

      {discounts.length >= 3 && (
        <DiscountBars
          icon={tagIcon}
          title="List price vs street price"
          subtitle="The biggest gaps between what the vendor charges and what the cheapest credible provider charges for the same open-weights model."
          items={discounts}
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

      <p className="ch-footnote">
        Benchmarks &amp; model data from Epoch AI (CC BY); pricing blended across providers via OpenRouter; coverage counts are the news stories linked to each model on Model Beat. ECI = Epoch Capabilities Index.
      </p>

      {expandedDef && (
        <ChartOverlay title={expandedDef.title} onClose={() => setExpanded(null)} compactViewport={compact}>
          {expandedDef.render(overlayGeom)}
        </ChartOverlay>
      )}

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
