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
