'use client'

import { useState, useEffect, useCallback, useMemo, useSyncExternalStore } from 'react'
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
import { homeToday, localISO, shiftDay } from '@/lib/timeFormat'

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

function getDateMeta(iso: string): { num: string; weekday: string } {
  const d = new Date(iso + 'T12:00:00Z')
  return {
    num: String(d.getUTCDate()).padStart(2, '0'),
    weekday: d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }),
  }
}

function getMobileDates(today: string, count: number): Array<{ iso: string; num: string; weekday: string }> {
  return Array.from({ length: count }, (_, i) => {
    const iso = shiftDay(today, -i)
    return { iso, ...getDateMeta(iso) }
  })
}

function heroDateLabel(iso: string, today: string): { display: string; sub: string } {
  const d = new Date(iso + 'T12:00:00Z')
  const sub = d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' })
  if (iso === today) return { display: 'Today', sub }
  if (iso === shiftDay(today, -1)) return { display: 'Yesterday', sub }
  return {
    display: d.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' }),
    sub,
  }
}

// Nothing to subscribe to: each render re-reads the clock. useSyncExternalStore
// is here for its server snapshot, which hydration uses instead of the clock.
const subscribeNever = () => () => {}

export default function HomePageClient({ initialDate, initialClusters, initialTopStories, initialTopModels }: Props) {
  // Every date on the page (hero, rail, strip, section heading) derives from
  // this one "today". Hydration renders with the server's day, so the HTML
  // matches; right after, React swaps in the visitor's day where it has
  // stories (homeToday). Reading the browser clock during render made the rail
  // and labels differ from the server HTML whenever the visitor's date wasn't
  // the UTC date, which threw hydration error #418 and re-rendered the page.
  const today = useSyncExternalStore(
    subscribeNever,
    () => homeToday(initialDate, localISO(), new Date().toISOString().slice(0, 10)),
    () => initialDate,
  )
  // null = follow today; set when the visitor picks a date.
  const [pickedDate, setPickedDate] = useState<string | null>(null)
  const selectedDate = pickedDate ?? today
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
    setPickedDate(date)
  }, [])

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
  const {
    data: timelineData,
    isLoading: timelineLoading,
    isPlaceholderData: timelinePending,
  } = trpc.articles.getClusters.useQuery(
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

  // Warm the date rail in the background (2026-10-09): picking a date waited on a
  // live iad1 -> Cloud SQL round trip. One date at a time, so each request is its
  // own edge-cacheable URL (httpBatchLink merges calls made in the same tick).
  const utils = trpc.useUtils()
  useEffect(() => {
    if (!timelineMode) return
    const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection
    if (conn?.saveData) return
    let cancelled = false
    const warm = async () => {
      for (const { iso } of getMobileDates(today, 7)) {
        if (cancelled) return
        await utils.articles.getClusters.prefetch(
          { date: iso, category: categoryParam, limit: 100, by: 'peak' },
          { staleTime: 5 * 60_000 },
        )
      }
    }
    const hasIdle = 'requestIdleCallback' in window
    const handle = hasIdle
      ? window.requestIdleCallback(() => void warm(), { timeout: 3000 })
      : window.setTimeout(() => void warm(), 1500)
    return () => {
      cancelled = true
      if (hasIdle) window.cancelIdleCallback(handle)
      else window.clearTimeout(handle)
    }
  }, [timelineMode, categoryParam, utils, today])

  // Honest split for the hero count: pure-arXiv paper clusters are shelved
  // below the stories by DateSection, so don't count them as "stories".
  const paperCount = (timelineData ?? []).filter(isPaperCluster).length
  const storyCount = (timelineData ?? []).length - paperCount

  const isTodaySelected = selectedDate === today

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

  const { display: heroDisplay, sub: heroSub } = heroDateLabel(selectedDate, today)
  const mobileDates = getMobileDates(today, mobileDaysShown)

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
          setPickedDate(null)
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
            today={today}
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
                today={today}
                clusters={timelineData ?? []}
                pending={timelinePending}
              />
            )
          )}
        </main>
      </div>
    </div>
  )
}
