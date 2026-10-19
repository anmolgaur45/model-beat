'use client'

import { useState } from 'react'
import { shiftDay } from '@/lib/timeFormat'

interface Props {
  // The page's resolved "today" (homeToday), never the browser clock: the rail
  // must render the same dates as the server HTML or hydration fails (#418).
  today: string
  selectedDate: string
  onSelect: (date: string) => void
  // Start loading a date on hover, touch or keyboard focus, ahead of the click
  onWarm?: (date: string) => void
  storyCounts?: Record<string, number>
}

function getRecentDates(today: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => shiftDay(today, -i))
}

function formatRailLabel(dateStr: string, today: string): string {
  if (dateStr === today) return 'Today'
  if (dateStr === shiftDay(today, -1)) return 'Yesterday'
  const d = new Date(dateStr + 'T12:00:00Z')
  const day = d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })
  const num = d.getUTCDate()
  const month = d.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' })
  return `${day} ${num} · ${month}`
}

export function DateNav({ today, selectedDate, onSelect, onWarm, storyCounts = {} }: Props) {
  const [daysShown, setDaysShown] = useState(7)
  const dates = getRecentDates(today, daysShown)
  const maxDays = 60

  return (
    <aside className="anc-side" style={{ position: 'sticky', top: 24 }}>
      <div className="anc-rail" />
      {dates.map((date) => {
        const isActive = date === selectedDate
        const count = storyCounts[date]
        return (
          <button
            key={date}
            className={`anc-dt${isActive ? ' active' : ''}`}
            onClick={() => onSelect(date)}
            onPointerEnter={() => onWarm?.(date)}
            onFocus={() => onWarm?.(date)}
            suppressHydrationWarning
          >
            <span className="anc-dt-dot" />
            <span>{formatRailLabel(date, today)}</span>
            {count !== undefined && (
              <span className="anc-dt-count">{count}</span>
            )}
          </button>
        )
      })}
      {daysShown < maxDays ? (
        <button className="anc-older-btn" onClick={() => setDaysShown((n) => Math.min(n + 7, maxDays))}>
          Load older dates
        </button>
      ) : (
        <button className="anc-older-btn" disabled>
          Beginning of archive
        </button>
      )}
    </aside>
  )
}
