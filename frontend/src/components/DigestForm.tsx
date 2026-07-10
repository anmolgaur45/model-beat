'use client'

import { useState } from 'react'

type Status = 'idle' | 'submitting' | 'success' | 'error'

// Email-only capture for the weekly digest. Deliberately leaner than
// WaitlistForm (no stack textarea — that's Stack Watch qualification, this is a
// newsletter signup where every extra field costs conversions). Writes to the
// same waitlist table with source='digest'; exported to the newsletter platform
// by filtering on that source.
export function DigestForm({ source = 'digest', compact = false }: { source?: string; compact?: boolean }) {
  const [email, setEmail] = useState('')
  const [website, setWebsite] = useState('') // honeypot
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState('')

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
        // Phase W: a subscriber from ANY form silences the floating teaser
        // card (it checks this flag before showing).
        try {
          localStorage.setItem('mb-digest-subscribed', '1')
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

  if (status === 'success') {
    return (
      <div className={`anc-wl-success${compact ? ' anc-digest-compact' : ''}`}>
        <strong>You’re in.</strong>
        <span>The next issue lands in your inbox Thursday.</span>
      </div>
    )
  }

  return (
    <form className={`anc-digest-form${compact ? ' anc-digest-compact' : ''}`} onSubmit={submit}>
      <input
        type="email"
        required
        placeholder="you@work.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="anc-wl-email"
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
      <button type="submit" className="anc-wl-btn" disabled={status === 'submitting'}>
        {status === 'submitting' ? 'Joining…' : 'Subscribe'}
      </button>
      {status === 'error' && <p className="anc-wl-err">{error}</p>}
    </form>
  )
}
