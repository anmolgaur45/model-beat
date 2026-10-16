import * as Sentry from '@sentry/nextjs'

// Sentry never ran before this file existed: since Next 15 the server and edge
// configs are only loaded from register(), and Turbopack builds ignore
// sentry.client.config.ts. Server-side only by choice (2026-10-16): browser
// reporting would add JavaScript to every page.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('../sentry.server.config')
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('../sentry.edge.config')
  }
}

export const onRequestError = Sentry.captureRequestError
