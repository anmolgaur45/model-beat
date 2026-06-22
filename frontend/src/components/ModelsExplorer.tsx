'use client'

import { useEffect, useState } from 'react'
import type { Model } from '@/types/article'
import type { TabKey } from '@/lib/modelBuckets'
import { bestView, rankModels, buildFaq } from '@/lib/bestModels'
import { ModelsLeaderboard } from './ModelsLeaderboard'
import { ModelLandscape } from './ModelLandscape'

const DEFAULT_HEAD = {
  kicker: 'Model tracker',
  heading: 'Every AI model from the past year',
  intro:
    'The latest releases first — then rank by overall intelligence or by use case (coding, math, reasoning, agentic), with API pricing, context window, and the news coverage of each release.',
}

// Top-level client wrapper for /models and the /models/best/[view] ranking
// pages. Owns the active use-case tab (so the H1 + intro reflect it and the URL
// stays a real, shareable address) plus the shared "my models" selection.
export function ModelsExplorer({
  models,
  initialTab = 'newest',
}: {
  models: Model[]
  initialTab?: TabKey
}) {
  const [view, setView] = useState<'table' | 'charts'>('table')
  const [tab, setTab] = useState<TabKey>(initialTab)
  const [selected, setSelected] = useState<string[]>([])

  // Keep the URL in sync with the tab, in place (no reload, filters preserved),
  // so each ranking view is a real address Google can index.
  useEffect(() => {
    const path = tab === 'newest' ? '/models' : `/models/best/${tab}`
    if (window.location.pathname !== path) {
      window.history.replaceState(window.history.state, '', path)
    }
  }, [tab])

  const seo = tab === 'newest' ? null : bestView(tab)
  const head = seo
    ? { kicker: 'Rankings', heading: seo.heading, intro: seo.methodology }
    : DEFAULT_HEAD

  const faq = seo ? buildFaq(seo, rankModels(models, seo.key)) : []

  return (
    <div>
      <header className="anc-models-head">
        <div className="anc-models-headtext">
          <div className="anc-kicker">{head.kicker}</div>
          <h1>{head.heading}</h1>
          <p>{head.intro}</p>
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
        <>
          <ModelsLeaderboard models={models} tab={tab} onSelectTab={setTab} selected={selected} setSelected={setSelected} />
          {faq.length > 0 && (
            <section className="m2-section m2-faq">
              <div className="m2-group-head">
                <h2>Frequently asked questions</h2>
                <span className="rule" />
              </div>
              <div className="m2-faqlist">
                {faq.map((f, i) => (
                  <details className="m2-faqitem" key={i}>
                    <summary>{f.q}</summary>
                    <p>{f.a}</p>
                  </details>
                ))}
              </div>
            </section>
          )}
        </>
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
