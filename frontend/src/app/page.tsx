'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { trpc } from '@/lib/trpc'
import type { Category, Cluster, Article } from '@/types/article'
import type { CategoryOption } from '@/components/CategoryFilter'
import { CategoryFilter } from '@/components/CategoryFilter'
import { DateSection, SkeletonSection } from '@/components/DateSection'
import { DateNav } from '@/components/DateNav'
import { StoryCard } from '@/components/StoryCard'
import { Recap } from '@/components/Recap'
import { NavBar } from '@/components/NavBar'
import { Ticker } from '@/components/Ticker'
import { useTheme } from '@/hooks/useTheme'
import { CATEGORY_LABELS } from '@/components/categoryMeta'

function localISO(date: Date = new Date()): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function todayISO(): string {
  return localISO()
}

function getDateMeta(iso: string): { num: string; weekday: string } {
  const d = new Date(iso + 'T12:00:00Z')
  return {
    num: String(d.getUTCDate()).padStart(2, '0'),
    weekday: d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }),
  }
}

function getMobileDates(count: number): Array<{ iso: string; num: string; weekday: string }> {
  return Array.from({ length: count }, (_, i) => {
    const d = new Date()
    d.setDate(d.getDate() - i)
    const iso = localISO(d)
    return { iso, ...getDateMeta(iso) }
  })
}

function heroDateLabel(iso: string): { display: string; sub: string } {
  const today = localISO()
  const yesterday = (() => { const d = new Date(); d.setDate(d.getDate() - 1); return localISO(d) })()
  const d = new Date(iso + 'T12:00:00Z')
  const sub = d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' })
  if (iso === today) return { display: 'Today', sub }
  if (iso === yesterday) return { display: 'Yesterday', sub }
  return {
    display: d.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' }),
    sub,
  }
}

