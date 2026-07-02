import Link from 'next/link'
import { BrandLockup } from '@/components/BrandLockup'
import { DigestForm } from '@/components/DigestForm'

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
          <Link href="/">News</Link>
          <Link href="/models">Models</Link>
          <Link href="/digest">Digest</Link>
          <Link href="/privacy">Privacy Policy</Link>
        </nav>

        <div className="anc-footer-col anc-footer-digest">
          <h2>The weekly digest</h2>
          <p>The week in AI models: top stories, price moves, deprecations. Thursdays, free.</p>
          <DigestForm source="digest-footer" compact />
        </div>
      </div>
      <div className="anc-footer-base">© {new Date().getUTCFullYear()} Model Beat</div>
    </footer>
  )
}
