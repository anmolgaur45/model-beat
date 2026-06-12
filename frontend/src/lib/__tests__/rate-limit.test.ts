import { describe, it, expect } from 'vitest'
import { checkRateLimit } from '../rate-limit'

// Each test uses a unique key so the module-level Map doesn't bleed between tests.
let keySeq = 0
function uniqueKey() { return `test-${++keySeq}` }

describe('checkRateLimit', () => {
  it('allows requests within the limit', () => {
    const config = { maxRequests: 3, windowMs: 60_000 }
    const key = uniqueKey()
    for (let i = 0; i < 3; i++) {
      expect(checkRateLimit(key, config).allowed).toBe(true)
    }
  })

  it('blocks the request that exceeds the limit', () => {
    const config = { maxRequests: 2, windowMs: 60_000 }
    const key = uniqueKey()
    checkRateLimit(key, config)
    checkRateLimit(key, config)
    const result = checkRateLimit(key, config)
    expect(result.allowed).toBe(false)
  })

  it('returns retryAfterSec > 0 when blocked', () => {
    const config = { maxRequests: 1, windowMs: 60_000 }
    const key = uniqueKey()
    checkRateLimit(key, config)
    const result = checkRateLimit(key, config)
    expect(result.retryAfterSec).toBeGreaterThan(0)
  })

  it('returns retryAfterSec = 0 when allowed', () => {
    const config = { maxRequests: 5, windowMs: 60_000 }
    const result = checkRateLimit(uniqueKey(), config)
    expect(result.retryAfterSec).toBe(0)
  })

  it('different keys are independent', () => {
    const config = { maxRequests: 1, windowMs: 60_000 }
    const key1 = uniqueKey()
    const key2 = uniqueKey()
    checkRateLimit(key1, config) // exhaust key1
    expect(checkRateLimit(key2, config).allowed).toBe(true)
  })

  it('allows a single request on a fresh key', () => {
    const config = { maxRequests: 1, windowMs: 60_000 }
    expect(checkRateLimit(uniqueKey(), config).allowed).toBe(true)
  })
})
