import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/lib/api'

afterEach(() => {
  vi.unstubAllGlobals()
})

function fetchRes(status: number, body: string, contentType = 'application/json') {
  return vi.fn(async () =>
    new Response(body, { status, headers: { 'content-type': contentType } })
  ) as unknown as typeof fetch
}

describe('api client error handling', () => {
  it('uses the server error message when present', async () => {
    vi.stubGlobal('fetch', fetchRes(500, JSON.stringify({ error: 'server said no' })))
    await expect(api.getLists()).rejects.toThrow('server said no')
  })

  it('falls back to a status message when the JSON has no error field', async () => {
    vi.stubGlobal('fetch', fetchRes(500, JSON.stringify({ message: 'ignored' })))
    await expect(api.getLists()).rejects.toThrow('Request failed (500)')
  })

  it('falls back to a status message when the body is not JSON', async () => {
    vi.stubGlobal('fetch', fetchRes(502, '<html>bad gateway</html>', 'text/html'))
    await expect(api.getLists()).rejects.toThrow('Request failed (502)')
  })
})

describe('api client endpoints', () => {
  it('calls every endpoint with the right method, url and body', async () => {
    const calls: Array<[string, string | undefined, string | undefined]> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        calls.push([String(input), init?.method, init?.body ? String(init.body) : undefined])
        return new Response(JSON.stringify({ id: 1 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      })
    )
    await api.getLists()
    await api.createList('N')
    await api.renameList(5, 'R')
    await api.deleteList(5)
    await api.getItems(3)
    await api.createItem({ list_id: 3, title: 'T', status: 'watching' })
    await api.updateItem(9, { status: 'watched' })
    await api.deleteItem(9)
    await api.reorderItems(3, [9, 8])
    await api.searchMedia('the matrix')
    await api.searchDetail('movie', 603)

    expect(calls).toEqual([
      ['/api/lists', undefined, undefined],
      ['/api/lists', 'POST', JSON.stringify({ name: 'N' })],
      ['/api/lists/5', 'PATCH', JSON.stringify({ name: 'R' })],
      ['/api/lists/5', 'DELETE', undefined],
      ['/api/items?list_id=3', undefined, undefined],
      ['/api/items', 'POST', JSON.stringify({ list_id: 3, title: 'T', status: 'watching' })],
      ['/api/items/9', 'PATCH', JSON.stringify({ status: 'watched' })],
      ['/api/items/9', 'DELETE', undefined],
      ['/api/items/reorder', 'POST', JSON.stringify({ list_id: 3, ordered_ids: [9, 8] })],
      ['/api/search?q=the%20matrix', undefined, undefined],
      ['/api/search?media_type=movie&tmdb_id=603', undefined, undefined],
    ])
  })
})
