import * as Sentry from '@sentry/nextjs'

// Sentry never ran before this file existed: since Next 15 the server and edge
// configs are only loaded from register(). Server-side only by choice
// (2026-10-16): browser reporting would add JavaScript to every page. The old
// sentry.client.config.ts was deleted on 2026-10-19: Turbopack ignored it, but
// a webpack build would have injected it and turned browser reporting on.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('../sentry.server.config')
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('../sentry.edge.config')
  }
}

export const onRequestError = Sentry.captureRequestError
