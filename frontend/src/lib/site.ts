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
