import type { VercelRequest, VercelResponse } from '@vercel/node'
import { neon } from '@neondatabase/serverless'

// POST /api/items/reorder  { list_id: number, ordered_ids: number[] }
// Persists a drag-and-drop ordering: the Nth id gets position N+1.
// Self-contained on purpose: Vercel's ESM builder does not reliably bundle
// shared modules inside api/, so each function carries its own tiny helpers.

function getSql() {
  const url = process.env.DATABASE_URL
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. Add your Neon connection string as a Vercel environment variable.'
    )
  }
  return neon(url)
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST')
      return res.status(405).json({ error: 'Method not allowed' })
    }
    const body = req.body ?? {}
    const listId = Number(body.list_id)
    const ids = body.ordered_ids
    if (!Number.isInteger(listId)) return res.status(400).json({ error: 'list_id is required' })
    if (!Array.isArray(ids) || !ids.every((n) => Number.isInteger(n))) {
      return res.status(400).json({ error: 'ordered_ids must be an array of integers' })
    }

    const sql = getSql()
    // The Neon HTTP driver runs one statement per request (no multi-statement
    // transactions), so updates are issued in parallel. A partial failure is
    // tolerable for a single-user app: the next reorder rewrites everything.
    await Promise.all(
      ids.map((id, idx) => sql`
        UPDATE items SET position = ${idx + 1}
        WHERE id = ${id} AND list_id = ${listId}
      `)
    )
    return res.status(200).json({ ok: true })
  } catch (err) {
    console.error(err)
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Internal server error',
    })
  }
}
