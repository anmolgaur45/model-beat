'use client'

// Aurora "Telemetry" model page (design handoff). Renders entirely from a
// MODEL-shaped `view` object — no hard-coded model text. Ported from
// design_handoff_model_page/model-page2.jsx to our stack (useTheme for the
// data-theme/localStorage continuity the rest of the app uses).
import { useState } from 'react'
import Link from 'next/link'
import { useTheme } from '@/hooks/useTheme'
import { BrandLockup } from '@/components/BrandLockup'

// ── data contract (filled from real model data by the server page) ──────────
export interface IndexGauge {
  value: number // 0–100, fills the ring
  label: string
  percentile: number // 0–100; chip shows "Top {100 - percentile}%"
}
export interface BenchRowView {
  name: string
  blurb: string // short one-liner on the card
  pct: number // 0–100, drives the segmented meter + tier color
  scoreLabel: string // native score string shown on the card (e.g. "73.4%", "2.5 h")
  desc: string
  evaluator?: string
  domain?: string
  url?: string
}
export interface BenchGroupView {
  name: string
  rows: BenchRowView[]
}
export interface ModelView {
  org: string
  name: string
  monogram: string
  slugDisplay: string // org/name id shown + copied
  modelSlug: string // our routing slug, for the compare link
  description: string
  modalities: { in: string[]; out: string[] }
  priceIn: string
  priceOut: string
  context: string
  released: string
  providers: string[]
  indices: IndexGauge[]
  groups: BenchGroupView[]
  sourceUrl: string
  sourceLabel: string
  news: { headline: string; url: string | null; source: string; date: string }[]
}

function modelTier(pct: number): 'high' | 'mid' | 'low' {
  if (pct >= 70) return 'high'
  if (pct >= 50) return 'mid'
  return 'low'
}

