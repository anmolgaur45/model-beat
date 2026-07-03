import type { Metadata } from 'next'
import { Geist, Geist_Mono, Bricolage_Grotesque } from 'next/font/google'
import { Analytics } from '@vercel/analytics/next'
import { SpeedInsights } from '@vercel/speed-insights/next'
import './globals.css'
import { Providers } from './providers'
import { SiteFooter } from '@/components/SiteFooter'
import { SITE_URL } from '@/lib/site'

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
})

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
})

const bricolage = Bricolage_Grotesque({
  variable: '--font-bricolage',
  subsets: ['latin'],
  axes: ['opsz', 'wdth'],
})

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'Model Beat — Covering the AI beat, every day.',
    template: '%s | Model Beat',
  },
  description:
    'AI news that actually mattered, organized by day — deduplicated across sources and ranked by significance, plus a model tracker for benchmarks and pricing.',
  keywords: ['AI news', 'artificial intelligence', 'machine learning', 'GPT', 'Claude', 'Gemini', 'LLM'],
  alternates: {
    canonical: '/',
    types: { 'application/rss+xml': '/feed.xml' },
  },
  openGraph: {
    type: 'website',
    siteName: 'Model Beat',
    title: 'Model Beat — Covering the AI beat, every day.',
    description: 'The AI news that actually mattered, organized by day — deduplicated, ranked by significance, every source cited.',
    images: [{ url: '/api/og', width: 1200, height: 630, alt: 'Model Beat' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Model Beat — Covering the AI beat, every day.',
    description: 'The AI news that actually mattered, organized by day — deduplicated, ranked by significance, every source cited.',
    images: ['/api/og'],
  },
  robots: {
    index: true,
    follow: true,
    // News/Discover: let Google show the largest image preview and full snippet
    googleBot: {
      index: true,
      follow: true,
      'max-image-preview': 'large',
      'max-snippet': -1,
      'max-video-preview': -1,
    },
  },
  // Model Beat equalizer mark as the browser-tab favicon (the default
  // app/favicon.ico was removed so it can't override this). SVG favicons are
  // supported by all current browsers.
  icons: {
    icon: [{ url: '/favicon-eq.svg', type: 'image/svg+xml' }],
    apple: '/icon-eq.svg',
  },
}

const SITE = SITE_URL

const SITE_JSONLD = [
  {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'Model Beat',
    url: SITE,
    description:
      'The AI news that actually mattered, organized by day — deduplicated across sources, ranked by significance, every story cited.',
    potentialAction: {
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: `${SITE}/?q={search_term_string}`,
      },
      'query-input': 'required name=search_term_string',
    },
  },
  {
    '@context': 'https://schema.org',
    '@type': 'NewsMediaOrganization',
    name: 'Model Beat',
    url: SITE,
    logo: `${SITE}/api/og`,
    // E-E-A-T: a named operator and reachable contact make the site citable to
    // answer engines.
    founder: {
      '@type': 'Person',
      name: 'Anmol Gaur',
      url: `${SITE}/about`,
      sameAs: ['https://github.com/anmolgaur45', 'https://www.linkedin.com/in/anmolgaur45/', 'https://x.com/0xanmolgaur'],
    },
    sameAs: ['https://github.com/anmolgaur45', 'https://www.linkedin.com/in/anmolgaur45/', 'https://x.com/0xanmolgaur'],
    contactPoint: {
      '@type': 'ContactPoint',
      contactType: 'editorial',
      email: 'anmolgaur45@gmail.com',
    },
  },
]

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      data-theme="dark"
      className={`${geistSans.variable} ${geistMono.variable} ${bricolage.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full" suppressHydrationWarning>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(SITE_JSONLD) }}
        />
        <Providers>{children}</Providers>
        <SiteFooter />
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  )
}
