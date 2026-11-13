import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applyTheme, getInitialTheme, preferredTheme } from '@/lib/theme'

function stubMatchMedia(matches: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({
      matches,
      media: '',
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))
  )
}

beforeEach(() => {
  localStorage.clear()
  document.documentElement.classList.remove('dark')
  const meta = document.createElement('meta')
  meta.name = 'theme-color'
  meta.content = '#ffffff'
  document.head.appendChild(meta)
})

afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.clear()
  document.documentElement.classList.remove('dark')
  document.querySelector('meta[name="theme-color"]')?.remove()
})

describe('preferredTheme', () => {
  it('follows the OS dark preference', () => {
    stubMatchMedia(true)
    expect(preferredTheme()).toBe('dark')
    stubMatchMedia(false)
    expect(preferredTheme()).toBe('light')
  })
})

describe('getInitialTheme', () => {
  it('prefers a stored light choice even when the OS is dark', () => {
    localStorage.setItem('mq_theme', 'light')
    stubMatchMedia(true)
    expect(getInitialTheme()).toBe('light')
  })

  it('prefers a stored dark choice even when the OS is light', () => {
    localStorage.setItem('mq_theme', 'dark')
    stubMatchMedia(false)
    expect(getInitialTheme()).toBe('dark')
  })

  it('falls back to the OS preference when nothing is stored', () => {
    stubMatchMedia(true)
    expect(getInitialTheme()).toBe('dark')
    stubMatchMedia(false)
    expect(getInitialTheme()).toBe('light')
  })

  it('ignores a corrupted stored value', () => {
    localStorage.setItem('mq_theme', 'neon')
    stubMatchMedia(false)
    expect(getInitialTheme()).toBe('light')
  })
})

describe('applyTheme', () => {
  it('adds the dark class, remembers dark, and tints the browser chrome', () => {
    applyTheme('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(localStorage.getItem('mq_theme')).toBe('dark')
    expect((document.querySelector('meta[name="theme-color"]') as HTMLMetaElement).content).toBe(
      '#171717'
    )
  })

  it('removes the dark class, remembers light, and restores the chrome tint', () => {
    applyTheme('dark')
    applyTheme('light')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(localStorage.getItem('mq_theme')).toBe('light')
    expect((document.querySelector('meta[name="theme-color"]') as HTMLMetaElement).content).toBe(
      '#ffffff'
    )
  })

  it('tolerates a document without a theme-color meta', () => {
    document.querySelector('meta[name="theme-color"]')!.remove()
    expect(() => applyTheme('dark')).not.toThrow()
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })
})
