import type { VercelRequest, VercelResponse } from '@vercel/node'
import { neon } from '@neondatabase/serverless'

// Self-contained on purpose: Vercel's ESM builder does not reliably bundle
// shared modules inside api/, so each function carries its own tiny helpers.

const STATUS_VALUES = ['watching', 'watched'] as const

function getSql() {
  const url = process.env.DATABASE_URL
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. Add your Neon connection string as a Vercel environment variable.'
    )
  }
  return neon(url)
}

function isValidStatus(s: unknown): s is (typeof STATUS_VALUES)[number] {
  return typeof s === 'string' && (STATUS_VALUES as readonly string[]).includes(s)
}

function optText(v: unknown, maxLen: number): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim().slice(0, maxLen)
  return t.length > 0 ? t : null
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const sql = getSql()

    if (req.method === 'GET') {
      const listId = Number(req.query.list_id)
      if (!Number.isInteger(listId))
        return res.status(400).json({ error: 'list_id query param is required' })
      const items = await sql`
        SELECT * FROM items
        WHERE list_id = ${listId}
        ORDER BY position, id
      `
      return res.status(200).json(items)
    }

    if (req.method === 'POST') {
      const body = req.body ?? {}
      const listId = Number(body.list_id)
      const title = optText(body.title, 300)
      if (!Number.isInteger(listId)) return res.status(400).json({ error: 'list_id is required' })
      if (!title) return res.status(400).json({ error: 'title is required' })
      const status = isValidStatus(body.status) ? body.status : 'watching'
      const url = optText(body.url, 2000)
      const posterUrl = optText(body.poster_url, 2000)
      const notes = optText(body.notes, 5000)
      // TMDB id (null for manual entries) — dedup key within a list.
      const tmdbId =
        Number.isSafeInteger(body.tmdb_id) && (body.tmdb_id as number) > 0
          ? (body.tmdb_id as number)
          : null

      if (tmdbId !== null) {
        const dupes = await sql`
          SELECT id FROM items WHERE list_id = ${listId} AND tmdb_id = ${tmdbId} LIMIT 1
        `
        if (dupes.length > 0) {
          return res.status(409).json({ error: `"${title}" is already in this list` })
        }
      }

      const rows = await sql`
        INSERT INTO items (list_id, title, url, poster_url, status, notes, position, tmdb_id)
        SELECT ${listId}, ${title}, ${url}, ${posterUrl}, ${status}, ${notes},
               COALESCE((SELECT MAX(position) FROM items WHERE list_id = ${listId}), 0) + 1,
               ${tmdbId}
        RETURNING *
      `
      return res.status(201).json(rows[0])
    }

    res.setHeader('Allow', 'GET, POST')
    return res.status(405).json({ error: 'Method not allowed' })
  } catch (err) {
    // Postgres unique violation on (list_id, tmdb_id) — race backstop for the
    // pre-check above (two tabs adding the same movie at the same moment).
    if ((err as { code?: string } | null)?.code === '23505') {
      return res.status(409).json({ error: 'That item is already in this list' })
    }
    console.error(err)
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Internal server error',
    })
  }
}
