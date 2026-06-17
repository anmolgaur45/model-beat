'use client'

// Inline model picker for the compare page — add/remove models (up to 4) via
// search + chips. Each change navigates to /models/compare?ids=… so the server
// re-renders the table. Lets the per-model "Compare" button land here pre-seeded
// with one model and immediately add others.
import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'

type Lite = { slug: string; name: string; vendor: string | null }
const MAX = 4

export function CompareControls({ all, selected }: { all: Lite[]; selected: string[] }) {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const bySlug = useMemo(() => new Map(all.map((m) => [m.slug, m])), [all])
  const atMax = selected.length >= MAX

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return all
      .filter((m) => !selected.includes(m.slug) && `${m.name} ${m.vendor ?? ''}`.toLowerCase().includes(q))
      .slice(0, 8)
  }, [query, all, selected])

  const navTo = (ids: string[]) =>
    router.push(ids.length ? `/models/compare?ids=${ids.join(',')}` : '/models/compare')

  const add = (slug: string) => {
    if (selected.includes(slug) || selected.length >= MAX) return
    setQuery('')
    navTo([...selected, slug])
  }
  const remove = (slug: string) => navTo(selected.filter((s) => s !== slug))

  return (
    <div className="anc-cmpctl">
      <div className="anc-cmptags">
        {selected.map((slug) => (
          <span key={slug} className="anc-chip">
            {bySlug.get(slug)?.name ?? slug}
            <button aria-label={`Remove ${bySlug.get(slug)?.name ?? slug}`} onClick={() => remove(slug)}>×</button>
          </span>
        ))}
        {atMax ? (
          <span className="anc-cmptags-full">Up to {MAX} models</span>
        ) : (
          <input
            className="anc-cmptags-input"
            placeholder={selected.length ? 'Add a model…' : 'Search models to compare…'}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        )}
      </div>
      {matches.length > 0 && (
        <div className="anc-chartpick-menu anc-cmptags-menu">
          {matches.map((m) => (
            <button key={m.slug} onClick={() => add(m.slug)}>
              <span>{m.name}</span>
              <span className="anc-chartpick-vendor">{m.vendor ?? ''}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
