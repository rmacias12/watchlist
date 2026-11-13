// @vitest-environment node
import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import middleware from '../middleware'

const PASS = 's3cret-pass'
const hash = (s: string) => createHash('sha256').update(s).digest('hex')
const goodCookie = `mq_auth=${hash(`${PASS}:movie-queue`)}`

function req(path: string, init: RequestInit = {}) {
  return new Request(`https://movie-queue.example.com${path}`, init)
}

function formPost(passcode: string | null, accept = 'text/html') {
  const body = passcode === null ? 'other=1' : `passcode=${encodeURIComponent(passcode)}`
  return req('/', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept },
    body,
  })
}

beforeEach(() => {
  vi.stubEnv('PASSCODE', PASS)
})
afterEach(() => {
  vi.unstubAllEnvs()
})

describe('middleware passcode gate', () => {
  it('passes through when PASSCODE is not configured (fail-open)', async () => {
    vi.stubEnv('PASSCODE', '')
    const res = await middleware(req('/', { headers: { accept: 'text/html' } }))
    expect(res).toBeUndefined()
  })

  it('serves the login page for unauthenticated HTML requests', async () => {
    const res = await middleware(req('/', { headers: { accept: 'text/html' } }))
    expect(res?.status).toBe(200)
    const html = await res!.text()
    expect(html).toContain('passcode-protected')
    expect(html).not.toContain('Wrong passcode')
  })

  it('returns 401 JSON for unauthenticated /api requests', async () => {
    const res = await middleware(req('/api/lists', { headers: { accept: 'application/json' } }))
    expect(res?.status).toBe(401)
    expect(await res!.json()).toEqual({ error: 'unauthorized' })
  })

  it('returns 401 JSON for non-HTML, non-API requests', async () => {
    const res = await middleware(req('/some-file.txt', { headers: { accept: 'text/plain' } }))
    expect(res?.status).toBe(401)
    expect(res!.headers.get('content-type')).toBe('application/json')
  })

  it('accepts no accept-header as non-HTML (401 JSON)', async () => {
    const res = await middleware(req('/x'))
    expect(res?.status).toBe(401)
  })

  it('rejects a wrong passcode with the error login page', async () => {
    const res = await middleware(formPost('wrong-one'))
    expect(res?.status).toBe(401)
    expect(await res!.text()).toContain('Wrong passcode')
  })

  it('accepts the right passcode with a redirect + cookie', async () => {
    const res = await middleware(formPost(PASS))
    expect(res?.status).toBe(302)
    expect(res!.headers.get('location')).toBe('/')
    const cookie = res!.headers.get('set-cookie')!
    expect(cookie).toContain(goodCookie)
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Lax')
    expect(cookie).toContain('Secure')
    expect(cookie).toContain('Max-Age=15552000')
  })

  it('lets requests with a valid cookie through', async () => {
    const res = await middleware(req('/', { headers: { accept: 'text/html', cookie: goodCookie } }))
    expect(res).toBeUndefined()
  })

  it('parses the cookie out of a multi-cookie header', async () => {
    const res = await middleware(
      req('/api/items?list_id=1', { headers: { cookie: `theme=dark; ${goodCookie}; x=1` } })
    )
    expect(res).toBeUndefined()
  })

  it('rejects a tampered cookie value', async () => {
    const res = await middleware(
      req('/', { headers: { accept: 'text/html', cookie: 'mq_auth=deadbeef' } })
    )
    expect(res?.status).toBe(200)
    expect(await res!.text()).toContain('passcode-protected')
  })

  it('handles a cookie header with a valueless entry', async () => {
    const res = await middleware(
      req('/', { headers: { accept: 'text/html', cookie: 'emptycookie' } })
    )
    expect(res?.status).toBe(200)
  })

  it('ignores urlencoded POSTs without a passcode field', async () => {
    const res = await middleware(formPost(null, 'application/json'))
    expect(res?.status).toBe(401)
  })

  it('ignores POSTs with other content types (e.g. app JSON)', async () => {
    const res = await middleware(
      req('/api/lists', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'x' }),
      })
    )
    expect(res?.status).toBe(401)
  })

  it('treats a missing content-type as non-form', async () => {
    // A POST with no body carries no content-type header at all.
    const res = await middleware(req('/api/lists', { method: 'POST' }))
    expect(res?.status).toBe(401)
  })

  it('lets authenticated form POSTs through to the app (API JSON call with cookie)', async () => {
    const res = await middleware(
      req('/api/lists', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: goodCookie },
        body: JSON.stringify({ name: 'x' }),
      })
    )
    expect(res).toBeUndefined()
  })
})
