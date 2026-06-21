import Link from 'next/link'
import { BrandLockup } from '@/components/BrandLockup'

export function SiteFooter() {
  return (
    <footer className="anc-footer">
      <div className="anc-footer-inner">
        <div className="anc-footer-brand">
          <Link href="/" className="anc-footer-name" aria-label="Model Beat — Covering the AI beat, every day.">
            <BrandLockup tag />
          </Link>
          <p>The AI news that actually mattered — deduplicated, ranked by significance, every source cited.</p>
        </div>

        <nav className="anc-footer-col" aria-label="Site">
          <h2>Browse</h2>
          <Link href="/">Today</Link>
          <Link href="/models">Model tracker</Link>
        </nav>
      </div>
      <div className="anc-footer-base">© {new Date().getUTCFullYear()} Model Beat</div>
    </footer>
  )
}
