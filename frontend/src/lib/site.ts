// Single source of truth for the canonical site URL.
//
// Prefers NEXT_PUBLIC_URL (set per-environment), but falls back to the real
// apex domain in production so a missing/blank env var can never emit
// localhost canonicals, sitemap URLs, or OG tags — which silently tanks SEO.
// The apex (themodelbeat.com) is the chosen canonical host; www 308-redirects
// to it at the edge.
const FALLBACK =
  process.env.NODE_ENV === 'production'
    ? 'https://themodelbeat.com'
    : 'http://localhost:3000'

export const SITE_URL = (process.env.NEXT_PUBLIC_URL || FALLBACK).replace(/\/+$/, '')

// Shared JSON-LD author entity. The @id anchors to the Person on /about (which
// carries the full sameAs profile links), so every NewsArticle byline across
// the site resolves to one credentialed entity instead of anonymous authorship.
export const AUTHOR_JSONLD = {
  '@type': 'Person',
  '@id': `${SITE_URL}/about#anmol-gaur`,
  name: 'Anmol Gaur',
} as const

// A page's share card (Open Graph + Twitter). Next replaces the layout's
// openGraph and twitter objects instead of merging them, so a page that set
// only a title shared with the homepage's title, and one that set openGraph
// without images shared with no image (2026-10-16 health check).
export function socialMeta(title: string, description: string, url: string) {
  // /api/og keeps 60 characters of the title; cut longer ones at a word.
  const card = title.length > 60 ? `${title.slice(0, 59).replace(/\s+\S*$/, '')}…` : title
  const image = `/api/og?title=${encodeURIComponent(card)}`
  return {
    openGraph: { type: 'website' as const, title, description, url, images: [{ url: image, width: 1200, height: 630 }] },
    twitter: { card: 'summary_large_image' as const, title, description, images: [image] },
  }
}
