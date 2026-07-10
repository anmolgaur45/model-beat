'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import type { DigestTeaser } from '@/types/article'

// Phase W: the floating digest signup card (redesigned 2026-07-10 after review
// against databubble.io): a quiet fixed bottom-right widget that slides up
// once the visitor has actually scrolled, never an element in the content
// flow. Shows real rows from the week (movement events, collapsed catalog
// line, top stories) — the content is the ad. One action: the email field.
//
// Mounted once in the root layout; copy + waitlist source derive from the
// pathname. Dismiss (21 days) and subscribed state live in localStorage and
// are checked before the card ever shows, so there is nothing to un-flash.

type Surface = 'home' | 'models' | 'model' | 'changes' | 'story'

// Per-surface waitlist source so Monday metrics shows which page converts.
// Sources MUST keep the 'digest' prefix: the waitlist upsert's upgrade rule
// and the weekly CSV export both select digest consent via LIKE 'digest%'.
const SOURCES: Record<Surface, string> = {
  home: 'digest-card-home',
  models: 'digest-card-models',
  model: 'digest-card-model',
  changes: 'digest-card-changes',
  story: 'digest-card-story',
}

// One short action line above the form (the state line already carries the
// framing, so anything longer reads as repetition).
const PROMISE = 'Get the full brief every Thursday.'

// Pages where the card never shows: the full signup page itself, legal/meta
// pages, and Stack Watch (its own funnel).
const EXCLUDED = ['/digest', '/privacy', '/methodology', '/about', '/stack-watch']

function surfaceFor(path: string): Surface | null {
  if (EXCLUDED.some((p) => path === p || path.startsWith(p + '/'))) return null
  if (path === '/models/changes') return 'changes'
  if (path === '/models' || path.startsWith('/models/best') || path.startsWith('/models/compare')) return 'models'
  if (path.startsWith('/models/')) return 'model'
  if (path.startsWith('/story') || path.startsWith('/day')) return 'story'
  return 'home'
}

const DISMISS_KEY = 'mb-digest-card'
const SUBSCRIBED_KEY = 'mb-digest-subscribed'
const DISMISS_MS = 21 * 86_400_000
const SCROLL_TRIGGER = 400 // px of scroll = real engagement before we ask

function isOff(): boolean {
  try {
    if (localStorage.getItem(SUBSCRIBED_KEY) === '1') return true
    const raw = localStorage.getItem(DISMISS_KEY)
    if (raw) return Date.now() - (JSON.parse(raw).dismissedAt || 0) < DISMISS_MS
  } catch {}
  return false
}

type Status = 'idle' | 'submitting' | 'success' | 'error'

export function DigestTeaserCard({ teaser }: { teaser: DigestTeaser }) {
  const reduce = useReducedMotion()
  const pathname = usePathname()
  const [visible, setVisible] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const [email, setEmail] = useState('')
  const [website, setWebsite] = useState('') // honeypot
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState('')

  const surface = surfaceFor(pathname ?? '/')

  // Appear after real scroll engagement, unless dismissed/subscribed.
  useEffect(() => {
    if (!surface || isOff()) return
    const check = () => {
      if (window.scrollY > SCROLL_TRIGGER) {
        setVisible(true)
        window.removeEventListener('scroll', check)
      }
    }
    check() // already scrolled (e.g. back-navigation restores position)
    window.addEventListener('scroll', check, { passive: true })
    return () => window.removeEventListener('scroll', check)
  }, [surface])

  if (!surface || teaser.rows.length === 0) return null
  const source = SOURCES[surface]

  function dismiss() {
    try {
      localStorage.setItem(DISMISS_KEY, JSON.stringify({ dismissedAt: Date.now() }))
    } catch {}
    setDismissed(true)
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (status === 'submitting') return
    setStatus('submitting')
    setError('')
    try {
      const res = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, website, source }),
      })
      if (res.ok) {
        setStatus('success')
        try {
          localStorage.setItem(SUBSCRIBED_KEY, '1')
        } catch {}
      } else {
        const data = await res.json().catch(() => ({}))
        setError(data.error === 'invalid_email' ? 'That email doesn’t look right.' : 'Something went wrong. Try again.')
        setStatus('error')
      }
    } catch {
      setError('Network error. Try again.')
      setStatus('error')
    }
  }

  return (
    <AnimatePresence>
      {visible && !dismissed && (
        <motion.aside
          className="anc-dgc"
          aria-label="Weekly digest signup"
          aria-live="polite"
          initial={reduce ? { opacity: 0 } : { opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, y: 10, transition: { duration: 0.18 } }}
          transition={{ duration: 0.38, ease: [0.21, 0.9, 0.27, 1] }}
        >
          <div className="anc-dgc-head">
            <span className="anc-dgc-dot" aria-hidden />
            <span className="anc-dgc-kicker">The Model Beat Digest</span>
            <button type="button" className="anc-dgc-x" aria-label="Hide digest signup" onClick={dismiss}>
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden>
                <path d="M1 1l8 8M9 1L1 9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
            </button>
          </div>

          {status === 'success' ? (
            <motion.div
              className="anc-dgc-ok"
              initial={reduce ? false : { opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.24 }}
            >
              <span className="anc-dgc-check" aria-hidden>
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M2 6.2L4.8 9L10 3.4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
              <div>
                <strong>You&rsquo;re on the list.</strong>
                <span>The next issue lands Thursday.</span>
              </div>
            </motion.div>
          ) : (
            <>
              {/* Honest label: the rows are a live rolling week, not the sent
                  issue (post-send events would falsify an "issue" claim). */}
              <p className="anc-dgc-state">This week on the beat</p>

              <ul className="anc-dgc-rows">
                {teaser.rows.map((r) => (
                  <li className="anc-dgc-row" key={r.key}>
                    <span className={`anc-dgc-tick${r.kind === 'story' ? ' is-story' : ''}`} aria-hidden />
                    <span className="anc-dgc-sum">{r.text}</span>
                    {r.chip && <span className={`anc-dgc-chip ${r.tone}`}>{r.chip}</span>}
                  </li>
                ))}
              </ul>

              <p className="anc-dgc-promise">{PROMISE}</p>
              <form className="anc-dgc-form" onSubmit={submit}>
                <input
                  type="email"
                  required
                  placeholder="you@work.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="anc-wl-email anc-dgc-email"
                  aria-label="Email address"
                />
                {/* honeypot — hidden from real users */}
                <input
                  type="text"
                  name="website"
                  tabIndex={-1}
                  autoComplete="off"
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                  className="anc-wl-hp"
                  aria-hidden="true"
                />
                <button type="submit" className="anc-wl-btn anc-dgc-btn" disabled={status === 'submitting'}>
                  {status === 'submitting' ? 'Joining…' : (
                    <>
                      Get the brief <span className="anc-dgc-arrow" aria-hidden>&rarr;</span>
                    </>
                  )}
                </button>
              </form>
              {status === 'error' && <p className="anc-wl-err" role="alert">{error}</p>}
              <p className="anc-dgc-trust">Free. No spam. One-click unsubscribe.</p>
            </>
          )}
        </motion.aside>
      )}
    </AnimatePresence>
  )
}
