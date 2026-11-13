// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import searchHandler from '../api/search'

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

function makeReq(method: string, query: Record<string, unknown> = {}) {
  return { method, query } as never
}

async function call(req: unknown, res: Res) {
  await searchHandler(req as never, res as never)
  return res
}

const fetchMock = vi.fn()

function tmdbResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  vi.stubEnv('TMDB_API_KEY', 'test-key')
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('api/search — gating', () => {
  it('405 on non-GET', async () => {
    const res = await call(makeReq('POST'), makeRes())
    expect(res.statusCode).toBe(405)
    expect(res.body).toEqual({ error: 'Method not allowed' })
  })

  it('503 when TMDB_API_KEY is not configured', async () => {
    vi.stubEnv('TMDB_API_KEY', '')
    const res = await call(makeReq('GET', { q: 'matrix' }), makeRes())
    expect(res.statusCode).toBe(503)
    expect(res.body).toEqual({ error: 'TMDB search is not configured' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('400 when neither q nor detail params are usable', async () => {
    // Array-valued query params are not strings -> treated as missing.
    const res = await call(makeReq('GET', { q: ['a', 'b'], media_type: ['x'] }), makeRes())
    expect(res.statusCode).toBe(400)
    expect(res.body).toEqual({ error: 'q must be at least 2 characters' })
  })

  it('400 when q is shorter than 2 characters', async () => {
    const res = await call(makeReq('GET', { q: ' m ' }), makeRes())
    expect(res.statusCode).toBe(400)
  })
})

describe('api/search — detail mode', () => {
  it('400 on invalid media_type', async () => {
    const res = await call(makeReq('GET', { media_type: 'person', tmdb_id: '5' }), makeRes())
    expect(res.statusCode).toBe(400)
    expect(res.body).toEqual({ error: 'Invalid media_type or tmdb_id' })
  })

  it('400 on non-numeric tmdb_id', async () => {
    const res = await call(makeReq('GET', { media_type: 'movie', tmdb_id: 'abc' }), makeRes())
    expect(res.statusCode).toBe(400)
  })

  it('400 when only tmdb_id is given (media_type missing)', async () => {
    const res = await call(makeReq('GET', { tmdb_id: '603' }), makeRes())
    expect(res.statusCode).toBe(400)
  })

  it('502 when TMDB external_ids call fails', async () => {
    fetchMock.mockResolvedValueOnce(tmdbResponse(404, { status_message: 'not found' }))
    const res = await call(makeReq('GET', { media_type: 'movie', tmdb_id: '1' }), makeRes())
    expect(res.statusCode).toBe(502)
    expect(res.body).toEqual({ error: 'TMDB responded 404' })
  })

  it('returns the IMDb url when imdb_id exists (movie)', async () => {
    fetchMock.mockResolvedValueOnce(tmdbResponse(200, { imdb_id: 'tt0133093' }))
    const res = await call(makeReq('GET', { media_type: 'movie', tmdb_id: '603' }), makeRes())
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({
      url: 'https://www.imdb.com/title/tt0133093/',
      imdb_url: 'https://www.imdb.com/title/tt0133093/',
      tmdb_url: 'https://www.themoviedb.org/movie/603',
    })
  })

  it('falls back to the TMDB url when imdb_id is missing (tv)', async () => {
    fetchMock.mockResolvedValueOnce(tmdbResponse(200, { imdb_id: null }))
    const res = await call(makeReq('GET', { media_type: 'tv', tmdb_id: '1399' }), makeRes())
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({
      url: 'https://www.themoviedb.org/tv/1399',
      imdb_url: null,
      tmdb_url: 'https://www.themoviedb.org/tv/1399',
    })
  })

  it('500 with message when fetch rejects with an Error', async () => {
    fetchMock.mockRejectedValueOnce(new Error('socket hang up'))
    const res = await call(makeReq('GET', { media_type: 'movie', tmdb_id: '603' }), makeRes())
    expect(res.statusCode).toBe(500)
    expect(res.body).toEqual({ error: 'socket hang up' })
  })

  it('500 generic when fetch rejects with a non-Error', async () => {
    fetchMock.mockRejectedValueOnce('weird')
    const res = await call(makeReq('GET', { media_type: 'movie', tmdb_id: '603' }), makeRes())
    expect(res.statusCode).toBe(500)
    expect(res.body).toEqual({ error: 'Search failed' })
  })
})

describe('api/search — search mode', () => {
  it('502 when TMDB search call fails', async () => {
    fetchMock.mockResolvedValueOnce(tmdbResponse(401, { status_message: 'bad key' }))
    const res = await call(makeReq('GET', { q: 'matrix' }), makeRes())
    expect(res.statusCode).toBe(502)
    expect(res.body).toEqual({ error: 'TMDB responded 401' })
  })

  it('maps movies/tv, drops people, and normalizes missing fields', async () => {
    fetchMock.mockResolvedValueOnce(
      tmdbResponse(200, {
        results: [
          {
            id: 603,
            media_type: 'movie',
            title: 'The Matrix',
            release_date: '1999-03-30',
            poster_path: '/p1.jpg',
            overview: 'A hacker learns reality is a simulation.',
          },
          {
            id: 1399,
            media_type: 'tv',
            name: 'Game of Thrones',
            first_air_date: '2011-04-17',
            poster_path: null,
            overview: '',
          },
          { id: 5, media_type: 'person', name: 'Some Actor' },
          { id: 999, media_type: 'movie' },
        ],
      })
    )
    const res = await call(makeReq('GET', { q: 'the m' }), makeRes())
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual([
      {
        tmdb_id: 603,
        media_type: 'movie',
        title: 'The Matrix',
        year: '1999',
        poster_url: 'https://image.tmdb.org/t/p/w500/p1.jpg',
        overview: 'A hacker learns reality is a simulation.',
      },
      {
        tmdb_id: 1399,
        media_type: 'tv',
        title: 'Game of Thrones',
        year: '2011',
        poster_url: null,
        overview: null,
      },
      {
        tmdb_id: 999,
        media_type: 'movie',
        title: '',
        year: null,
        poster_url: null,
        overview: null,
      },
    ])
    // The API key is sent, the query is URL-encoded, adults excluded.
    const calledUrl = String(fetchMock.mock.calls[0][0])
    expect(calledUrl).toContain('api_key=test-key')
    expect(calledUrl).toContain('query=the+m')
    expect(calledUrl).toContain('include_adult=false')
  })

  it('returns [] when TMDB response has no results field', async () => {
    fetchMock.mockResolvedValueOnce(tmdbResponse(200, { page: 1 }))
    const res = await call(makeReq('GET', { q: 'zzzqqq' }), makeRes())
    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual([])
  })

  it('caps results at 10', async () => {
    const many = Array.from({ length: 15 }, (_, i) => ({
      id: i + 1,
      media_type: 'movie',
      title: `Movie ${i + 1}`,
      release_date: '2000-01-01',
    }))
    fetchMock.mockResolvedValueOnce(tmdbResponse(200, { results: many }))
    const res = await call(makeReq('GET', { q: 'movie' }), makeRes())
    expect(res.statusCode).toBe(200)
    expect(Array.isArray(res.body) && (res.body as unknown[]).length).toBe(10)
  })
})
