'use client'

import { useState, useEffect } from 'react'

export function useTheme() {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark')

  // The <html> attribute is the single source of truth (stamped pre-paint by
  // the inline script in layout.tsx). On mount we only READ it — an effect
  // that also wrote DOM/localStorage from state raced against this adoption
  // on remounts (every page switch), flipping light users back to dark.
  useEffect(() => {
    if (document.documentElement.getAttribute('data-theme') === 'light') setTheme('light')
  }, [])

  // Writes happen exclusively on user action.
  const toggle = () => {
    const next = theme === 'dark' ? 'light' : 'dark'
    document.documentElement.setAttribute('data-theme', next)
    try { localStorage.setItem('anc-theme', next) } catch { /* private mode */ }
    setTheme(next)
  }

  return { theme, toggle }
}
