'use client'

import { useState } from 'react'

type Status = 'idle' | 'submitting' | 'success' | 'error'

export function WaitlistForm({ source = 'stack-watch' }: { source?: string }) {
  const [email, setEmail] = useState('')
  const [stack, setStack] = useState('')
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
        body: JSON.stringify({ email, stack, website, source }),
      })
      if (res.ok) {
        setStatus('success')
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
      <div className="anc-wl-success">
        <strong>You’re on the list.</strong>
        <span>I’ll email you the moment Stack Watch is ready. No spam, ever.</span>
      </div>
    )
  }

  return (
    <form className="anc-wl-form" onSubmit={submit}>
      <input
        type="email"
        required
        placeholder="you@work.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="anc-wl-email"
        aria-label="Email address"
      />
      <textarea
        placeholder="Optional: which models or tools do you depend on? (e.g. GPT-5.5, Claude, a vector DB)"
        value={stack}
        onChange={(e) => setStack(e.target.value)}
        className="anc-wl-stack"
        rows={2}
        aria-label="Which models or tools do you depend on"
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
        {status === 'submitting' ? 'Joining…' : 'Get early access'}
      </button>
      {status === 'error' && <p className="anc-wl-err">{error}</p>}
    </form>
  )
}
