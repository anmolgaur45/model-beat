import { ImageResponse } from 'next/og'

export const runtime = 'edge'

const CATEGORY_COLORS = [
  '#3b82f6', // blue — models
  '#8b5cf6', // violet — research
  '#f59e0b', // amber — companies
  '#22c55e', // green — products
  '#ef4444', // red — policy
  '#f97316', // orange — hardware
  '#10b981', // emerald — open source
  '#71717a', // zinc — opinion
]

function longDate(date: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null
  const d = new Date(date + 'T12:00:00Z')
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

export async function GET(req: Request) {
  const dateParam = new URL(req.url).searchParams.get('date')
  const dateLabel = dateParam ? longDate(dateParam) : null

  const subtitle = dateLabel
    ? `The AI news that mattered · ${dateLabel}`
    : 'Daily AI news · Deduplicated · Ranked by significance'

  return new ImageResponse(
    (
      <div
        style={{
          background: '#09090b',
          color: '#f4f4f5',
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: '80px',
        }}
      >
        <div
          style={{
            fontSize: 72,
            fontWeight: 700,
            letterSpacing: '-2px',
            marginBottom: 24,
            lineHeight: 1.1,
          }}
        >
          AI News Calendar
        </div>
        <div style={{ color: '#71717a', fontSize: 30, letterSpacing: '-0.5px' }}>
          {subtitle}
        </div>
        {/* Category colour strip */}
        <div style={{ display: 'flex', gap: 10, marginTop: 72 }}>
          {CATEGORY_COLORS.map((c, i) => (
            <div
              key={i}
              style={{ width: 52, height: 6, borderRadius: 3, background: c }}
            />
          ))}
        </div>
      </div>
    ),
    { width: 1200, height: 630 },
  )
}
