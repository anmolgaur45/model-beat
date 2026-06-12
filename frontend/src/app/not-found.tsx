import Link from 'next/link'

export default function NotFound() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', padding: '24px' }}>
      <div className="anc-statebox" style={{ maxWidth: 440 }}>
        <div className="anc-statebox-glyph">
          <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
            <circle cx="9.5" cy="9.5" r="6.5" stroke="currentColor" strokeWidth="1.5" />
            <path d="M14.5 14.5L19 19" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </div>
        <h3>Page not found</h3>
        <p>This page doesn&apos;t exist.</p>
        <Link href="/">
          <button className="anc-statebox-act">Back to home</button>
        </Link>
      </div>
    </div>
  )
}
