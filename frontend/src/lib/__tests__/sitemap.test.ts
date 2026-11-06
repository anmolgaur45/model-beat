import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db', () => ({ default: async () => [] }))
vi.mock('@/lib/days', () => ({ substantiveDays: async () => [] }))
vi.mock('@/lib/comparePairs', () => ({ comparePairs: async () => [] }))
vi.mock('@/lib/digestIssues', () => ({ listIssues: () => [{ date: '2026-11-05' }] }))

import sitemap from '@/app/sitemap'

describe('sitemap', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: new Date('2026-11-05T09:48:00Z') })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  // deploy-health reads the newest lastmod as the render time, so a future one fails it.
  it('has no future lastmod on the morning an issue is published', async () => {
    const entries = await sitemap()
    expect(entries.some((e) => e.url.endsWith('/digest/2026-11-05'))).toBe(true)

    const future = entries.filter((e) => new Date(e.lastModified!).getTime() > Date.now())
    expect(future.map((e) => e.url)).toEqual([])
  })
})
