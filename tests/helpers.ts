import { vi } from 'vitest'
import type { Item, List, TMDBDetail, TMDBSearchResult } from '@/lib/types'

export interface MockDb {
  lists: List[]
  items: Item[]
  failNext?: { method?: string; url?: string; status?: number; body?: unknown }
  rejectNext?: { method?: string; url?: string; error?: unknown }
  /** undefined = TMDB not configured (search route returns 503) */
  tmdb?: {
    results?: TMDBSearchResult[]
    detail?: TMDBDetail
    /** detail lookups return 502 (search still works) */
    detailFail?: boolean
  }
}

export function makeDb(lists: List[] = [], items: Item[] = []): MockDb {
  return { lists, items }
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

export function item(db: MockDb, over: Partial<Item> & { id: number; list_id: number }): Item {
  const now = new Date().toISOString()
  const it: Item = {
    title: `Item ${over.id}`,
    url: null,
    poster_url: null,
    tmdb_id: null,
    status: 'watching',
    notes: null,
    position: db.items.filter((i) => i.list_id === over.list_id).length + 1,
    created_at: now,
    updated_at: now,
    ...over,
  }
  db.items.push(it)
  return it
}

export function list(db: MockDb, over: Partial<List> & { id: number }): List {
  const l: List = {
    name: `List ${over.id}`,
    item_count: 0,
    created_at: new Date().toISOString(),
    ...over,
  }
  db.lists.push(l)
  return l
}

/**
 * Install a fetch mock that emulates the real API against an in-memory db.
 * Returns the fetch mock for assertions.
 */
export function mockFetch(db: MockDb) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost')
    const method = (init?.method ?? 'GET').toUpperCase()
    const path = url.pathname

    if (
      db.rejectNext &&
      (db.rejectNext.method === undefined || db.rejectNext.method === method) &&
      (db.rejectNext.url === undefined || path === db.rejectNext.url)
    ) {
      const rule = db.rejectNext
      db.rejectNext = undefined
      throw rule.error ?? new Error('network down')
    }
    if (
      db.failNext &&
      (db.failNext.method === undefined || db.failNext.method === method) &&
      (db.failNext.url === undefined || path === db.failNext.url)
    ) {
      const rule = db.failNext
      db.failNext = undefined
      return jsonResponse(rule.status ?? 500, rule.body ?? { error: 'server exploded' })
    }

    const body = init?.body ? JSON.parse(String(init.body)) : {}

    if (path === '/api/lists' && method === 'GET') {
      return jsonResponse(
        200,
        db.lists.map((l) => ({ ...l, item_count: db.items.filter((i) => i.list_id === l.id).length }))
      )
    }
    if (path === '/api/lists' && method === 'POST') {
      const l: List = {
        id: Math.max(0, ...db.lists.map((x) => x.id)) + 1,
        name: body.name,
        item_count: 0,
        created_at: new Date().toISOString(),
      }
      db.lists.push(l)
      return jsonResponse(201, { ...l, item_count: 0 })
    }
    let m = path.match(/^\/api\/lists\/(\d+)$/)
    if (m) {
      const id = Number(m[1])
      const l = db.lists.find((x) => x.id === id)
      if (!l) return jsonResponse(404, { error: 'List not found' })
      if (method === 'PATCH') {
        l.name = body.name
        return jsonResponse(200, l)
      }
      if (method === 'DELETE') {
        db.lists = db.lists.filter((x) => x.id !== id)
        db.items = db.items.filter((i) => i.list_id !== id)
        return jsonResponse(200, { ok: true })
      }
    }

    if (path === '/api/items' && method === 'GET') {
      const listId = Number(url.searchParams.get('list_id'))
      return jsonResponse(200, db.items.filter((i) => i.list_id === listId))
    }
    if (path === '/api/items' && method === 'POST') {
      const now = new Date().toISOString()
      const siblings = db.items.filter((i) => i.list_id === body.list_id)
      // Mirrors the API: valid tmdb_id is deduped within the list.
      const tmdbId = Number.isInteger(body.tmdb_id) && body.tmdb_id > 0 ? body.tmdb_id : null
      if (tmdbId !== null && siblings.some((i) => i.tmdb_id === tmdbId)) {
        return jsonResponse(409, { error: `"${body.title}" is already in this list` })
      }
      const it: Item = {
        id: Math.max(0, ...db.items.map((x) => x.id)) + 1,
        list_id: body.list_id,
        title: body.title,
        url: body.url ?? null,
        poster_url: body.poster_url ?? null,
        tmdb_id: tmdbId,
        status: body.status ?? 'watching',
        notes: body.notes ?? null,
        // Mirrors the API: new items go to the end (max position + 1).
        position: Math.max(...siblings.map((i) => i.position), 0) + 1,
        created_at: now,
        updated_at: now,
      }
      db.items.push(it)
      return jsonResponse(201, it)
    }
    if (path === '/api/items/reorder' && method === 'POST') {
      const ids: number[] = body.ordered_ids
      const listItems = db.items.filter((i) => i.list_id === body.list_id)
      for (const it of listItems) {
        const idx = ids.indexOf(it.id)
        if (idx >= 0) it.position = idx + 1
      }
      // Keep db order == position order for subsequent GETs.
      const others = db.items.filter((i) => i.list_id !== body.list_id)
      db.items = [...others, ...listItems.slice().sort((a, b) => a.position - b.position)]
      return jsonResponse(200, { ok: true })
    }
    m = path.match(/^\/api\/items\/(\d+)$/)
    if (m) {
      const id = Number(m[1])
      const it = db.items.find((x) => x.id === id)
      if (!it) return jsonResponse(404, { error: 'Item not found' })
      if (method === 'PATCH') {
        Object.assign(it, body, { updated_at: new Date().toISOString() })
        return jsonResponse(200, it)
      }
      if (method === 'DELETE') {
        db.items = db.items.filter((x) => x.id !== id)
        return jsonResponse(200, { ok: true })
      }
    }

    if (path === '/api/search' && method === 'GET') {
      if (!db.tmdb) return jsonResponse(503, { error: 'TMDB search is not configured' })
      if (url.searchParams.has('q')) {
        return jsonResponse(200, db.tmdb.results ?? [])
      }
      const mt = url.searchParams.get('media_type')
      const id = url.searchParams.get('tmdb_id')
      if (db.tmdb.detailFail) return jsonResponse(502, { error: 'TMDB down' })
      const detail: TMDBDetail = db.tmdb.detail ?? {
        url: `https://www.imdb.com/title/tt0000${id}/`,
        imdb_url: `https://www.imdb.com/title/tt0000${id}/`,
        tmdb_url: `https://www.themoviedb.org/${mt}/${id}`,
      }
      return jsonResponse(200, detail)
    }

    return jsonResponse(404, { error: 'no route' })
  })

  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

/** Wait for pending promises/microtasks + timers to flush (React act-friendly). */
export async function flush(times = 4) {
  for (let i = 0; i < times; i++) {
    await new Promise((r) => setTimeout(r, 0))
  }
}
