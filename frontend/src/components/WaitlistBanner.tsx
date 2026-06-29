'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

const KEY = 'mb_sw_banner_dismissed'

// Dismissible promo strip for the Stack Watch waitlist. Renders nothing on the
// server / first client paint to avoid a hydration mismatch, then appears unless
// the visitor has dismissed it before.
export function WaitlistBanner() {
  const [show, setShow] = useState(false)

  useEffect(() => {
    try {
      if (localStorage.getItem(KEY) !== '1') setShow(true)
    } catch {
      setShow(true)
    }
  }, [])

  if (!show) return null

  return (
    <div className="anc-swbanner">
      <Link href="/stack-watch" className="anc-swbanner-link">
        <span className="anc-swbanner-dot" />
        <span className="anc-swbanner-text">
          New: get alerted when the models you use change — deprecations, price drops, better alternatives.
        </span>
        <span className="anc-swbanner-cta">Get early access →</span>
      </Link>
      <button
        className="anc-swbanner-x"
        aria-label="Dismiss"
        onClick={() => {
          try {
            localStorage.setItem(KEY, '1')
          } catch {}
          setShow(false)
        }}
      >
        ✕
      </button>
    </div>
  )
}
