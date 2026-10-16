import { describe, expect, it } from 'vitest'
import { formatDateLabel, homeToday, shiftDay } from '../timeFormat'

describe('shiftDay', () => {
  it('crosses month, year and leap-day boundaries', () => {
    expect(shiftDay('2026-10-01', -1)).toBe('2026-09-30')
    expect(shiftDay('2026-01-01', -1)).toBe('2025-12-31')
    expect(shiftDay('2028-03-01', -1)).toBe('2028-02-29')
    expect(shiftDay('2026-10-16', 0)).toBe('2026-10-16')
    expect(shiftDay('2026-12-31', 1)).toBe('2027-01-01')
  })
})

describe('homeToday', () => {
  it('keeps the UTC day when the visitor is ahead of UTC (India after midnight)', () => {
    // 01:00 IST on Oct 17 is still Oct 16 in UTC: Oct 17 has no stories yet.
    expect(homeToday('2026-10-16', '2026-10-17', '2026-10-16')).toBe('2026-10-16')
  })

  it('moves to the local day when the visitor is behind UTC (US evening)', () => {
    // 20:00 EDT on Oct 16 is already Oct 17 in UTC.
    expect(homeToday('2026-10-17', '2026-10-16', '2026-10-17')).toBe('2026-10-16')
  })

  it('is the shared day when they agree', () => {
    expect(homeToday('2026-10-16', '2026-10-16', '2026-10-16')).toBe('2026-10-16')
  })

  it('follows the clock when the cached page is from an older UTC day', () => {
    // HTML rendered on Oct 15 (a refresh failed), seen on Oct 16 in UTC.
    expect(homeToday('2026-10-15', '2026-10-16', '2026-10-16')).toBe('2026-10-16')
    // Same stale page in India after midnight: still the newest UTC day.
    expect(homeToday('2026-10-15', '2026-10-17', '2026-10-16')).toBe('2026-10-16')
  })
})

describe('formatDateLabel', () => {
  it('labels relative to the given today, not the machine clock', () => {
    expect(formatDateLabel('2026-10-16', '2026-10-16')).toBe('Today')
    expect(formatDateLabel('2026-10-15', '2026-10-16')).toBe('Yesterday')
    expect(formatDateLabel('2026-10-14', '2026-10-16')).toBe('Wednesday, October 14')
  })

  it('treats a month boundary yesterday correctly', () => {
    expect(formatDateLabel('2026-09-30', '2026-10-01')).toBe('Yesterday')
  })
})
