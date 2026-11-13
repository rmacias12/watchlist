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
    const id = Number(req.query.id)
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid list id' })

    if (req.method === 'PATCH') {
      const name = optText(req.body?.name, 100)
      if (!name) return res.status(400).json({ error: 'List name is required' })
      const rows = await sql`
        UPDATE lists SET name = ${name} WHERE id = ${id}
        RETURNING id, name, created_at
      `
      if (rows.length === 0) return res.status(404).json({ error: 'List not found' })
      return res.status(200).json(rows[0])
    }

    if (req.method === 'DELETE') {
      const rows = await sql`DELETE FROM lists WHERE id = ${id} RETURNING id`
      if (rows.length === 0) return res.status(404).json({ error: 'List not found' })
      return res.status(200).json({ ok: true })
    }

    res.setHeader('Allow', 'PATCH, DELETE')
    return res.status(405).json({ error: 'Method not allowed' })
  } catch (err) {
    console.error(err)
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Internal server error',
    })
  }
}
