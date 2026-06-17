import { ImageResponse } from 'next/og'

export const runtime = 'edge'

const ACCENT = '#3ad17f'
const ACCENT2 = '#3cc6d6'
const TAGLINE = 'Covering the AI beat, every day.'

// Equalizer bar heights (px) — mirrors the favicon/app-icon mark.
const BARS = [42, 90, 66, 108, 54]

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
  const params = new URL(req.url).searchParams
  const dateParam = params.get('date')
  const dateLabel = dateParam ? longDate(dateParam) : null
  const titleParam = params.get('title')?.slice(0, 60) || null

  const heading = titleParam ?? 'The AI news that actually mattered'
  const subtitle = titleParam
    ? 'Specs · benchmarks · news — on Model Beat'
    : dateLabel
      ? `The AI news that mattered · ${dateLabel}`
      : TAGLINE

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
          justifyContent: 'space-between',
          padding: '80px',
        }}
      >
        {/* Brand lockup: equalizer mark + ModelBeat wordmark */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 22 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, height: 120 }}>
            {BARS.map((h, i) => (
              <div
                key={i}
                style={{
                  width: 16,
                  height: h,
                  borderRadius: 8,
                  background: `linear-gradient(180deg, ${ACCENT}, ${ACCENT2})`,
                }}
              />
            ))}
          </div>
          <div style={{ display: 'flex', fontSize: 56, fontWeight: 700, letterSpacing: '-2px' }}>
            <span>Model</span>
            <span style={{ color: ACCENT }}>Beat</span>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div
            style={{
              fontSize: 68,
              fontWeight: 700,
              letterSpacing: '-2px',
              marginBottom: 22,
              lineHeight: 1.1,
            }}
          >
            {heading}
          </div>
          <div style={{ color: '#71717a', fontSize: 30, letterSpacing: '-0.5px' }}>
            {subtitle}
          </div>
        </div>
      </div>
    ),
    { width: 1200, height: 630 },
  )
}
