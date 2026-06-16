import type { Metadata } from 'next'
import { Geist, Geist_Mono, Bricolage_Grotesque } from 'next/font/google'
import { Analytics } from '@vercel/analytics/next'
import { SpeedInsights } from '@vercel/speed-insights/next'
import './globals.css'
import { Providers } from './providers'
import { SiteFooter } from '@/components/SiteFooter'

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
  metadataBase: new URL(process.env.NEXT_PUBLIC_URL ?? 'http://localhost:3000'),
  title: {
    default: 'AI News Calendar — the AI news that actually mattered',
    template: '%s | AI News Calendar',
  },
  description:
    'The AI news that actually mattered, organized by day — deduplicated across sources, ranked by significance, every story cited. Track model releases, research, and company news from the top AI labs.',
  keywords: ['AI news', 'artificial intelligence', 'machine learning', 'GPT', 'Claude', 'Gemini', 'LLM'],
  alternates: {
    canonical: '/',
    types: { 'application/rss+xml': '/feed.xml' },
  },
  openGraph: {
    type: 'website',
    siteName: 'AI News Calendar',
    title: 'AI News Calendar — the AI news that actually mattered',
    description: 'The AI news that actually mattered, organized by day — deduplicated, ranked by significance, every source cited.',
    images: [{ url: '/api/og', width: 1200, height: 630, alt: 'AI News Calendar' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'AI News Calendar — the AI news that actually mattered',
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
  icons: { icon: '/favicon.ico' },
}

const SITE = process.env.NEXT_PUBLIC_URL ?? 'http://localhost:3000'

const SITE_JSONLD = [
  {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'AI News Calendar',
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
    name: 'AI News Calendar',
    url: SITE,
    logo: `${SITE}/api/og`,
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