export default function HomePage() {
  const { theme, toggle: toggleTheme } = useTheme()
  const [selectedDate, setSelectedDate] = useState(todayISO)
  const [selectedCategory, setSelectedCategory] = useState<CategoryOption>('all')
  const [search, setSearch] = useState('')
  const [recapMode, setRecapMode] = useState(false)
  const [mobileDaysShown, setMobileDaysShown] = useState(7)
  const RECAP_DAYS = 7

  // Search pagination
  const [searchOffset, setSearchOffset] = useState(0)
  const [searchAccumulated, setSearchAccumulated] = useState<(Cluster & { articles: Article[] })[]>([])

  const isSearchMode = search.trim().length > 0
  const timelineMode = !isSearchMode && !recapMode
  const categoryParam = selectedCategory === 'all' ? undefined : (selectedCategory as Category)

  const handleDateSelect = useCallback((date: string) => {
    setSearch('')
    setRecapMode(false)
    setSelectedDate(date)
  }, [])

  // Searching always exits recap so the two modes never overlap
  useEffect(() => {
    if (search.trim().length > 0) setRecapMode(false)
  }, [search])

  // ── Queries ──────────────────────────────────────────────────────────────────

  const { data: topStories } = trpc.articles.getTopStories.useQuery(
    { days: 7, limit: 6 },
    { staleTime: 5 * 60_000 },
  )

  const { data: timelineData, isLoading: timelineLoading } = trpc.articles.getClusters.useQuery(
    { date: selectedDate, category: categoryParam, limit: 100 },
    { enabled: !isSearchMode },
  )

  const { data: searchPage, isLoading: searchLoading, isFetching: searchFetching } =
    trpc.articles.search.useQuery(
      { query: search.trim(), category: categoryParam, limit: 20, offset: searchOffset },
      { enabled: isSearchMode },
    )

  const { data: recapData, isLoading: recapLoading } = trpc.articles.getRecap.useQuery(
    { days: RECAP_DAYS, limit: 40 },
    { enabled: recapMode, staleTime: 5 * 60_000 },
  )

  // Reset accumulated search results when query or category changes
  useEffect(() => {
    setSearchAccumulated([])
    setSearchOffset(0)
  }, [search, selectedCategory])

  // Append new page
  useEffect(() => {
    if (searchPage?.length) {
      setSearchAccumulated((prev) =>
        searchOffset === 0 ? searchPage : [...prev, ...searchPage],
      )
    }
  }, [searchPage, searchOffset])

  const handleLoadMore = useCallback(() => {
    setSearchOffset((prev) => prev + 20)
  }, [])

  const hasMoreSearchResults = searchPage?.length === 20

  // Story count map for date rail
  const storyCounts = useMemo(() => {
    if (!timelineData) return {}
    return { [selectedDate]: timelineData.length }
  }, [timelineData, selectedDate])

  const { display: heroDisplay, sub: heroSub } = heroDateLabel(selectedDate)
  const mobileDates = getMobileDates(mobileDaysShown)

  // Ghost number: day of selected date
  const ghostNum = new Date(selectedDate + 'T12:00:00Z').getUTCDate().toString().padStart(2, '0')

  return (
    <div className="aurora-stage" suppressHydrationWarning>
      {/* Aurora background */}
      <div className="aurora-layer">
        <div className="aurora-blob aurora-blob-1" />
        <div className="aurora-blob aurora-blob-2" />
        <div className="aurora-blob aurora-blob-3" />
      </div>

      {/* Ghost date number (decorative, desktop only) */}
      {timelineMode && (
        <div className="ghost-number" suppressHydrationWarning>{ghostNum}</div>
      )}

      {/* Glass nav */}
      <NavBar theme={theme} onToggleTheme={toggleTheme} query={search} onQuery={setSearch} />

      {/* Ticker */}
      {timelineMode && <Ticker stories={topStories ?? []} />}

      {/* Hero — date heading + category pills */}
      {timelineMode && (
        <header className="anc-hero" suppressHydrationWarning>
          <div className="anc-kicker">The AI news that actually mattered</div>
          <div className="anc-date-heading">
            {heroDisplay} <span className="dim">— {heroSub}</span>
          </div>
          <div className="anc-hero-sub">
            <b>{(timelineData ?? []).length} {(timelineData ?? []).length === 1 ? 'story' : 'stories'}</b>
            {selectedCategory !== 'all' ? ` in ${CATEGORY_LABELS[selectedCategory]}` : ' today'},
            {' '}ranked by significance · highest signal first
          </div>
          <div className="anc-hero-actions">
            <button className="anc-catchup" onClick={() => { setSearch(''); setRecapMode(true) }}>
              ⚡ Catch me up on the last {RECAP_DAYS} days
            </button>
          </div>
          <CategoryFilter selected={selectedCategory} onChange={(c) => { setSelectedCategory(c) }} />
        </header>
      )}

      {/* Mobile date strip */}
      {timelineMode && (
        <div className="anc-datestrip" suppressHydrationWarning>
          {mobileDates.map(({ iso, num, weekday }) => (
            <button
              key={iso}
              className={`anc-dpill${iso === selectedDate ? ' active' : ''}`}
              onClick={() => handleDateSelect(iso)}
            >
              <span className="anc-dpill-num">{parseInt(num, 10)}</span>
              <span className="anc-dpill-wd">{weekday}</span>
            </button>
          ))}
          <button
            className="anc-dpill"
            onClick={() => setMobileDaysShown((n) => n + 7)}
            style={{ minWidth: 48 }}
          >
            <span className="anc-dpill-num" style={{ fontSize: 13 }}>···</span>
          </button>
        </div>
      )}

      {/* Main content */}
      <div className="anc-body">
        {/* Desktop date rail */}
        {timelineMode && (
          <DateNav
            selectedDate={selectedDate}
            onSelect={handleDateSelect}
            storyCounts={storyCounts}
          />
        )}

        {/* Feed */}
        <main className="anc-feed">
          {recapMode ? (
            // ── Catch me up ───────────────────────────────────────────────────
            recapLoading ? (
              <SkeletonSection />
            ) : (
              <Recap
                clusters={recapData ?? []}
                days={RECAP_DAYS}
                onClose={() => setRecapMode(false)}
              />
            )
          ) : isSearchMode ? (
            // ── Search results ────────────────────────────────────────────────
            <>
              <div className="anc-results-head">
                <h2>Results</h2>
                <span className="anc-results-count">
                  {searchAccumulated.length} {searchAccumulated.length === 1 ? 'MATCH' : 'MATCHES'} · ALL DATES
                </span>
                <button className="anc-results-back" onClick={() => setSearch('')}>
                  ← Back to today
                </button>
              </div>

              {searchLoading && searchOffset === 0 ? (
                <SkeletonSection />
              ) : searchAccumulated.length === 0 ? (
                <div className="anc-statebox">
                  <div className="anc-statebox-glyph">
                    <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
                      <circle cx="9.5" cy="9.5" r="6.5" stroke="currentColor" strokeWidth="1.5" />
                      <path d="M14.5 14.5L19 19" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                  </div>
                  <h3>Nothing matched</h3>
                  <p>No stories matched &ldquo;{search}&rdquo;. Try a broader term — model, policy, chips…</p>
                  <button className="anc-statebox-act" onClick={() => setSearch('')}>Clear search</button>
                </div>
              ) : (
                <>
                  {searchAccumulated.map((cluster) => (
                    <div key={cluster.id}>
                      <div className="anc-dhead" style={{ marginTop: 16, marginBottom: 10 }}>
                        <span className="anc-dhead-count">
                          {new Date(cluster.first_published_at).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
                        </span>
                        <span className="anc-dhead-rule" />
                      </div>
                      <StoryCard cluster={cluster} showDate={false} highlight={search.trim()} />
                    </div>
                  ))}
                  {hasMoreSearchResults && (
                    <button
                      className="anc-more"
                      onClick={handleLoadMore}
                      disabled={searchFetching}
                    >
                      {searchFetching ? 'Loading…' : 'Load more results'}
                    </button>
                  )}
                </>
              )}
            </>
          ) : (
            // ── Timeline ──────────────────────────────────────────────────────
            timelineLoading ? (
              <SkeletonSection />
            ) : (
              <DateSection
                date={selectedDate}
                clusters={timelineData ?? []}
              />
            )
          )}
        </main>
      </div>
    </div>
  )
}
