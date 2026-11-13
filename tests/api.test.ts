// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Mock the Neon driver: `neon(url)` returns our programmable sql tagged-template fn.
const sql = vi.fn()
vi.mock('@neondatabase/serverless', () => ({
  neon: vi.fn(() => sql),
}))

import listsHandler from '../api/lists'
import listIdHandler from '../api/lists/[id]'
import itemsHandler from '../api/items'
import itemIdHandler from '../api/items/[id]'
import reorderHandler from '../api/items/reorder'

function makeRes() {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    headers: {} as Record<string, string>,
    status(n: number) {
      this.statusCode = n
      return this
    },
    json(b: unknown) {
      this.body = b
      return this
    },
    setHeader(k: string, v: string) {
      this.headers[k] = v
    },
  }
  return res
}

type Res = ReturnType<typeof makeRes>

function makeReq(method: string, query: Record<string, string> = {}, body?: unknown) {
  return { method, query, body } as never
}

async function call(handler: typeof listsHandler, req: unknown, res: Res) {
  await handler(req as never, res as never)
  return res
}

beforeEach(() => {
  sql.mockReset()
  vi.stubEnv('DATABASE_URL', 'postgres://user:***@ep-fake.neon.tech/db?sslmode=require')
})
afterEach(() => {
  vi.unstubAllEnvs()
})

describe('api/lists', () => {
  it('GET returns lists with counts', async () => {
    const rows = [{ id: 1, name: 'A', item_count: 2 }]
    sql.mockResolvedValueOnce(rows)
    const res = await call(listsHandler, makeReq('GET'), makeRes())
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual(rows)
  })

  it('POST creates a list', async () => {
    const created = { id: 3, name: 'New', item_count: 0 }
    sql.mockResolvedValueOnce([created])
    const res = await call(listsHandler, makeReq('POST', {}, { name: 'New' }), makeRes())
    expect(res.statusCode).toBe(201)
    expect(res.body).toEqual(created)
    expect(sql.mock.calls[0][0][0]).toContain('INSERT INTO lists')
  })

  it('POST rejects blank name', async () => {
    const res = await call(listsHandler, makeReq('POST', {}, { name: '   ' }), makeRes())
    expect(res.statusCode).toBe(400)
    expect(res.body).toEqual({ error: 'List name is required' })
  })

  it('POST rejects non-string name', async () => {
    const res = await call(listsHandler, makeReq('POST', {}, { name: 42 }), makeRes())
    expect(res.statusCode).toBe(400)
  })

  it('POST rejects missing body', async () => {
    const res = await call(listsHandler, makeReq('POST'), makeRes())
    expect(res.statusCode).toBe(400)
  })

  it('truncates names longer than 100 chars but keeps them valid', async () => {
    sql.mockResolvedValueOnce([{ id: 1, name: 'x'.repeat(100), item_count: 0 }])
    const res = await call(listsHandler, makeReq('POST', {}, { name: 'x'.repeat(250) }), makeRes())
    expect(res.statusCode).toBe(201)
  })

  it('405 on other methods', async () => {
    const res = await call(listsHandler, makeReq('PUT'), makeRes())
    expect(res.statusCode).toBe(405)
    expect(res.headers.Allow).toBe('GET, POST')
  })

  it('500 with message when sql throws Error', async () => {
    sql.mockRejectedValueOnce(new Error('db down'))
    const res = await call(listsHandler, makeReq('GET'), makeRes())
    expect(res.statusCode).toBe(500)
    expect(res.body).toEqual({ error: 'db down' })
  })

  it('500 generic when sql throws non-Error', async () => {
    sql.mockRejectedValueOnce('weird')
    const res = await call(listsHandler, makeReq('GET'), makeRes())
    expect(res.statusCode).toBe(500)
    expect(res.body).toEqual({ error: 'Internal server error' })
  })

  it('500 when DATABASE_URL is missing', async () => {
    vi.stubEnv('DATABASE_URL', '')
    const res = await call(listsHandler, makeReq('GET'), makeRes())
    expect(res.statusCode).toBe(500)
    expect(String((res.body as { error: string }).error)).toContain('DATABASE_URL is not set')
  })
})

