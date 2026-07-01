'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { buildShareBlurb } from '@/lib/story'

function ShareIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M11 5.5a2 2 0 1 0-1.9-2.6L6 4.6a2 2 0 1 0 0 2.8l3.1 1.7A2 2 0 1 0 11 8.9L7.9 7.2a2 2 0 0 0 0-.4L11 5.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  )
}

// Our own share menu (not the native OS sheet): copy link, LinkedIn (copies a
// ready blurb to paste, since LinkedIn can't prefill the post body), X, and an
// optional "More…" that opens the native sheet where available. The panel is
// portaled to <body> so the card's overflow:hidden doesn't clip it.
export function SharePopover({
  headline,
  summary,
  path,
  className = '',
  showLabel = false,
}: {
  headline: string
  summary: string | null
  path: string
  className?: string
  showLabel?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null)
  const [copied, setCopied] = useState(false)
  const [liDone, setLiDone] = useState(false)
  const [canNative, setCanNative] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setCanNative(typeof navigator !== 'undefined' && !!navigator.share)
  }, [])

  const place = useCallback(() => {
    const r = btnRef.current?.getBoundingClientRect()
    if (r) setPos({ top: r.bottom + 6, right: Math.max(8, window.innerWidth - r.right) })
  }, [])

  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    if (!open) {
      place()
      setCopied(false)
      setLiDone(false)
    }
    setOpen((o) => !o)
  }

  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (!popRef.current?.contains(t) && !btnRef.current?.contains(t)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [open])

  const url = () => window.location.origin + path
  const stop = (e: React.MouseEvent) => e.stopPropagation()

  const copyLink = (e: React.MouseEvent) => {
    stop(e)
    navigator.clipboard?.writeText(url())
      .then(() => { setCopied(true); setTimeout(() => setOpen(false), 900) })
      .catch(() => setOpen(false))
  }
  const linkedin = (e: React.MouseEvent) => {
    stop(e)
    const u = url()
    navigator.clipboard?.writeText(buildShareBlurb(headline, summary, u)).catch(() => {})
    window.open(`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(u)}`, '_blank', 'noopener,noreferrer')
    setLiDone(true) // keep panel open with the paste hint
  }
  const xShare = (e: React.MouseEvent) => {
    stop(e)
    const u = url()
    window.open(`https://twitter.com/intent/tweet?url=${encodeURIComponent(u)}&text=${encodeURIComponent(headline)}`, '_blank', 'noopener,noreferrer')
    setOpen(false)
  }
  const native = (e: React.MouseEvent) => {
    stop(e)
    navigator.share({ title: headline, text: summary?.trim() || headline, url: url() }).catch(() => {})
    setOpen(false)
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={className}
        onClick={toggle}
        aria-label="Share this story"
        aria-haspopup="menu"
        aria-expanded={open}
        title="Share"
      >
        <ShareIcon />
        {showLabel && <span>Share</span>}
      </button>

      {open && pos && createPortal(
        <div
          ref={popRef}
          className="anc-sharepop"
          style={{ top: pos.top, right: pos.right }}
          onClick={stop}
          role="menu"
        >
          <button className="anc-sharepop-item" onClick={copyLink} role="menuitem">
            {copied ? 'Copied ✓' : 'Copy link'}
          </button>
          <button className="anc-sharepop-item" onClick={linkedin} role="menuitem">Share on LinkedIn</button>
          <button className="anc-sharepop-item" onClick={xShare} role="menuitem">Share on X</button>
          {canNative && (
            <button className="anc-sharepop-item" onClick={native} role="menuitem">More…</button>
          )}
          {liDone && (
            <div className="anc-sharepop-note">Summary copied — paste it into your LinkedIn post.</div>
          )}
        </div>,
        document.body,
      )}
    </>
  )
}
