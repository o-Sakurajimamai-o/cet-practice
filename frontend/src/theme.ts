import { useEffect, useState } from 'react'

export type Theme = 'light' | 'dark'
const EVENT = 'cet6-theme-change'

function apply(theme: Theme) {
  document.documentElement.dataset.theme = theme
  document.documentElement.style.colorScheme = theme
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#0d0f14' : '#f5f4ef')
}

/** Shared light/dark state so the sidebar and the practice toolbar stay in sync. */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light')
  useEffect(() => {
    const onChange = (e: Event) => setTheme((e as CustomEvent<Theme>).detail)
    window.addEventListener(EVENT, onChange)
    return () => window.removeEventListener(EVENT, onChange)
  }, [])
  function toggle() {
    const next: Theme = theme === 'dark' ? 'light' : 'dark'
    apply(next)
    try { localStorage.setItem('cet6-theme', next) } catch { /* The current theme still works when storage is unavailable. */ }
    window.dispatchEvent(new CustomEvent(EVENT, { detail: next }))
  }
  return { theme, toggle }
}
