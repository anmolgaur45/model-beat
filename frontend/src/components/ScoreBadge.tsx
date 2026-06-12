'use client'

export type ScoreStyle = 'orb' | 'tile' | 'pill'

function scoreTier(score: number): 'high' | 'notable' | 'standard' {
  if (score >= 8.5) return 'high'
  if (score >= 7) return 'notable'
  return 'standard'
}

function ScoreRing({ score, size, sw }: { score: number; size: number; sw: number }) {
  const r = (size - sw) / 2
  const C = 2 * Math.PI * r
  const tier = scoreTier(score)
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line2)" strokeWidth={sw} />
      <circle
        cx={size / 2} cy={size / 2} r={r}
        fill="none"
        stroke={tier !== 'standard' ? 'var(--accent)' : 'var(--text3)'}
        strokeWidth={sw}
        strokeLinecap="round"
        strokeDasharray={C}
        strokeDashoffset={C * (1 - score / 10)}
      />
    </svg>
  )
}

interface Props {
  score: number
  style?: ScoreStyle
}

export function ScoreBadge({ score, style = 'orb' }: Props) {
  const tier = scoreTier(score)
  const display = Number.isInteger(score) ? score.toFixed(0) : score.toFixed(1)

  if (style === 'tile') {
    return (
      <span className={`anc-cscore style-tile ${tier}`}>{display}</span>
    )
  }

  if (style === 'pill') {
    return (
      <span className={`anc-cscore style-pill ${tier}`}>
        <span className="anc-pill-dot" />
        {display}
      </span>
    )
  }

  // orb (default)
  return (
    <span className={`anc-cscore style-orb ${tier}`}>
      <ScoreRing score={score} size={42} sw={2.5} />
      {display}
    </span>
  )
}

// Larger orb used in FeatureCard
export function ScoreOrbLarge({ score }: { score: number }) {
  const tier = scoreTier(score)
  const display = Number.isInteger(score) ? score.toFixed(0) : score.toFixed(1)
  return (
    <div className="anc-orb">
      <div>
        <div className="anc-orb-ring">
          <div className={tier !== 'standard' ? 'score-orb-glow' : undefined}
            style={{
              position: 'absolute', inset: -14, borderRadius: '50%',
              background: `radial-gradient(circle, oklch(0.78 0.19 var(--hue) / 0.3), transparent 70%)`,
              filter: 'blur(8px)',
              pointerEvents: 'none',
            }}
          />
          <svg
            className="anc-orb-svg"
            width="100%" height="100%"
            viewBox="0 0 86 86"
          >
            <circle cx={43} cy={43} r={38.5} fill="none" stroke="var(--line2)" strokeWidth={5} />
            <circle
              cx={43} cy={43} r={38.5}
              fill="none"
              stroke={tier !== 'standard' ? 'var(--accent)' : 'var(--text3)'}
              strokeWidth={5}
              strokeLinecap="round"
              strokeDasharray={2 * Math.PI * 38.5}
              strokeDashoffset={2 * Math.PI * 38.5 * (1 - score / 10)}
            />
          </svg>
          <span className="anc-orb-val">{display}</span>
        </div>
        <div className="anc-orb-cap">SIGNIFICANCE</div>
      </div>
    </div>
  )
}
