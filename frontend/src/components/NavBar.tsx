'use client'

import { useEffect, useRef, useState } from 'react'

interface Props {
  theme: 'dark' | 'light'
  onToggleTheme: () => void
  query: string
  onQuery: (v: string) => void
}

export function NavBar({ theme, onToggleTheme, query, onQuery }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const lastY = useRef(0)
  const [navHidden, setNavHidden] = useState(false)
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const onScroll = () => {
      const y = window.scrollY
      setScrolled(y > 40)
      if (y > lastY.current && y > 80) {
        setNavHidden(true)
      } else if (y < lastY.current) {
        setNavHidden(false)
      }
      lastY.current = y
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        inputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  return (
    <div className={`anc-navwrap${navHidden ? ' nav-hidden' : ''}${scrolled ? ' nav-scrolled' : ''}`}>
      <nav className="anc-nav">
        <a className="anc-brand" href="#">
          <span className="anc-mark">
            <span className="anc-mark-dot" />
          </span>
          <span className="anc-brand-name">AI News Calendar</span>
        </a>

        <div className="anc-search">
          <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
            <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.4" />
            <path d="M9.5 9.5L13 13" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
          <input
            ref={inputRef}
            placeholder="Search the archive…"
            value={query}
            onChange={(e) => onQuery(e.target.value)}
          />
          {query && (
            <button className="anc-search-clear" onClick={() => onQuery('')} title="Clear search">
              ✕
            </button>
          )}
        </div>

        <button className="anc-theme-btn" onClick={onToggleTheme} title={theme === 'dark' ? 'Switch to light' : 'Switch to dark'}>
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
      </nav>
    </div>
  )
}
