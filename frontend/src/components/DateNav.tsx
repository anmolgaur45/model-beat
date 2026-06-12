'use client'

import { useState } from 'react'

interface Props {
  selectedDate: string
  onSelect: (date: string) => void
  storyCounts?: Record<string, number>
}

function getRecentDates(count: number): string[] {
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(Date.now() - i * 86_400_000)
    return d.toISOString().split('T')[0]
  })
}

function formatRailLabel(dateStr: string): string {
  const today = new Date().toISOString().split('T')[0]
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().split('T')[0]
  if (dateStr === today) return 'Today'
  if (dateStr === yesterday) return 'Yesterday'
  const d = new Date(dateStr + 'T12:00:00Z')
  const day = d.toLocaleDateString('en-US', { weekday: 'short' })
  const num = d.getUTCDate()
  const month = d.toLocaleDateString('en-US', { month: 'short' })
  return `${day} ${num} · ${month}`
}

export function DateNav({ selectedDate, onSelect, storyCounts = {} }: Props) {
  const [daysShown, setDaysShown] = useState(7)
  const dates = getRecentDates(daysShown)
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
            suppressHydrationWarning
          >
            <span className="anc-dt-dot" />
            <span>{formatRailLabel(date)}</span>
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
