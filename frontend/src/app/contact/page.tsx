import type { Metadata } from 'next'
import Link from 'next/link'
import { SITE_URL } from '@/lib/site'
import { NavBar } from '@/components/NavBar'

const SITE = SITE_URL
const CONTACT = 'anmolgaur45@gmail.com'

export const metadata: Metadata = {
  title: 'Contact',
  description: 'How to reach Anmol Gaur, who runs Model Beat: corrections, questions, sponsorships, and everything else.',
  alternates: { canonical: `${SITE}/contact` },
}

export default function ContactPage() {
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
        <div className="anc-kicker">Contact</div>
        <h1>Reach a human</h1>

        <p>
          Model Beat is run by <Link href="/about">Anmol Gaur</Link>. Email is the fastest route and
          every message gets read:
        </p>
        <p>
          <a href={`mailto:${CONTACT}`}>{CONTACT}</a>
        </p>

        <h2>What to write about</h2>
        <p>
          Corrections first, always: if a score, price, or headline is wrong, say so and it gets
          fixed. Also welcome: questions about the <Link href="/methodology">methodology</Link>,
          source suggestions, digest sponsorship inquiries, and anything that seems broken.
        </p>

        <h2>Elsewhere</h2>
        <p>
          You can also find Anmol on <a href="https://x.com/0xanmolgaur" target="_blank" rel="noopener noreferrer">X</a>,{' '}
          <a href="https://www.linkedin.com/in/anmolgaur45/" target="_blank" rel="noopener noreferrer">LinkedIn</a>, and{' '}
          <a href="https://github.com/anmolgaur45" target="_blank" rel="noopener noreferrer">GitHub</a>, or reply to any
          issue of the <Link href="/digest">digest</Link>.
        </p>
      </main>
    </div>
  )
}
