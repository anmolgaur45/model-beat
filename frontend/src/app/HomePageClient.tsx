'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { keepPreviousData } from '@tanstack/react-query'
import type { inferRouterOutputs } from '@trpc/server'
import { trpc } from '@/lib/trpc'
import type { AppRouter } from '@/server/routers/_app'
import type { Category, Cluster, Article } from '@/types/article'
import type { CategoryOption } from '@/components/CategoryFilter'
import { CategoryFilter } from '@/components/CategoryFilter'
import { DateSection, SkeletonSection } from '@/components/DateSection'
import { isPaperCluster } from '@/lib/papers'
import { DateNav } from '@/components/DateNav'
import { StoryCard } from '@/components/StoryCard'
import { Recap } from '@/components/Recap'
import { NavBar } from '@/components/NavBar'
import { Ticker } from '@/components/Ticker'
import { HeroModelBand, type TopModel } from '@/components/HeroModelBand'
import { CATEGORY_LABELS } from '@/components/categoryMeta'

// Exact router output shapes so initialData matches the query's data type.
type RouterOutputs = inferRouterOutputs<AppRouter>
type DayClusters = RouterOutputs['articles']['getClusters']
type TopStories = RouterOutputs['articles']['getTopStories']

interface Props {
  // Server-fetched so the first HTML (and crawlers/AI bots) get real content.
  initialDate: string
  initialClusters: DayClusters
  initialTopStories: TopStories
  initialTopModels: TopModel[]
}

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

export default function HomePageClient({ initialDate, initialClusters, initialTopStories, initialTopModels }: Props) {
  // Start on the server's date so first client render matches the SSR HTML; a
  // post-mount effect nudges it to the visitor's local day if their timezone
  // has already rolled over (avoids a hydration mismatch).
  const [selectedDate, setSelectedDate] = useState(initialDate)
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

  // Correct to the visitor's local day if it differs from the server's day.
  useEffect(() => {
    const local = todayISO()
    if (local !== initialDate) setSelectedDate(local)
  }, [initialDate])

  // Searching always exits recap so the two modes never overlap
  useEffect(() => {
    if (search.trim().length > 0) setRecapMode(false)
  }, [search])

  // Land on /?q=… running that search — powers the WebSite SearchAction (sitelinks box)
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get('q')
    if (q) setSearch(q)
  }, [])

  // ── Queries ──────────────────────────────────────────────────────────────────

  const { data: topStories } = trpc.articles.getTopStories.useQuery(
    { days: 7, limit: 6 },
    { staleTime: 5 * 60_000, initialData: initialTopStories },
  )

  // Seed the timeline only for the exact server-rendered view (today, all
  // categories); any other date/category fetches fresh on the client.
  const { data: timelineData, isLoading: timelineLoading } = trpc.articles.getClusters.useQuery(
    { date: selectedDate, category: categoryParam, limit: 100, by: 'peak' },
    {
      enabled: !isSearchMode,
      initialData:
        selectedDate === initialDate && !categoryParam ? initialClusters : undefined,
      // Filter/date switches re-rank in place instead of collapsing the whole
      // feed to a skeleton (which yanked page height and scroll position).
      placeholderData: keepPreviousData,
    },
  )

  // Honest split for the hero count: pure-arXiv paper clusters are shelved
  // below the stories by DateSection, so don't count them as "stories".
  const paperCount = (timelineData ?? []).filter(isPaperCluster).length
  const storyCount = (timelineData ?? []).length - paperCount

  const isTodaySelected = selectedDate === todayISO()

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
    return { [selectedDate]: timelineData.filter((c) => !isPaperCluster(c)).length }
  }, [timelineData, selectedDate])

  const { display: heroDisplay, sub: heroSub } = heroDateLabel(selectedDate)
  const mobileDates = getMobileDates(mobileDaysShown)

  return (
    <div className="aurora-stage" suppressHydrationWarning>
      {/* Aurora background */}
      <div className="aurora-layer">
        <div className="aurora-blob aurora-blob-1" />
        <div className="aurora-blob aurora-blob-2" />
        <div className="aurora-blob aurora-blob-3" />
      </div>

      {/* Glass nav */}
      <NavBar
        query={search}
        onQuery={setSearch}
        onHome={() => {
          setSearch('')
          setRecapMode(false)
          setSelectedCategory('all')
          setSelectedDate(todayISO())
        }}
      />

      {/* Ticker — thin live "wire" strip pinned at the top */}
      {timelineMode && <Ticker stories={topStories ?? []} />}

      {/* Model-intelligence band — leads the content with the tracker/compare wedge */}
      {timelineMode && <HeroModelBand models={initialTopModels} />}


      {/* Main content — the hero lives inside the feed column so the date rail
          starts level with the heading (no dead zone left of the hero). */}
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
          {/* Hero — date heading + category pills, on the story cards' axis */}
          {timelineMode && (
            <header className="anc-hero" suppressHydrationWarning>
              {/* The one-line answer to "what is this site": the news+tracker
                  integration stated outright, not left for visitors to infer. */}
              <div className="anc-valueprop">
                Daily AI news, deduplicated and ranked by significance, linked to a live tracker
                of the models it&apos;s about.
              </div>
              {/* H1 carries the topic ("AI news"), not a bare date — the homepage's
                  one heading slot shouldn't be spent on "Today". */}
              <h1 className="anc-date-heading">
                {heroDisplay === 'Today' ? 'AI news today' : `AI news · ${heroDisplay}`}{' '}
                <span className="dim">· {heroSub}</span>
              </h1>
              <div className="anc-hero-sub">
                <b>{storyCount} {storyCount === 1 ? 'story' : 'stories'}</b>
                {paperCount > 0 && <> · {paperCount} {paperCount === 1 ? 'paper' : 'papers'}</>}
                {selectedCategory !== 'all' ? ` in ${CATEGORY_LABELS[selectedCategory]}` : isTodaySelected ? ' so far today' : ''},
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
