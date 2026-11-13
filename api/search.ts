import type { VercelRequest, VercelResponse } from '@vercel/node'

// TMDB search proxy. Keeps the API key server-side.
// Self-contained by design — see AGENTS.md ("API functions MUST stay
// self-contained": Vercel's ESM builder does not reliably bundle shared
// modules between api/ functions).
//
// GET /api/search?q=<query>                  -> TMDBSearchResult[]
// GET /api/search?media_type=&tmdb_id=       -> TMDBDetail (IMDb/TMDB links)

const TMDB_BASE = 'https://api.themoviedb.org/3'
const IMG_BASE = 'https://image.tmdb.org/t/p/w500'

interface TMDBMultiResult {
  id: number
  media_type: string
  title?: string
  name?: string
  release_date?: string
  first_air_date?: string
  poster_path?: string | null
  overview?: string
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const key = process.env.TMDB_API_KEY
  if (!key) {
    return res.status(503).json({ error: 'TMDB search is not configured' })
  }
  const query = req.query
  const mediaType = typeof query.media_type === 'string' ? query.media_type : ''
  const tmdbId = typeof query.tmdb_id === 'string' ? query.tmdb_id : ''
  const q = typeof query.q === 'string' ? query.q.trim() : ''
  const authParam = new URLSearchParams({ api_key: key }).toString()
  try {
    if (mediaType || tmdbId) {
      // Detail mode: resolve external ids so we can build the IMDb link.
      if ((mediaType !== 'movie' && mediaType !== 'tv') || !/^\d+$/.test(tmdbId)) {
        return res.status(400).json({ error: 'Invalid media_type or tmdb_id' })
      }
      const extUrl =
        TMDB_BASE + '/' + mediaType + '/' + tmdbId + '/external_ids?' + authParam
      const extRes = await fetch(extUrl)
      if (!extRes.ok) {
        return res.status(502).json({ error: 'TMDB responded ' + extRes.status })
      }
      const ext = (await extRes.json()) as { imdb_id?: string | null }
      const tmdbUrl = 'https://www.themoviedb.org/' + mediaType + '/' + tmdbId
      const imdbUrl = ext.imdb_id ? 'https://www.imdb.com/title/' + ext.imdb_id + '/' : null
      return res.status(200).json({ url: imdbUrl ?? tmdbUrl, imdb_url: imdbUrl, tmdb_url: tmdbUrl })
    }
    if (q.length < 2) {
      return res.status(400).json({ error: 'q must be at least 2 characters' })
    }
    const searchParams = new URLSearchParams({ query: q, include_adult: 'false' }).toString()
    const sRes = await fetch(TMDB_BASE + '/search/multi?' + authParam + '&' + searchParams)
    if (!sRes.ok) {
      return res.status(502).json({ error: 'TMDB responded ' + sRes.status })
    }
    const data = (await sRes.json()) as { results?: TMDBMultiResult[] }
    const results = (data.results ?? [])
      .filter((m) => m.media_type === 'movie' || m.media_type === 'tv')
      .slice(0, 10)
      .map((m) => ({
        tmdb_id: m.id,
        media_type: m.media_type,
        title: m.title ?? m.name ?? '',
        year: String(m.release_date ?? m.first_air_date ?? '').slice(0, 4) || null,
        poster_url: m.poster_path ? `${IMG_BASE}${m.poster_path}` : null,
        overview: m.overview || null,
      }))
    return res.status(200).json(results)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Search failed'
    return res.status(500).json({ error: message })
  }
}
