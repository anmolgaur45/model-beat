import type { Metadata } from 'next'
import { Geist, Geist_Mono, Bricolage_Grotesque } from 'next/font/google'
import { Analytics } from '@vercel/analytics/next'
import { SpeedInsights } from '@vercel/speed-insights/next'
import './globals.css'
import { Providers } from './providers'

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
  robots: { index: true, follow: true },
  icons: { icon: '/favicon.ico' },
}

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
        <Providers>{children}</Providers>
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  )
}
