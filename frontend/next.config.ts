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
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
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
  productionBrowserSourceMaps: false,
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
