// One-shot migration: add items.position, backfill from current display order
// (created_at DESC — newest first, matching the current UI), add sort index.
import { readFileSync } from 'node:fs'
import { neon } from '@neondatabase/serverless'

const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
const url = env.match(/^DATABASE_URL="?(.+?)"?$/m)?.[1]
if (!url) throw new Error('DATABASE_URL not found in .env.local')
const sql = neon(url)

console.log('1. ALTER TABLE ...')
await sql`ALTER TABLE items ADD COLUMN IF NOT EXISTS position INTEGER NOT NULL DEFAULT 0`

console.log('2. Backfill positions (per list, newest first = 1)...')
const updated = await sql`
  WITH ranked AS (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY list_id ORDER BY created_at DESC, id DESC) AS rn
    FROM items
  )
  UPDATE items SET position = ranked.rn FROM ranked WHERE items.id = ranked.id
`
console.log('   result:', JSON.stringify(updated))

console.log('3. CREATE INDEX ...')
await sql`CREATE INDEX IF NOT EXISTS items_list_position_idx ON items(list_id, position)`

console.log('4. Verify:')
const rows = await sql`SELECT list_id, id, title, position FROM items ORDER BY list_id, position`
for (const r of rows) console.log(`   list ${r.list_id}: #${r.position} id=${r.id} ${r.title}`)
console.log('Migration done.')
