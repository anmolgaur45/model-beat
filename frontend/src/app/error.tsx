'use client'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div className="aurora-stage" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', padding: '24px' }}>
      <div className="anc-statebox error" style={{ maxWidth: 440 }}>
        <div className="anc-statebox-glyph">
          <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
            <path d="M11 7v5M11 15.5v.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
            <path d="M9.3 3.4c.75-1.3 2.65-1.3 3.4 0l6.5 11.2c.76 1.3-.18 2.9-1.7 2.9H4.5c-1.52 0-2.46-1.6-1.7-2.9l6.5-11.2z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
          </svg>
        </div>
        <h3>Signal lost</h3>
        <p>{"We couldn't load the feed. The connection dropped or the server is having a moment."}</p>
        <button className="anc-statebox-act" onClick={reset}>Retry</button>
      </div>
    </div>
  )
}
