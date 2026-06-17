'use client'

import { useState } from 'react'
import type { Model } from '@/types/article'
import { ModelsLeaderboard } from './ModelsLeaderboard'
import { ModelLandscape } from './ModelLandscape'

// Top-level client wrapper for /models. Owns the section header (so the Table ⇄
// Charts switch can sit top-right of the H1) plus the shared "my models"
// selection that drives both the compare bar (table) and the chart spotlight.
export function ModelsExplorer({ models }: { models: Model[] }) {
  const [view, setView] = useState<'table' | 'charts'>('table')
  const [selected, setSelected] = useState<string[]>([])

  return (
    <div>
      <header className="anc-models-head">
        <div className="anc-models-headtext">
          <div className="anc-kicker">Model tracker</div>
          <h1>Every AI model from the past year</h1>
          <p>
            The latest releases first — then rank by overall intelligence or by use case
            (coding, math, reasoning, agentic), with API pricing, context window, and the
            news coverage of each release.
          </p>
        </div>

        {models.length > 0 && (
          <div className="anc-viewtoggle" role="tablist" aria-label="View">
            <button
              role="tab"
              aria-selected={view === 'table'}
              className={view === 'table' ? 'is-active' : ''}
              onClick={() => setView('table')}
            >
              <TableIcon /> Table
            </button>
            <button
              role="tab"
              aria-selected={view === 'charts'}
              className={view === 'charts' ? 'is-active' : ''}
              onClick={() => setView('charts')}
            >
              <ChartIcon /> Charts
            </button>
          </div>
        )}
      </header>

      {models.length === 0 ? (
        <div className="anc-models-empty">No models in the registry yet.</div>
      ) : view === 'table' ? (
        <ModelsLeaderboard models={models} selected={selected} setSelected={setSelected} />
      ) : (
        <ModelLandscape models={models} />
      )}
    </div>
  )
}

function TableIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <rect x="1.5" y="2" width="11" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
      <path d="M1.5 5.5h11M5.5 5.5V12" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  )
}
function ChartIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M2 12V2M2 12h10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <path d="M4.5 9.5l2.5-3 2 1.5 2.5-4" stroke="currentColor" strokeWidth="1.3"
        strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