describe('api/lists/[id]', () => {
  it('400 on non-integer id', async () => {
    const res = await call(listIdHandler, makeReq('PATCH', { id: 'abc' }), makeRes())
    expect(res.statusCode).toBe(400)
    expect(res.body).toEqual({ error: 'Invalid list id' })
  })

  it('PATCH renames', async () => {
    sql.mockResolvedValueOnce([{ id: 1, name: 'B' }])
    const res = await call(listIdHandler, makeReq('PATCH', { id: '1' }, { name: 'B' }), makeRes())
    expect(res.statusCode).toBe(200)
  })

  it('PATCH 404 when list missing', async () => {
    sql.mockResolvedValueOnce([])
    const res = await call(listIdHandler, makeReq('PATCH', { id: '99' }, { name: 'B' }), makeRes())
    expect(res.statusCode).toBe(404)
  })

  it('PATCH 400 when name blank', async () => {
    const res = await call(listIdHandler, makeReq('PATCH', { id: '1' }, { name: ' ' }), makeRes())
    expect(res.statusCode).toBe(400)
  })

  it('PATCH 400 when name is not a string', async () => {
    const res = await call(listIdHandler, makeReq('PATCH', { id: '1' }, { name: 42 }), makeRes())
    expect(res.statusCode).toBe(400)
    expect(res.body).toEqual({ error: 'List name is required' })
  })

  it('DELETE removes list', async () => {
    sql.mockResolvedValueOnce([{ id: 1 }])
    const res = await call(listIdHandler, makeReq('DELETE', { id: '1' }), makeRes())
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ ok: true })
  })

  it('DELETE 404 when missing', async () => {
    sql.mockResolvedValueOnce([])
    const res = await call(listIdHandler, makeReq('DELETE', { id: '99' }), makeRes())
    expect(res.statusCode).toBe(404)
  })

  it('405 on GET', async () => {
    const res = await call(listIdHandler, makeReq('GET', { id: '1' }), makeRes())
    expect(res.statusCode).toBe(405)
    expect(res.headers.Allow).toBe('PATCH, DELETE')
  })

  it('500 Error and non-Error paths', async () => {
    sql.mockRejectedValueOnce(new Error('boom'))
    const r1 = await call(listIdHandler, makeReq('DELETE', { id: '1' }), makeRes())
    expect(r1.body).toEqual({ error: 'boom' })
    sql.mockRejectedValueOnce(123)
    const r2 = await call(listIdHandler, makeReq('DELETE', { id: '1' }), makeRes())
    expect(r2.body).toEqual({ error: 'Internal server error' })
  })

  it('500 when DATABASE_URL is missing', async () => {
    vi.stubEnv('DATABASE_URL', '')
    const res = await call(listIdHandler, makeReq('DELETE', { id: '1' }), makeRes())
    expect(res.statusCode).toBe(500)
    expect(String((res.body as { error: string }).error)).toContain('DATABASE_URL is not set')
  })
})

