import type { NextConfig } from "next";
import { withSentryConfig } from '@sentry/nextjs'

const isDev = process.env.NODE_ENV !== 'production'

const securityHeaders = [
  // DENY matches frame-ancestors 'none' in CSP below
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-DNS-Prefetch-Control', value: 'on' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), bluetooth=(), accelerometer=(), gyroscope=()' },
  // HSTS only in production (the site is HTTPS there). Never in dev: sending it
  // over plain-HTTP LAN/localhost poisons the browser into force-upgrading every
  // request to HTTPS, which breaks JS/XHR loading on phones testing over the LAN.
  ...(isDev
    ? []
    : [{
        key: 'Strict-Transport-Security',
        value: 'max-age=63072000; includeSubDomains; preload',
      }]),
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      // unsafe-inline needed for Next.js hydration chunks; unsafe-eval only in dev (HMR)
      isDev ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'" : "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "font-src 'self' data:",
      // google.com for s2/favicons proxy used in StoryCard
      "img-src 'self' data: https://www.google.com",
      "connect-src 'self' https://*.sentry.io",
      "frame-ancestors 'none'",
    ].join('; '),
  },
]

const nextConfig: NextConfig = {
  // For the contingency Docker image (see Dockerfile); Vercel ignores this.
  output: 'standalone',
  productionBrowserSourceMaps: false,
  // Digest issue markdown (Phase W4) is read with fs at render time when a
  // revalidate re-renders these routes on Vercel; without explicit tracing
  // the .md files wouldn't ship in the serverless bundle (ENOENT).
  outputFileTracingIncludes: {
    '/digest': ['./content/digest/**'],
    '/digest/archive': ['./content/digest/**'],
    '/digest/[date]': ['./content/digest/**'],
    '/sitemap.xml': ['./content/digest/**'],
  },
  // Allow the dev server's client runtime (HMR, React Refresh) to load when the
  // app is opened from a phone on the LAN. Without this, Next.js blocks those
  // dev resources cross-origin and the page renders but never hydrates — no data
  // fetches, dead buttons. Dev-only; ignored in production. Update the IP if your
  // LAN address changes (see the "Network:" URL printed by `pnpm dev`).
  allowedDevOrigins: ['192.168.0.103'],
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: securityHeaders,
      },
      {
        // Story pages are `force-dynamic`, so every hit ran a DB-backed render.
        // Measured 2026-09-01: crawlers were driving 65-90 req/min, 90-98% of it
        // /story/*, and re-fetching the SAME page ~4-6 times within minutes (249
        // requests across 60 distinct stories in one sample). That is what kept
        // exhausting Cloud SQL's connection ceiling.
        //
        // `Vercel-CDN-Cache-Control` is deliberate, not `Cache-Control`: it is the
        // ONLY one of the three that outranks the `private, no-store` header
        // force-dynamic returns from the function, and it applies to Vercel's CDN
        // alone, so browsers still receive no-store and see a fresh render.
        //
        // This is the CDN cache, NOT ISR. It costs zero ISR writes, so the 200k
        // Hobby budget that paused the project in July is untouched and the
        // zero-ISR architecture still holds. Pages stay dynamic; repeat hits
        // within the window simply never reach the function.
        //
        // 300s is chosen against the pipeline's 3h cadence: a story can only
        // change when a run re-clusters or re-summarises it, so 5 minutes of
        // staleness is invisible while still collapsing every crawler burst.
        // stale-if-error keeps stories served through a DB outage.
        source: '/story/:path*',
        headers: [
          {
            key: 'Vercel-CDN-Cache-Control',
            value: 'max-age=300, stale-while-revalidate=1800, stale-if-error=86400',
          },
        ],
      },
      {
        // The compare hub reads searchParams, so it is dynamic: every hit ran
        // ~6 queries (40-50 renders an hour, 2026-10-16 health check). Same CDN
        // cache as /story; each ?ids= selection is its own cache entry. Model
        // data moves every 3h at most, so an hour of staleness is invisible.
        source: '/models/compare',
        headers: [
          {
            key: 'Vercel-CDN-Cache-Control',
            value: 'max-age=3600, stale-while-revalidate=86400, stale-if-error=86400',
          },
        ],
      },
      // The sitemap, both RSS feeds and llms.txt are force-dynamic behind the
      // same 1h CDN cache. As build-time static files they never refreshed:
      // revalidatePath and `revalidate = 3600` both left the sitemap's build
      // copy in place for days (2026-10-16 health check). An hour of staleness
      // is fine for crawlers and feed readers, and stale-if-error keeps the last
      // good copy up through a DB outage.
      ...['/sitemap.xml', '/feed.xml', '/llms.txt', '/models/changes/rss'].map((source) => ({
        source,
        headers: [
          {
            key: 'Vercel-CDN-Cache-Control',
            value: 'max-age=3600, stale-while-revalidate=86400, stale-if-error=86400',
          },
        ],
      })),
    ]
  },
};

export default withSentryConfig(nextConfig, {
  silent: true,
  // only upload source maps when SENTRY_AUTH_TOKEN is present (CI/Vercel)
  sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
})
