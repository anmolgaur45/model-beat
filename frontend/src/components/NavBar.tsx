'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useTheme } from '@/hooks/useTheme'
import { BrandLockup } from '@/components/BrandLockup'

interface Props {
  // Home passes its archive-search state; other pages omit it (no search box).
  query?: string
  onQuery?: (v: string) => void
  // Home passes this so clicking the brand while already on "/" resets the view
  // (exits recap/search) instead of being a no-op same-route navigation.
  onHome?: () => void
}

// Uniform site nav used across home, /models, /models/compare, and the day
// archive. Owns the theme toggle (via useTheme) and highlights the active
// section, so it drops into server pages without prop threading. The model
// detail page keeps its own breadcrumb header by design.
export function NavBar({ query = '', onQuery, onHome }: Props) {
  const { theme, toggle } = useTheme()
  const pathname = usePathname() ?? '/'
  const inputRef = useRef<HTMLInputElement>(null)
  const lastY = useRef(0)
  const [navHidden, setNavHidden] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const showSearch = !!onQuery

  useEffect(() => {
    const onScroll = () => {
      const y = window.scrollY
      setScrolled(y > 40)
      if (y > lastY.current && y > 80) setNavHidden(true)
      else if (y < lastY.current) setNavHidden(false)
      lastY.current = y
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    if (!showSearch) return
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        inputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [showSearch])

  const isModels = pathname.startsWith('/models')
  const isDigest = pathname.startsWith('/digest')
  const isNews = !isModels && !isDigest

  return (
    <div className={`anc-navwrap${navHidden ? ' nav-hidden' : ''}${scrolled ? ' nav-scrolled' : ''}`}>
      <nav className="anc-nav">
        <Link
          className="anc-brand"
          href="/"
          aria-label="Model Beat — Covering the AI beat, every day."
          onClick={() => {
            // Same-route Link clicks are no-ops, so reset the home view directly.
            if (pathname === '/' && onHome) {
              onHome()
              window.scrollTo({ top: 0 })
            }
          }}
        >
          <BrandLockup sm />
        </Link>

        {showSearch ? (
          <div className="anc-search">
            <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
              <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.4" />
              <path d="M9.5 9.5L13 13" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
            <input
              ref={inputRef}
              placeholder="Search the archive…"
              value={query}
              onChange={(e) => onQuery?.(e.target.value)}
            />
            {query && (
              <button className="anc-search-clear" onClick={() => onQuery?.('')} title="Clear search">✕</button>
            )}
          </div>
        ) : (
          <span className="anc-navspacer" />
        )}

        {/* Right cluster stays together as one non-shrinking group so the theme
            toggle is never pushed out of the pill; the brand truncates first. */}
        <div className="anc-navactions">
          <Link className={`anc-navlink${isNews ? ' is-active' : ''}`} href="/">News</Link>
          <Link className={`anc-navlink${isModels ? ' is-active' : ''}`} href="/models">Models</Link>
          <Link className={`anc-navlink${isDigest ? ' is-active' : ''}`} href="/digest">Digest</Link>

          <button
            className="anc-theme-btn"
            onClick={toggle}
            title={theme === 'dark' ? 'Switch to light' : 'Switch to dark'}
            aria-label="Toggle theme"
          >
            {theme === 'dark' ? (
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="8" r="3.2" stroke="currentColor" strokeWidth="1.4" />
                <path d="M8 1.5v1.8M8 12.7v1.8M1.5 8h1.8M12.7 8h1.8M3.4 3.4l1.3 1.3M11.3 11.3l1.3 1.3M12.6 3.4l-1.3 1.3M4.7 11.3l-1.3 1.3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
            ) : (
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
                <path d="M13.5 9.5A5.5 5.5 0 1 1 6.5 2.5a4.5 4.5 0 0 0 7 7z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
              </svg>
            )}
          </button>
        </div>
      </nav>
    </div>
  )
}