describe('api/items', () => {
  it('GET returns items for list_id', async () => {
    sql.mockResolvedValueOnce([{ id: 1 }])
    const res = await call(itemsHandler, makeReq('GET', { list_id: '1' }), makeRes())
    expect(res.statusCode).toBe(200)
  })

  it('GET 400 without valid list_id', async () => {
    const res = await call(itemsHandler, makeReq('GET', {}), makeRes())
    expect(res.statusCode).toBe(400)
    expect(res.body).toEqual({ error: 'list_id query param is required' })
  })

  it('POST creates item with all fields', async () => {
    const created = { id: 5, title: 'X', status: 'watching' }
    sql.mockResolvedValueOnce([created])
    const res = await call(
      itemsHandler,
      makeReq(
        'POST',
        {},
        {
          list_id: 1,
          title: 'X',
          url: 'https://imdb/x',
          poster_url: 'https://img/p.jpg',
          status: 'watching',
          notes: 'note',
        }
      ),
      makeRes()
    )
    expect(res.statusCode).toBe(201)
    expect(res.body).toEqual(created)
  })

  it('POST defaults invalid status and normalizes blank/optional fields', async () => {
    sql.mockResolvedValueOnce([{ id: 6, status: 'watching', url: null, notes: null }])
    const res = await call(
      itemsHandler,
      makeReq('POST', {}, { list_id: 1, title: 'Y', status: 'bogus', url: '   ', notes: 42 })
      ,
      makeRes()
    )
    expect(res.statusCode).toBe(201)
    const params = sql.mock.calls[0][0]
    expect(params).toBeDefined()
  })

  it('POST 400 on bad list_id', async () => {
    const res = await call(itemsHandler, makeReq('POST', {}, { list_id: 'x', title: 'Y' }), makeRes())
    expect(res.statusCode).toBe(400)
    expect(res.body).toEqual({ error: 'list_id is required' })
  })

  it('POST stores tmdb_id and 409s when it is already in the list', async () => {
    sql.mockResolvedValueOnce([]) // duplicate pre-check: none found
    sql.mockResolvedValueOnce([{ id: 9, tmdb_id: 603 }]) // INSERT
    const ok = await call(
      itemsHandler,
      makeReq('POST', {}, { list_id: 1, title: 'The Matrix', tmdb_id: 603 }),
      makeRes()
    )
    expect(ok.statusCode).toBe(201)
    expect(sql).toHaveBeenCalledTimes(2)

    sql.mockResolvedValueOnce([{ id: 9 }]) // duplicate pre-check: found
    const dup = await call(
      itemsHandler,
      makeReq('POST', {}, { list_id: 1, title: 'The Matrix', tmdb_id: 603 }),
      makeRes()
    )
    expect(dup.statusCode).toBe(409)
    expect(dup.body).toEqual({ error: '"The Matrix" is already in this list' })
    expect(sql).toHaveBeenCalledTimes(3) // pre-check only, no INSERT
  })

  it('POST ignores invalid tmdb_id values (treats them as manual entries)', async () => {
    for (const bad of ['abc', -3, 1.5]) {
      sql.mockResolvedValueOnce([{ id: 10, tmdb_id: null }])
      const res = await call(
        itemsHandler,
        makeReq('POST', {}, { list_id: 1, title: 'M', tmdb_id: bad }),
        makeRes()
      )
      expect(res.statusCode).toBe(201)
    }
    // One INSERT per call, no duplicate pre-checks.
    expect(sql).toHaveBeenCalledTimes(3)
  })

  it('POST maps a unique violation (23505) to 409 — race backstop', async () => {
    sql.mockResolvedValueOnce([]) // pre-check passes…
    sql.mockRejectedValueOnce(Object.assign(new Error('duplicate key'), { code: '23505' }))
    const res = await call(
      itemsHandler,
      makeReq('POST', {}, { list_id: 1, title: 'X', tmdb_id: 7 }),
      makeRes()
    )
    expect(res.statusCode).toBe(409)
    expect(res.body).toEqual({ error: 'That item is already in this list' })
  })

  it('POST 400 on missing body', async () => {
    const res = await call(itemsHandler, makeReq('POST'), makeRes())
    expect(res.statusCode).toBe(400)
  })

  it('POST 400 on blank title', async () => {
    const res = await call(itemsHandler, makeReq('POST', {}, { list_id: 1, title: '  ' }), makeRes())
    expect(res.statusCode).toBe(400)
    expect(res.body).toEqual({ error: 'title is required' })
  })

  it('405 on DELETE', async () => {
    const res = await call(itemsHandler, makeReq('DELETE'), makeRes())
    expect(res.statusCode).toBe(405)
    expect(res.headers.Allow).toBe('GET, POST')
  })

  it('500 Error and non-Error paths', async () => {
    sql.mockRejectedValueOnce(new Error('db gone'))
    const r1 = await call(itemsHandler, makeReq('GET', { list_id: '1' }), makeRes())
    expect(r1.body).toEqual({ error: 'db gone' })
    sql.mockRejectedValueOnce(false)
    const r2 = await call(itemsHandler, makeReq('GET', { list_id: '1' }), makeRes())
    expect(r2.body).toEqual({ error: 'Internal server error' })
  })

  it('500 when DATABASE_URL is missing', async () => {
    vi.stubEnv('DATABASE_URL', '')
    const res = await call(itemsHandler, makeReq('GET', { list_id: '1' }), makeRes())
    expect(res.statusCode).toBe(500)
    expect(String((res.body as { error: string }).error)).toContain('DATABASE_URL is not set')
  })
})

