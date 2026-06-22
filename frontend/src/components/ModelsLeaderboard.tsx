'use client'

import { useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import Link from 'next/link'
import type { Model } from '@/types/article'
import { TABS, MAX_COMPARE, type TabKey } from '@/lib/modelBuckets'

function fmtReleased(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  })
}
function fmtCtxShort(n: number | null): string {
  if (!n) return '—'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`
  return `${n}`
}
function fmtPrice(m: Model): string {
  if (m.price_in == null || m.price_out == null) return '—'
  return `$${m.price_in.toFixed(2)} / $${m.price_out.toFixed(2)}`
}
// Intelligence per dollar: ECI ÷ blended ($/M) token price.
function valueIndex(m: Model): number | null {
  if (m.headline_score == null || m.price_in == null || m.price_out == null) return null
  const blended = (m.price_in + m.price_out) / 2
  return blended > 0 ? m.headline_score / blended : null
}
function activeScore(m: Model, tab: TabKey): number | null {
  if (tab === 'overall' || tab === 'newest') return m.headline_score ?? null
  if (tab === 'value') return valueIndex(m)
  return m.buckets?.[tab] ?? null
}
// Plain number (no percentile bar) for ECI/value tabs.
function isPlainScore(tab: TabKey): boolean {
  return tab === 'newest' || tab === 'overall' || tab === 'value'
}

type SortKey = 'name' | 'released' | 'vendor' | 'context' | 'price' | 'score'
type AccessFilter = 'all' | 'open' | 'closed'

export function ModelsLeaderboard({
  models,
  tab,
  onSelectTab,
  selected,
  setSelected,
}: {
  models: Model[]
  tab: TabKey
  onSelectTab: (t: TabKey) => void
  selected: string[]
  setSelected: Dispatch<SetStateAction<string[]>>
}) {
  const [sortKey, setSortKey] = useState<SortKey>(tab === 'newest' ? 'released' : 'score')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [search, setSearch] = useState('')
  const [access, setAccess] = useState<AccessFilter>('all')
  const [multimodalOnly, setMultimodalOnly] = useState(false)
  // Compare mode is off by default — the checkboxes only appear once the user
  // opts in via the Compare button, keeping the default table clean.
  const [compareMode, setCompareMode] = useState(false)

  function toggleCompareMode() {
    if (compareMode) setSelected([]) // leaving compare mode clears the selection
    setCompareMode((on) => !on)
  }

  function toggleSelect(slug: string) {
    setSelected((prev) =>
      prev.includes(slug)
        ? prev.filter((s) => s !== slug)
        : prev.length >= MAX_COMPARE ? prev : [...prev, slug],
    )
  }

  function selectTab(t: TabKey) {
    onSelectTab(t)
    setSortKey(t === 'newest' ? 'released' : 'score')
    setSortDir('desc')
  }
  function sortBy(key: SortKey) {
    if (key === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else {
      setSortKey(key)
      setSortDir(key === 'name' || key === 'vendor' ? 'asc' : 'desc')
    }
  }

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    const nullEdge = (v: number | null) =>
      v == null ? (sortDir === 'asc' ? Infinity : -Infinity) : v
    const dir = sortDir === 'asc' ? 1 : -1
    return models
      .filter((m) => {
        if (q && !`${m.name} ${m.vendor ?? ''}`.toLowerCase().includes(q)) return false
        if (access === 'open' && m.is_open_weight !== true) return false
        if (access === 'closed' && m.is_open_weight !== false) return false
        if (multimodalOnly && !(m.input_modalities ?? '').includes('image')) return false
        return true
      })
      .sort((a, b) => {
        switch (sortKey) {
          case 'name': return a.name.localeCompare(b.name) * dir
          case 'released': {
            const ta = a.released_at ? new Date(a.released_at).getTime() : 0
            const tb = b.released_at ? new Date(b.released_at).getTime() : 0
            return (ta - tb) * dir
          }
          case 'vendor': return (a.vendor ?? '').localeCompare(b.vendor ?? '') * dir
          case 'context': return (nullEdge(a.context_window) - nullEdge(b.context_window)) * dir
          case 'price': return (nullEdge(a.price_in) - nullEdge(b.price_in)) * dir
          default: return (nullEdge(activeScore(a, tab)) - nullEdge(activeScore(b, tab))) * dir
        }
      })
  }, [models, search, access, multimodalOnly, sortKey, sortDir, tab])

  // The score column shows ECI for Newest/Overall, the value index for Value,
  // and the bucket percentile composite otherwise.
  const scoreColLabel = tab === 'newest' || tab === 'overall' ? 'ECI' : TABS.find((t) => t.key === tab)!.label
  const arrow = (key: SortKey) => (sortKey === key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '')

  return (
    <div>
      <div className="anc-lbtabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            className={`anc-lbtab ${tab === t.key ? 'is-active' : ''}`}
            onClick={() => selectTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <p className="anc-lbnote">
        {tab === 'newest'
          ? 'The latest model releases, newest first. Switch tabs to rank by capability.'
          : tab === 'overall'
            ? 'Ranked by the Epoch Capabilities Index (ECI) — Epoch AI’s composite intelligence score.'
            : tab === 'value'
              ? 'Ranked by intelligence per dollar — ECI ÷ blended token price ($/M). Higher means more capability per dollar.'
              : `${scoreColLabel} score is a 0–100 percentile composite across that area’s benchmarks. Open a model for the raw scores.`}
      </p>

      <div className="anc-lbfilters">
        <input
          className="anc-lbsearch"
          placeholder="Search models…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="anc-lbseg">
          {(['all', 'open', 'closed'] as AccessFilter[]).map((a) => (
            <button key={a} className={access === a ? 'is-active' : ''} onClick={() => setAccess(a)}>
              {a === 'all' ? 'All' : a === 'open' ? 'Open' : 'Proprietary'}
            </button>
          ))}
        </div>
        <label className="anc-lbcheck">
          <input
            type="checkbox"
            checked={multimodalOnly}
            onChange={(e) => setMultimodalOnly(e.target.checked)}
          />
          Multimodal
        </label>
        <span className="anc-lbcount">{rows.length} models</span>
        <button
          className={`anc-comparebtn ${compareMode ? 'is-active' : ''}`}
          onClick={toggleCompareMode}
          aria-pressed={compareMode}
        >
          {compareMode ? (
            'Cancel'
          ) : (
            <>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <rect x="2" y="2.5" width="5" height="11" rx="1" stroke="currentColor" strokeWidth="1.3" />
                <rect x="9" y="2.5" width="5" height="11" rx="1" stroke="currentColor" strokeWidth="1.3" />
              </svg>
              Compare
            </>
          )}
        </button>
      </div>

      <div className={`anc-mtable anc-lbtable ${compareMode ? 'is-compare' : ''}`}>
        <div className="anc-mrow anc-mhead">
          {compareMode && <span className="anc-lbcb anc-lbcb-h" aria-hidden="true" />}
          <button className="anc-th" onClick={() => sortBy('name')}>Model{arrow('name')}</button>
          <button className="anc-th" onClick={() => sortBy('vendor')}>Vendor{arrow('vendor')}</button>
          <button className="anc-th anc-th-num" onClick={() => sortBy('context')}>Context{arrow('context')}</button>
          <button className="anc-th anc-th-num" onClick={() => sortBy('price')}>$/M in · out{arrow('price')}</button>
          <button className="anc-th anc-th-num" onClick={() => sortBy('score')}>{scoreColLabel}{arrow('score')}</button>
        </div>

        {rows.length === 0 ? (
          <div className="anc-models-empty">No models match these filters.</div>
        ) : (
          rows.map((m) => {
            const sc = activeScore(m, tab)
            return (
              <div className="anc-mrow anc-lbrow" key={m.id}>
                {compareMode && (
                  <label className="anc-lbcb" title="Select to compare">
                    <input
                      type="checkbox"
                      checked={selected.includes(m.slug)}
                      disabled={!selected.includes(m.slug) && selected.length >= MAX_COMPARE}
                      onChange={() => toggleSelect(m.slug)}
                    />
                  </label>
                )}
                <span className="anc-mtitle">
                  <Link href={`/models/${m.slug}`}>{m.name}</Link>
                  <span className="anc-mmeta">
                    {fmtReleased(m.released_at)}
                    {m.coverage_count ? ` · ${m.coverage_count} in the news` : ''}
                  </span>
                </span>
                <span className="anc-mvendor">{m.vendor ?? '—'}</span>
                <span className="anc-mctx">{fmtCtxShort(m.context_window)}</span>
                <span className="anc-mprice" data-label="$/M">{fmtPrice(m)}</span>
                <span className="anc-mscore2" data-label={scoreColLabel}>
                  {sc == null ? (
                    '—'
                  ) : isPlainScore(tab) ? (
                    tab === 'value' ? sc.toFixed(1) : Math.round(sc)
                  ) : (
                    <span className="anc-scorewrap">
                      <span className="anc-scorebar"><span style={{ width: `${sc}%` }} /></span>
                      {sc}
                    </span>
                  )}
                </span>
              </div>
            )
          })
        )}
      </div>

      {(compareMode || selected.length > 0) && (
        <div className="anc-cmpbar" role="region" aria-label="Compare models">
          <span className="anc-cmpbar-count">
            {selected.length === 0
              ? 'Tick models to compare'
              : `${selected.length} selected${selected.length < 2 ? ' · pick at least 2' : ''}`}
            <span className="anc-cmpbar-max"> (up to {MAX_COMPARE})</span>
          </span>
          {selected.length > 0 && (
            <button className="anc-cmpbar-clear" onClick={() => setSelected([])}>
              Clear
            </button>
          )}
          {selected.length >= 2 ? (
            <Link className="anc-cmpbar-go" href={`/models/compare?ids=${selected.join(',')}`}>
              Compare →
            </Link>
          ) : (
            <span className="anc-cmpbar-go is-disabled" aria-disabled="true">
              Compare →
            </span>
          )}
        </div>
      )}
    </div>
  )
}
