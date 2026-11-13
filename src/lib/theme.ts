export type Theme = 'light' | 'dark'

const THEME_STORAGE = 'mq_theme'

/** Browser chrome (address bar) tint per theme — kept in sync by applyTheme. */
const THEME_COLOR: Record<Theme, string> = { light: '#ffffff', dark: '#171717' }

/** OS-level preference; used when the user hasn't explicitly chosen. */
export function preferredTheme(): Theme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

/** Explicit user choice wins; otherwise follow the OS. */
export function getInitialTheme(): Theme {
  const stored = localStorage.getItem(THEME_STORAGE)
  if (stored === 'light' || stored === 'dark') return stored
  return preferredTheme()
}

/** Applies the theme to <html> (Tailwind's class-based dark variant) and remembers it. */
export function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle('dark', theme === 'dark')
  localStorage.setItem(THEME_STORAGE, theme)
  // Keep the mobile browser chrome tint in sync with the active theme.
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[theme])
}