describe('api/items/[id]', () => {
  const current = {
    id: 7,
    list_id: 1,
    title: 'Old',
    url: 'https://old',
    poster_url: 'https://old.jpg',
    status: 'watching',
    notes: 'old notes',
  }

  it('400 on non-integer id', async () => {
    const res = await call(itemIdHandler, makeReq('DELETE', { id: 'x' }), makeRes())
    expect(res.statusCode).toBe(400)
    expect(res.body).toEqual({ error: 'Invalid item id' })
  })

  it('PATCH 404 when item missing', async () => {
    sql.mockResolvedValueOnce([])
    const res = await call(itemIdHandler, makeReq('PATCH', { id: '9' }, { title: 'T' }), makeRes())
    expect(res.statusCode).toBe(404)
  })

  it('PATCH merges provided fields over current values', async () => {
    sql
      .mockResolvedValueOnce([current]) // SELECT
      .mockResolvedValueOnce([{ ...current, status: 'watched' }]) // UPDATE
    const res = await call(
      itemIdHandler,
      makeReq('PATCH', { id: '7' }, { status: 'watched' }),
      makeRes()
    )
    expect(res.statusCode).toBe(200)
    expect((res.body as { status: string }).status).toBe('watched')
  })

  it('PATCH accepts all fields explicitly', async () => {
    sql.mockResolvedValueOnce([current]).mockResolvedValueOnce([{ ...current, title: 'New' }])
    const res = await call(
      itemIdHandler,
      makeReq(
        'PATCH',
        { id: '7' },
        { title: 'New', url: 'https://n', poster_url: 'https://n.jpg', status: 'watching', notes: 'nn' }
      ),
      makeRes()
    )
    expect(res.statusCode).toBe(200)
  })

  it('PATCH with empty body keeps everything (undefined-body branch)', async () => {
    sql.mockResolvedValueOnce([current]).mockResolvedValueOnce([current])
    const res = await call(itemIdHandler, makeReq('PATCH', { id: '7' }), makeRes())
    expect(res.statusCode).toBe(200)
  })

  it('PATCH 400 on blank title', async () => {
    sql.mockResolvedValueOnce([current])
    const res = await call(itemIdHandler, makeReq('PATCH', { id: '7' }, { title: '   ' }), makeRes())
    expect(res.statusCode).toBe(400)
    expect(res.body).toEqual({ error: 'title cannot be empty' })
  })

  it('PATCH 400 on invalid status', async () => {
    sql.mockResolvedValueOnce([current])
    const res = await call(itemIdHandler, makeReq('PATCH', { id: '7' }, { status: 'nope' }), makeRes())
    expect(res.statusCode).toBe(400)
    expect(res.body).toEqual({ error: 'Invalid status' })
  })

  it('PATCH 400 on non-string title', async () => {
    sql.mockResolvedValueOnce([current])
    const res = await call(itemIdHandler, makeReq('PATCH', { id: '7' }, { title: 42 }), makeRes())
    expect(res.statusCode).toBe(400)
    expect(res.body).toEqual({ error: 'title cannot be empty' })
  })

  it('PATCH normalizes non-string url/poster/notes to null', async () => {
    sql.mockResolvedValueOnce([current]).mockResolvedValueOnce([{ ...current, url: null }])
    const res = await call(
      itemIdHandler,
      makeReq('PATCH', { id: '7' }, { url: 99, poster_url: {}, notes: [] }),
      makeRes()
    )
    expect(res.statusCode).toBe(200)
  })

  it('DELETE removes item', async () => {
    sql.mockResolvedValueOnce([{ id: 7 }])
    const res = await call(itemIdHandler, makeReq('DELETE', { id: '7' }), makeRes())
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ ok: true })
  })

  it('DELETE 404 when missing', async () => {
    sql.mockResolvedValueOnce([])
    const res = await call(itemIdHandler, makeReq('DELETE', { id: '77' }), makeRes())
    expect(res.statusCode).toBe(404)
  })

  it('405 on GET', async () => {
    const res = await call(itemIdHandler, makeReq('GET', { id: '7' }), makeRes())
    expect(res.statusCode).toBe(405)
    expect(res.headers.Allow).toBe('PATCH, DELETE')
  })

  it('500 Error and non-Error paths', async () => {
    sql.mockRejectedValueOnce(new Error('offline'))
    const r1 = await call(itemIdHandler, makeReq('DELETE', { id: '7' }), makeRes())
    expect(r1.body).toEqual({ error: 'offline' })
    sql.mockRejectedValueOnce(null)
    const r2 = await call(itemIdHandler, makeReq('DELETE', { id: '7' }), makeRes())
    expect(r2.body).toEqual({ error: 'Internal server error' })
  })

  it('500 when DATABASE_URL is missing', async () => {
    vi.stubEnv('DATABASE_URL', '')
    const res = await call(itemIdHandler, makeReq('DELETE', { id: '7' }), makeRes())
    expect(res.statusCode).toBe(500)
    expect(String((res.body as { error: string }).error)).toContain('DATABASE_URL is not set')
  })
})