// 89 → "89th", 91 → "91st" — for the percentile chip.
function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`
}

// ── pure sub-components (module-level so they aren't re-created per render) ──
function ArcGauge({ value }: { value: number }) {
  const size = 116, r = 48, sw = 8
  const c = 2 * Math.PI * r
  const f = Math.max(0, Math.min(1, value / 100))
  return (
    <div className="dial">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--seg-off)" strokeWidth={sw} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--accent)" strokeWidth={sw}
          strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - f)}
          style={{ filter: 'drop-shadow(0 0 5px oklch(0.78 0.19 var(--hue) / 0.5))' }} />
      </svg>
      <span className="gv">{value.toFixed(1)}</span>
    </div>
  )
}

function SegMeter({ pct }: { pct: number }) {
  const f = pct / 10
  return (
    <div className={'m2-seg ' + modelTier(pct)}>
      {Array.from({ length: 10 }).map((_, i) => {
        const frac = Math.max(0, Math.min(1, f - i))
        return <span className="s" key={i}><i style={{ width: frac * 100 + '%' }} /></span>
      })}
    </div>
  )
}

function BenchCard({ row, onShow, onHide }: {
  row: BenchRowView
  onShow: (row: BenchRowView, el: HTMLElement) => void
  onHide: () => void
}) {
  const tier = modelTier(row.pct)
  return (
    <div className="m2-card">
      <div className="m2-card-top">
        <span className="nm">{row.name}</span>
        <span className="m2-info"
          onMouseEnter={(e) => onShow(row, e.currentTarget)}
          onMouseLeave={onHide}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6.3" stroke="currentColor" strokeWidth="1.3" /><path d="M8 7.2v3.4M8 5.2v.2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
        </span>
        <span className={'score ' + tier}>{row.scoreLabel}</span>
      </div>
      <p className="m2-blurb">{row.blurb}</p>
      <SegMeter pct={row.pct} />
    </div>
  )
}

export function ModelTelemetry({ view: M }: { view: ModelView }) {
  const { theme, toggle } = useTheme()
  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied] = useState(false)
  const [provider, setProvider] = useState(M.providers[0] ?? 'Epoch AI')
  const [tip, setTip] = useState<{ row: BenchRowView; left: number; top: number } | null>(null)

  const copySlug = () => {
    navigator.clipboard?.writeText(M.slugDisplay).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 1400)
  }

  const showTip = (row: BenchRowView, el: HTMLElement) => {
    const r = el.getBoundingClientRect()
    const left = Math.max(16, Math.min(r.left + r.width / 2 - 150, window.innerWidth - 316))
    setTip({ row, left, top: r.bottom + 10 })
  }
  const hideTip = () => setTip(null)

  // Only offer Show more when the text is long enough to actually clamp (~2 lines).
  const longDesc = M.description.length > 150

  const slugParts = M.slugDisplay.split('/')
  const orgPart = slugParts.length > 1 ? slugParts[0] : ''
  const namePart = slugParts.length > 1 ? slugParts.slice(1).join('/') : M.slugDisplay

  return (
    <div className="aurora-stage">
      <div className="aurora-layer" aria-hidden="true">
        <div className="aurora-blob aurora-blob-1" />
        <div className="aurora-blob aurora-blob-2" />
        <div className="aurora-blob aurora-blob-3" />
      </div>

      <header className="m2-header">
        <Link className="anc-brand m2-brand" href="/" aria-label="Model Beat — Covering the AI beat, every day.">
          <BrandLockup sm />
        </Link>
        <div className="m2-crumb">
          <Link href="/models">Models</Link><span className="sep">/</span>
          <span className="cur">{M.name}</span>
        </div>
        <div className="m2-spacer" />
        <button className="m2-iconbtn" onClick={toggle} title="Toggle theme" aria-label="Toggle theme">
          {theme === 'dark' ? (
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="3.2" stroke="currentColor" strokeWidth="1.4" /><path d="M8 1.5v1.8M8 12.7v1.8M1.5 8h1.8M12.7 8h1.8M3.4 3.4l1.3 1.3M11.3 11.3l1.3 1.3M12.6 3.4l-1.3 1.3M4.7 11.3l-1.3 1.3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
          ) : (
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M13.5 9.5A5.5 5.5 0 1 1 6.5 2.5a4.5 4.5 0 0 0 7 7z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" /></svg>
          )}
        </button>
        <Link className="m2-cta" href="/models">All models</Link>
      </header>

      <div className="m2-wrap">
        <section className="m2-hero">
          <div className="m2-avatar lg">{M.monogram}</div>
          <div className="m2-hero-body">
            <div className="m2-titlerow">
              <h1 className="m2-name">{M.org ? `${M.org}: ${M.name}` : M.name}</h1>
              <div className="m2-actions">
                <Link className="m2-btn primary" href={`/models/compare?ids=${M.modelSlug}`}>
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="2" y="2.5" width="12" height="11" rx="2" stroke="currentColor" strokeWidth="1.4" /><path d="M8 2.5v11" stroke="currentColor" strokeWidth="1.4" /></svg>
                  Compare
                </Link>
                <a className="m2-btn" href={M.sourceUrl} target="_blank" rel="noopener noreferrer">
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M6 3.5H4A1.5 1.5 0 0 0 2.5 5v7A1.5 1.5 0 0 0 4 13.5h7A1.5 1.5 0 0 0 12.5 12v-2M9 2.5h4v4M13 2.5L7 8.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  {M.sourceLabel}
                </a>
              </div>
            </div>
            <div className="m2-slug">
              <code>{orgPart && <span className="org">{orgPart}</span>}{orgPart ? '/' : ''}{namePart}</code>
              <button className={'m2-copy' + (copied ? ' copied' : '')} onClick={copySlug} title="Copy model ID" aria-label="Copy model ID">
                {copied ? (
                  <svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M2.5 7.5l3 3 6-7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
                ) : (
                  <svg width="12" height="12" viewBox="0 0 14 14" fill="none"><rect x="3" y="3" width="8" height="8" rx="2" stroke="currentColor" strokeWidth="1.3" /><path d="M5.5 3V2.2A1.2 1.2 0 0 1 6.7 1h4.1A1.2 1.2 0 0 1 12 2.2v4.1a1.2 1.2 0 0 1-1.2 1.2H10" stroke="currentColor" strokeWidth="1.3" /></svg>
                )}
              </button>
            </div>
            <p className={'m2-desc' + (longDesc && !expanded ? ' clamped' : '')}>{M.description}</p>
            {longDesc && (
              <button className={'m2-showmore' + (expanded ? ' open' : '')} onClick={() => setExpanded(!expanded)}>
                {expanded ? 'Show less' : 'Show more'}
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2.5 4.5L6 8l3.5-3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </button>
            )}
          </div>
        </section>

        <div className="m2-ribbon">
          <div className="m2-spec"><div className="k">Context</div><div className="v">{M.context}</div></div>
          <div className="m2-spec"><div className="k">Input</div><div className="v">{M.priceIn} <span className="per">/ 1M</span></div></div>
          <div className="m2-spec"><div className="k">Output</div><div className="v">{M.priceOut} <span className="per">/ 1M</span></div></div>
          <div className="m2-spec"><div className="k">Released</div><div className="v">{M.released}</div></div>
          <div className="m2-spec">
            <div className="k">Modalities</div>
            <div className="m2-mods2">
              {M.modalities.in.map((m) => <span className="mtag" key={m}>{m}</span>)}
              {M.modalities.out.length > 0 && <span className="marrow">→</span>}
              {M.modalities.out.map((m) => <span className="mtag out" key={'o' + m}>{m}</span>)}
            </div>
          </div>
        </div>

        <section className="m2-section">
          <div className="m2-sec-head">
            <span className="ic">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2.5 13.5h11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /><rect x="3" y="8" width="2.4" height="4" rx="0.8" fill="currentColor" /><rect x="6.8" y="5" width="2.4" height="7" rx="0.8" fill="currentColor" /><rect x="10.6" y="2.5" width="2.4" height="9.5" rx="0.8" fill="currentColor" /></svg>
            </span>
            <h2>Benchmarks</h2>
            {M.providers.length > 0 && (
              <div className="toggle">
                {M.providers.map((p) => (
                  <button key={p} className={p === provider ? 'active' : ''} onClick={() => setProvider(p)}>
                    <span className="dot" />{p}
                  </button>
                ))}
              </div>
            )}
          </div>
          <p className="m2-sec-sub">
            Scores on standardized evaluations. Higher is better — and rank shows where {M.name} lands
            among all models tracked on Model Beat.
          </p>

          {M.indices.length === 0 && M.groups.length === 0 ? (
            <p className="anc-bench-empty" style={{ marginTop: 20 }}>
              No standardized benchmark scores from Epoch AI yet — common for very recent, image, or
              niche models. Scores appear here once published.
            </p>
          ) : (
            <>
              {M.indices.length > 0 && (
                <div className="m2-gauges">
                  {M.indices.map((idx) => (
                    <div className="m2-gauge" key={idx.label}>
                      <ArcGauge value={idx.value} />
                      <div className="lbl">{idx.label}</div>
                      <div className="prov">{provider}</div>
                      <span className="m2-rankchip">
                        <svg width="13" height="13" viewBox="0 0 14 14" fill="none"><path d="M7 1.5l1.6 3.4 3.7.5-2.7 2.6.7 3.7L7 9.9 3.7 12.2l.7-3.7L1.7 5.9l3.7-.5z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" /></svg>
                        <span className="rk">{ordinal(idx.percentile)}</span> percentile of tracked models
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {M.groups.map((g) => (
                <div className="m2-group" key={g.name}>
                  <div className="m2-group-head">
                    <h3>{g.name}</h3>
                    <span className="count">{g.rows.length} evals</span>
                    <span className="rule" />
                  </div>
                  <div className="m2-grid">
                    {g.rows.map((row) => (
                      <BenchCard key={row.name} row={row} onShow={showTip} onHide={hideTip} />
                    ))}
                  </div>
                </div>
              ))}
            </>
          )}
        </section>

        {M.news.length > 0 && (
          <section className="m2-section">
            <div className="m2-group-head">
              <h3>In the news</h3>
              <span className="count">{M.news.length}</span>
              <span className="rule" />
            </div>
            <ul className="anc-model-news">
              {M.news.map((n, i) => (
                <li key={i}>
                  {n.url ? (
                    <a href={n.url} target="_blank" rel="noopener noreferrer">{n.headline}</a>
                  ) : (
                    <span>{n.headline}</span>
                  )}
                  <span className="anc-model-news-src">{n.source} · {n.date}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <p className="anc-epoch-credit">
          Model &amp; benchmark data from{' '}
          <a href="https://epoch.ai/data/ai-models" target="_blank" rel="noopener noreferrer">Epoch AI</a>{' '}
          (CC BY); pricing, specs &amp; descriptions from{' '}
          <a href="https://openrouter.ai/models" target="_blank" rel="noopener noreferrer">OpenRouter</a>.
        </p>
      </div>

      {tip && (
        <div className="m2-tip" style={{ left: tip.left, top: tip.top }}>
          <h4>{tip.row.name}</h4>
          <p>{tip.row.desc}</p>
          {(tip.row.evaluator || tip.row.domain) && (
            <div className="meta">
              {tip.row.evaluator && <div><div className="k">Evaluator</div><div className="vv">{tip.row.evaluator}</div></div>}
              {tip.row.domain && <div><div className="k">Domain</div><div className="vv">{tip.row.domain}</div></div>}
            </div>
          )}
          {tip.row.url && <span className="doc">Official documentation →</span>}
        </div>
      )}
    </div>
  )
}
