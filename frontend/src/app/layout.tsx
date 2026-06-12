import type { Metadata } from 'next'
import { Geist, Geist_Mono, Bricolage_Grotesque } from 'next/font/google'
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
    default: 'AI News Calendar',
    template: '%s | AI News Calendar',
  },
  description:
    "Daily AI news organized by date, deduplicated and ranked by significance. Track model releases, research papers, and company news from the world's top AI sources.",
  keywords: ['AI news', 'artificial intelligence', 'machine learning', 'GPT', 'Claude', 'Gemini', 'LLM'],
  openGraph: {
    type: 'website',
    siteName: 'AI News Calendar',
    title: 'AI News Calendar',
    description: 'Daily AI news organized by date, deduplicated and ranked by significance.',
    images: [{ url: '/api/og', width: 1200, height: 630, alt: 'AI News Calendar' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'AI News Calendar',
    description: 'Daily AI news organized by date, deduplicated and ranked by significance.',
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
      </body>
    </html>
  )
}
