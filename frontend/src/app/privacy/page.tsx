import type { Metadata } from 'next'
import Link from 'next/link'
import { SITE_URL } from '@/lib/site'
import { NavBar } from '@/components/NavBar'

const SITE = SITE_URL
const CONTACT = 'anmolgaur45@gmail.com'
const UPDATED = 'June 29, 2026'

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description: 'How Model Beat handles your data: what we collect, why, and how to have it removed.',
  alternates: { canonical: `${SITE}/privacy` },
}

export default function PrivacyPage() {
  return (
    <div className="aurora-stage">
      <div className="aurora-layer">
        <div className="aurora-blob aurora-blob-1" />
        <div className="aurora-blob aurora-blob-2" />
        <div className="aurora-blob aurora-blob-3" />
      </div>

      <NavBar />

      <main className="anc-legal">
        <Link className="anc-day-back" href="/">← Back to Model Beat</Link>
        <div className="anc-kicker">Legal</div>
        <h1>Privacy Policy</h1>
        <p className="anc-legal-updated">Last updated {UPDATED}</p>

        <h2>What we collect</h2>
        <p>
          If you join the Stack Watch waitlist, we store your email and, optionally, the note you add
          about which models or tools you use. We also collect anonymous, privacy-friendly usage
          analytics. We don&rsquo;t have accounts and we don&rsquo;t take payments.
        </p>

        <h2>How we use it</h2>
        <p>
          To email you about Stack Watch, the feature you signed up for, and to understand what people
          need so we can improve the site. Nothing else.
        </p>

        <h2>Sharing</h2>
        <p>
          We don&rsquo;t sell, trade, or share your data with advertisers. A few service providers process
          it on our behalf, such as our hosting and analytics (Vercel) and our database (Google Cloud).
        </p>

        <h2>Cookies</h2>
        <p>
          We don&rsquo;t use tracking or advertising cookies. The site uses your browser&rsquo;s local storage
          only for preferences like the theme and dismissing a banner.
        </p>

        <h2>Contact and your choices</h2>
        <p>
          You can ask us to show you or delete your data at any time, or to leave the waitlist, and
          every email we send includes an unsubscribe link. Reach us at{' '}
          <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.
        </p>
      </main>
    </div>
  )
}
