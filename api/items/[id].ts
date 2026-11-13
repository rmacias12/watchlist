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
    const id = Number(req.query.id)
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid item id' })

    if (req.method === 'PATCH') {
      const body = req.body ?? {}

      const existing = await sql`SELECT * FROM items WHERE id = ${id}`
      if (existing.length === 0) return res.status(404).json({ error: 'Item not found' })
      const current = existing[0] as Record<string, unknown>

      // Merge: use provided fields, fall back to current values
      let title = current.title as string
      if (body.title !== undefined) {
        const t = optText(body.title, 300)
        if (!t) return res.status(400).json({ error: 'title cannot be empty' })
        title = t
      }

      let status = current.status as string
      if (body.status !== undefined) {
        if (!isValidStatus(body.status)) return res.status(400).json({ error: 'Invalid status' })
        status = body.status
      }

      const url =
        body.url !== undefined ? optText(body.url, 2000) : (current.url as string | null)
      const posterUrl =
        body.poster_url !== undefined
          ? optText(body.poster_url, 2000)
          : (current.poster_url as string | null)
      const notes =
        body.notes !== undefined ? optText(body.notes, 5000) : (current.notes as string | null)

      const rows = await sql`
        UPDATE items SET
          title = ${title},
          url = ${url},
          poster_url = ${posterUrl},
          status = ${status},
          notes = ${notes},
          updated_at = now()
        WHERE id = ${id}
        RETURNING *
      `
      return res.status(200).json(rows[0])
    }

    if (req.method === 'DELETE') {
      const rows = await sql`DELETE FROM items WHERE id = ${id} RETURNING id`
      if (rows.length === 0) return res.status(404).json({ error: 'Item not found' })
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
