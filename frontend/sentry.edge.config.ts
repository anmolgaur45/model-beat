import * as Sentry from '@sentry/nextjs'

// Errors only, same as the server config.
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  debug: false,
})