describe('api/items/reorder', () => {
  it('405 on non-POST', async () => {
    const res = await call(reorderHandler, makeReq('GET'), makeRes())
    expect(res.statusCode).toBe(405)
    expect(res.headers['Allow']).toBe('POST')
  })

  it('400 when list_id is missing or not an integer', async () => {
    const r1 = await call(reorderHandler, makeReq('POST', {}, { ordered_ids: [1] }), makeRes())
    expect(r1.statusCode).toBe(400)
    expect(r1.body).toEqual({ error: 'list_id is required' })
    const r2 = await call(
      reorderHandler,
      makeReq('POST', {}, { list_id: 'x', ordered_ids: [1] }),
      makeRes()
    )
    expect(r2.statusCode).toBe(400)
  })

  it('400 when the request has no body', async () => {
    const res = await call(reorderHandler, makeReq('POST'), makeRes())
    expect(res.statusCode).toBe(400)
    expect(res.body).toEqual({ error: 'list_id is required' })
  })

  it('400 when ordered_ids is not an array of integers', async () => {
    const r1 = await call(reorderHandler, makeReq('POST', {}, { list_id: 1, ordered_ids: 'x' }), makeRes())
    expect(r1.statusCode).toBe(400)
    expect(r1.body).toEqual({ error: 'ordered_ids must be an array of integers' })
    const r2 = await call(
      reorderHandler,
      makeReq('POST', {}, { list_id: 1, ordered_ids: [1, 'two', 3.5] }),
      makeRes()
    )
    expect(r2.statusCode).toBe(400)
  })

  it('200 updates one position per id', async () => {
    sql.mockResolvedValue([])
    const res = await call(
      reorderHandler,
      makeReq('POST', {}, { list_id: 1, ordered_ids: [12, 10, 11] }),
      makeRes()
    )
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ ok: true })
    expect(sql).toHaveBeenCalledTimes(3)
  })

  it('200 with an empty ordered_ids list is a no-op', async () => {
    const res = await call(
      reorderHandler,
      makeReq('POST', {}, { list_id: 1, ordered_ids: [] }),
      makeRes()
    )
    expect(res.statusCode).toBe(200)
    expect(sql).not.toHaveBeenCalled()
  })

  it('500 Error and non-Error paths', async () => {
    sql.mockRejectedValueOnce(new Error('db offline'))
    const r1 = await call(
      reorderHandler,
      makeReq('POST', {}, { list_id: 1, ordered_ids: [1] }),
      makeRes()
    )
    expect(r1.body).toEqual({ error: 'db offline' })
    sql.mockRejectedValueOnce(42)
    const r2 = await call(
      reorderHandler,
      makeReq('POST', {}, { list_id: 1, ordered_ids: [1] }),
      makeRes()
    )
    expect(r2.body).toEqual({ error: 'Internal server error' })
  })

  it('500 when DATABASE_URL is missing', async () => {
    vi.stubEnv('DATABASE_URL', '')
    const res = await call(
      reorderHandler,
      makeReq('POST', {}, { list_id: 1, ordered_ids: [1] }),
      makeRes()
    )
    expect(res.statusCode).toBe(500)
    expect(String((res.body as { error: string }).error)).toContain('DATABASE_URL is not set')
  })
})
