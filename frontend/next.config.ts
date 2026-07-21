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
    ]
  },
};

export default withSentryConfig(nextConfig, {
  silent: true,
  // only upload source maps when SENTRY_AUTH_TOKEN is present (CI/Vercel)
  sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
})
