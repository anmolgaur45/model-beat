export function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days}d ago`
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function localISO(date: Date = new Date()): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

// The calendar day `n` days after `iso` (negative goes back). Pure date math,
// so the server and every visitor's browser agree on it.
export function shiftDay(iso: string, n: number): string {
  const d = new Date(iso + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

// The homepage's "today". Stories are bucketed by UTC day, so the newest day
// with stories is the current UTC day (the server's render day, or the clock's
// if this copy of the page is older than that). A visitor whose local day is
// ahead of it (India after midnight) would land on a day with no stories yet,
// so they stay on it; a visitor behind it (US evenings) moves back to their
// local day, which already has a full day of stories.
export function homeToday(serverDay: string, localDay: string, utcDay: string): string {
  const newest = utcDay > serverDay ? utcDay : serverDay
  return localDay < newest ? localDay : newest
}

export function formatDateLabel(dateStr: string, today: string = localISO()): string {
  if (dateStr === today) return 'Today'
  if (dateStr === shiftDay(today, -1)) return 'Yesterday'
  return new Date(dateStr + 'T12:00:00Z').toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  })
}
