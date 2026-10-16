import * as Sentry from '@sentry/nextjs'

// Errors only. Tracing is left off: every crawler hit would be a candidate
// transaction, and its per-request overhead lands on the story pages.
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  debug: false,
})
