'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'

import type { ScoreReceipt } from '@/lib/scoreReceipt'

export type ScoreStyle = 'orb' | 'tile' | 'pill'
export type { ScoreReceipt }

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

// The receipt popover body, shared by the small badge and the large orb.
function ReceiptPanel({
  ref, score, receipt, style, onMouseEnter, onMouseLeave,
}: {
  ref?: React.Ref<HTMLDivElement>
  score: number
  receipt: ScoreReceipt
  style?: React.CSSProperties
  onMouseEnter?: () => void
  onMouseLeave?: () => void
}) {
  const display = Number.isInteger(score) ? score.toFixed(0) : score.toFixed(1)
  const sources = receipt.topSources.slice(0, 3)
  return (
    <div
      ref={ref}
      className="anc-spop"
      style={style}
      role="dialog"
      aria-label="How this score was computed"
      onClick={(e) => e.stopPropagation()}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className="anc-spop-head">Significance {display}/10</div>
      <div className="anc-spop-row">
        {receipt.articleCount} {receipt.articleCount === 1 ? 'article' : 'articles'} across{' '}
        {receipt.sourceCount} {receipt.sourceCount === 1 ? 'source' : 'sources'}
      </div>
      {sources.length > 0 && (
        <div className="anc-spop-row">
          {receipt.sourceCount > sources.length ? 'Leading coverage: ' : 'Coverage: '}
          {sources.join(', ')}
        </div>
      )}
      {receipt.maxImpact != null && (
        <div className="anc-spop-row">Content impact {receipt.maxImpact}/10, AI-rated</div>
      )}
      <div className="anc-spop-note">
        Scores weigh independent, authoritative coverage over raw article counts.
      </div>
      <Link href="/methodology" className="anc-spop-link" onClick={(e) => e.stopPropagation()}>
        How scoring works →
      </Link>
    </div>
  )
}

// Wraps a badge in a receipt that opens on hover, keyboard focus, or tap.
// Hover is the primary trigger (discoverability: an unexplained score people
// scroll past defeats the purpose); focus covers keyboards, click covers touch.
// The panel is PORTALED to <body> and position:fixed: the score badges live
// inside cards that both clip overflow AND get a transform on hover, and a
// transformed ancestor makes position:fixed resolve to the card, not the
// viewport. Portaling escapes both. A short close delay plus invisible CSS
// bridges keep it open while the cursor crosses the gap onto the panel.
const PANEL_H = 200 // approx; used only to decide flip-above near the viewport foot

function ReceiptWrap({
  score, receipt, className, children,
}: { score: number; receipt: ScoreReceipt; className?: string; children: React.ReactNode }) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const ref = useRef<HTMLSpanElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const open = pos !== null

  const place = () => {
    const wrap = ref.current
    if (!wrap) return
    // Anchor to the ring, not the whole button — the large orb's button also
    // wraps the "SIGNIFICANCE" caption, which would push the panel too low.
    const anchor =
      (wrap.querySelector('.anc-orb-ring') as HTMLElement | null) ??
      (wrap.querySelector('.anc-spop-btn') as HTMLElement | null)
    if (!anchor) return
    const r = anchor.getBoundingClientRect()
    const left = Math.min(r.left, Math.max(8, window.innerWidth - 258))
    const below = r.bottom + 4
    // Flip above when there isn't room beneath the score.
    const top = below + PANEL_H > window.innerHeight ? r.top - PANEL_H - 4 : below
    setPos({ top: Math.max(8, top), left })
  }

  const cancelClose = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    closeTimer.current = null
  }
  const scheduleClose = () => {
    cancelClose()
    // Generous enough to cross the 4px gap from orb to panel before it closes.
    closeTimer.current = setTimeout(() => setPos(null), 220)
  }

  useEffect(() => {
    if (!open) return
    const close = () => setPos(null)
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node
      // The panel is portaled out of the wrap, so check both.
      if (ref.current?.contains(t) || panelRef.current?.contains(t)) return
      close()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [open])

  return (
    <span
      className={`anc-spop-wrap${className ? ` ${className}` : ''}`}
      ref={ref}
      onMouseEnter={() => { cancelClose(); place() }}
      onMouseLeave={scheduleClose}
    >
      <button
        type="button"
        className="anc-spop-btn"
        aria-expanded={open}
        aria-label={`Significance score ${score} out of 10. Show how it was computed.`}
        onFocus={place}
        onBlur={scheduleClose}
        // Always open (never toggle): on touch, focus + click both fire on one
        // tap, so a toggle would open-then-close and the panel would never show.
        // Dismissal is by tap-outside, mouseleave, or Escape.
        onClick={(e) => { e.stopPropagation(); place() }}
      >
        {children}
      </button>
      {open && createPortal(
        <ReceiptPanel
          ref={panelRef}
          score={score}
          receipt={receipt}
          style={{ position: 'fixed', top: pos.top, left: pos.left }}
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
        />,
        document.body,
      )}
    </span>
  )
}

interface Props {
  score: number
  style?: ScoreStyle
  receipt?: ScoreReceipt
}

export function ScoreBadge({ score, style = 'orb', receipt }: Props) {
  const tier = scoreTier(score)
  const display = Number.isInteger(score) ? score.toFixed(0) : score.toFixed(1)

  let badge: React.ReactNode
  if (style === 'tile') {
    badge = <span className={`anc-cscore style-tile ${tier}`}>{display}</span>
  } else if (style === 'pill') {
    badge = (
      <span className={`anc-cscore style-pill ${tier}`}>
        <span className="anc-pill-dot" />
        {display}
      </span>
    )
  } else {
    badge = (
      <span className={`anc-cscore style-orb ${tier}`}>
        <ScoreRing score={score} size={42} sw={2.5} />
        {display}
      </span>
    )
  }

  if (!receipt) return badge
  return <ReceiptWrap score={score} receipt={receipt}>{badge}</ReceiptWrap>
}

// Larger orb used in FeatureCard. Always accent-colored: this orb only exists
// on the day's TOP STORY card, and a gray ring there (any lead scoring < 7)
// made the hero card read as dead. The small per-row orbs keep tier honesty.
export function ScoreOrbLarge({ score, receipt }: { score: number; receipt?: ScoreReceipt }) {
  const tier = scoreTier(score)
  const display = Number.isInteger(score) ? score.toFixed(0) : score.toFixed(1)
  const orb = (
    <div className="anc-orb">
      <div>
        <div className="anc-orb-ring">
          <div className={tier !== 'standard' ? 'score-orb-glow' : undefined}
            style={{
              position: 'absolute', inset: -14, borderRadius: '50%',
              background: `radial-gradient(circle, color-mix(in srgb, var(--accent-strong) 30%, transparent), transparent 70%)`,
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
              stroke="var(--accent)"
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

  if (!receipt) return orb
  return <ReceiptWrap score={score} receipt={receipt} className="anc-spop-wrap-lg">{orb}</ReceiptWrap>
}

