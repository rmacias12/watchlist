import type { VercelRequest, VercelResponse } from '@vercel/node'
import { neon } from '@neondatabase/serverless'

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

function optText(v: unknown, maxLen: number): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim().slice(0, maxLen)
  return t.length > 0 ? t : null
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const sql = getSql()

    if (req.method === 'GET') {
      const lists = await sql`
        SELECT l.id, l.name, l.created_at, COUNT(i.id)::int AS item_count
        FROM lists l
        LEFT JOIN items i ON i.list_id = l.id
        GROUP BY l.id
        ORDER BY l.created_at ASC
      `
      return res.status(200).json(lists)
    }

    if (req.method === 'POST') {
      const name = optText(req.body?.name, 100)
      if (!name) return res.status(400).json({ error: 'List name is required' })
      const rows = await sql`
        INSERT INTO lists (name) VALUES (${name})
        RETURNING id, name, created_at, 0 AS item_count
      `
      return res.status(201).json(rows[0])
    }

    res.setHeader('Allow', 'GET, POST')
    return res.status(405).json({ error: 'Method not allowed' })
  } catch (err) {
    console.error(err)
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Internal server error',
    })
  }
}
