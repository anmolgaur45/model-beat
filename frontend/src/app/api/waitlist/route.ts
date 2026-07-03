import { NextResponse } from 'next/server'
import sql from '@/lib/db'
import { checkRateLimit } from '@/lib/rate-limit'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Early-access waitlist capture (fake-door test for AI Stack Watch).
export async function POST(request: Request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  const { allowed, retryAfterSec } = checkRateLimit(`waitlist:${ip}`, {
    maxRequests: 5,
    windowMs: 60_000,
  })
  if (!allowed) {
    return NextResponse.json(
      { error: 'rate_limited' },
      { status: 429, headers: { 'Retry-After': String(retryAfterSec) } },
    )
  }

  let body: { email?: string; stack?: string; source?: string; website?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 })
  }

  // Honeypot: real users never fill the hidden "website" field; bots do. Soft-succeed.
  if (body.website) return NextResponse.json({ ok: true })

  const email = (body.email ?? '').trim().toLowerCase()
  if (!EMAIL_RE.test(email) || email.length > 254) {
    return NextResponse.json({ error: 'invalid_email' }, { status: 400 })
  }
  const stack = ((body.stack ?? '').trim().slice(0, 500)) || null
  const source = ((body.source ?? '').trim().slice(0, 50)) || 'stack-watch'

  try {
    // On a repeat email, upgrade the row toward the digest (the beehiiv export
    // filters on source LIKE 'digest%'): a plain DO NOTHING silently dropped a
    // digest signup from anyone already on the stack-watch waitlist, so they
    // were told "lands Thursday" but never made the export. Never downgrade a
    // digest subscriber back to a non-digest source.
    await sql`
      INSERT INTO waitlist (email, stack, source)
      VALUES (${email}, ${stack}, ${source})
      ON CONFLICT (lower(email)) DO UPDATE
        SET source = EXCLUDED.source,
            stack = COALESCE(EXCLUDED.stack, waitlist.stack)
        WHERE waitlist.source NOT LIKE 'digest%' AND EXCLUDED.source LIKE 'digest%'
    `
  } catch {
    return NextResponse.json({ error: 'server_error' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
