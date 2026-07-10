import { describe, expect, it } from 'vitest'
import { bySignificance, type RankableStory } from '../storyRank'

const story = (over: Partial<RankableStory>): RankableStory => ({
  significance_score: 7,
  source_count: 3,
  max_impact: 5,
  first_published_at: '2026-07-10T12:00:00Z',
  ...over,
})

describe('bySignificance', () => {
  it('higher score wins regardless of tie-break fields', () => {
    const low = story({ significance_score: 7, source_count: 30, max_impact: 10 })
    const high = story({ significance_score: 8, source_count: 1, max_impact: 1 })
    expect([low, high].sort(bySignificance)[0]).toBe(high)
  })

  it('at equal score, broader coverage wins (Mistral 37 outlets vs GPT-Live 9)', () => {
    const gptLive = story({ significance_score: 10, source_count: 9, max_impact: 10 })
    const mistral = story({ significance_score: 10, source_count: 37, max_impact: 8 })
    expect([gptLive, mistral].sort(bySignificance)[0]).toBe(mistral)
  })

  it('at equal score and coverage, higher impact wins', () => {
    const notable = story({ max_impact: 6 })
    const major = story({ max_impact: 8 })
    expect([notable, major].sort(bySignificance)[0]).toBe(major)
  })

  it('fully tied stories order newest first', () => {
    const older = story({ first_published_at: '2026-07-09T12:00:00Z' })
    const newer = story({ first_published_at: '2026-07-10T12:00:00Z' })
    expect([older, newer].sort(bySignificance)[0]).toBe(newer)
  })

  it('missing tie-break fields rank as zero, not NaN', () => {
    const bare = story({ source_count: undefined, max_impact: null })
    const covered = story({ source_count: 2, max_impact: null })
    const sorted = [bare, covered].sort(bySignificance)
    expect(sorted[0]).toBe(covered)
    expect(sorted).toHaveLength(2)
  })
})
