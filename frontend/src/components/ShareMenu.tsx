'use client'

import { useEffect, useState } from 'react'
import { buildShareBlurb } from '@/lib/story'

// Share controls for a story permalink. LinkedIn dropped third-party post-body
// prefill, so we copy a ready blurb to the clipboard and open the composer for a
// one-paste share. X still supports text prefill via ?text=. Native share
// appears on devices that support it.
export function ShareMenu({ url, title, summary }: { url: string; title: string; summary?: string | null }) {
  const [copied, setCopied] = useState(false)
  const [liCopied, setLiCopied] = useState(false)
  const [canNativeShare, setCanNativeShare] = useState(false)

  useEffect(() => {
    setCanNativeShare(typeof navigator !== 'undefined' && !!navigator.share)
  }, [])

  const enc = encodeURIComponent(url)
  const x = `https://twitter.com/intent/tweet?url=${enc}&text=${encodeURIComponent(title)}`

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1400)
    } catch {
      /* clipboard blocked — no-op */
    }
  }

  const shareLinkedIn = () => {
    // Fire the copy (not awaited) so window.open stays inside the user gesture
    // and isn't blocked as a popup.
    const blurb = buildShareBlurb(title, summary ?? null, url)
    navigator.clipboard?.writeText(blurb)
      .then(() => {
        setLiCopied(true)
        setTimeout(() => setLiCopied(false), 5000)
      })
      .catch(() => {})
    window.open(`https://www.linkedin.com/sharing/share-offsite/?url=${enc}`, '_blank', 'noopener,noreferrer')
  }

  const nativeShare = async () => {
    try {
      await navigator.share({ title, text: summary?.trim() || title, url })
    } catch {
      /* dismissed — no-op */
    }
  }

  return (
    <div className="anc-sharewrap">
      <div className="anc-share">
        <button className={`anc-share-btn${copied ? ' copied' : ''}`} onClick={copyLink} type="button">
          {copied ? 'Copied' : 'Copy link'}
        </button>
        <button className="anc-share-btn" onClick={shareLinkedIn} type="button">LinkedIn</button>
        <a className="anc-share-btn" href={x} target="_blank" rel="noopener noreferrer">X</a>
        {canNativeShare && (
          <button className="anc-share-btn" onClick={nativeShare} type="button">Share…</button>
        )}
      </div>
      {liCopied && (
        <p className="anc-share-note">Summary copied — paste it into your LinkedIn post (Ctrl/Cmd+V).</p>
      )}
    </div>
  )
}
