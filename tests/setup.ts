// Test setup: jest-dom matchers everywhere; DOM polyfills only in jsdom envs
// (api/middleware tests run under `// @vitest-environment node`).
import '@testing-library/jest-dom/vitest'

if (typeof window !== 'undefined' && typeof Element !== 'undefined') {
  class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  }

  globalThis.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver

  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = (() => false) as never
  }
  if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = (() => {}) as never
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = (() => {}) as never
  }
  if (!Element.prototype.getClientRects) {
    Element.prototype.getClientRects = (() => []) as never
  }
  if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as never
  }
}
