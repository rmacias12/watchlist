# Movie Queue

A mobile-first web app for tracking movies and TV shows across multiple
lists — a personal watchlist you host yourself. Single user, no accounts:
the whole site sits behind an optional passcode.

Built with React 19 + Vite + TypeScript, shadcn/ui (Tailwind v4), Vercel
serverless functions + Edge Middleware, and Neon Postgres (serverless).

## Features

- Multiple named lists (create, rename, delete)
- Per-item status: Watching / Watched, with filter tabs + counts
  (Watching is the default tab)
- Drag-to-reorder in every tab (touch/mouse drag via a grip handle,
  keyboard: focus handle → Space → arrows → Space); order persists per
  list, and a "Move to top" card action jumps any item to #1. New items
  append at the end. Each card shows its rank within the visible tab
- TMDB search: type a title, pick the result — title, poster, and IMDb
  link auto-fill (requires a free `TMDB_API_KEY`; manual entry always works)
- Duplicate protection: TMDB titles already in the list are offered
  disabled ("In list"), enforced by a partial unique index in Postgres
- Manual entry: title, IMDb/website link, poster image URL, notes
- Dark & light mode: toggle in the header (sun/moon), follows the OS
  preference until you choose explicitly, persists per browser, no flash
  on load — including the passcode login page
- Mobile-first responsive card layout (1 col → 2 col → 3 col), compact
  horizontal cards (poster left, details right)
- Passcode gate via Edge Middleware (cookie-based, no accounts) — set the
  `PASSCODE` env var to enable; unset means open access
- 100% test coverage (Vitest, enforced by thresholds)

## Quick start (local dev)

```sh
npm install
cp .env.example .env.local    # then fill in DATABASE_URL (see below)
npm run dev                   # frontend on :5173
npx vercel dev --listen 3001  # API functions on :3001 (Vite proxies /api to it)
```

The frontend dev server proxies `/api/*` to port 3001, so both commands
run side by side. Without a valid `DATABASE_URL` the API routes return
errors, but the UI still builds and renders.

## Database setup

The app stores everything in Postgres via Neon's serverless driver
(`@neondatabase/serverless`), so a [Neon](https://neon.tech) project is
the path of least resistance — the free tier is plenty. The schema is
plain SQL and will run on any Postgres 14+, but note the bundled driver
talks to Neon's wire protocol endpoint.

1. **Create the database.** Sign in at https://console.neon.tech (GitHub
   login works) and create a project. You get an empty Postgres database
   with a connection string.

2. **Create the tables.** Open the project's **SQL Editor**, paste the
   contents of [`schema.sql`](schema.sql), and run it. It creates two
   tables (`lists`, `items`), their indexes, and a partial unique index
   that blocks the same TMDB title twice in one list. It's idempotent
   (`IF NOT EXISTS`) — safe to re-run. There are no migrations to manage
   beyond this file.

3. **Copy the connection string.** From the Neon dashboard, copy the
   **pooled** connection string (it ends in `-pooler.…`). Put it in
   `.env.local` as `DATABASE_URL`, and in Vercel as the `DATABASE_URL`
   env var (Production) for deployment.

   Alternative: `neonctl login` + `neonctl link` pulls the connection
   string into `.env.local` automatically — no copy/pasting from
   dashboards.

The full step-by-step (GitHub push, Neon, Vercel, env vars, custom
domain) lives in [DEPLOYMENT.md](DEPLOYMENT.md).

## Environment variables

Set these in Vercel project settings for production, and in `.env.local`
for local dev (see `.env.example`):

| Variable       | Required | Purpose                                             |
| -------------- | -------- | --------------------------------------------------- |
| `DATABASE_URL` | yes      | Neon **pooled** Postgres connection string          |
| `PASSCODE`     | no       | Site unlock passcode; **unset = site is open**      |
| `TMDB_API_KEY` | no       | TMDB v3 key for search; unset = search disabled     |

- Generate a passcode: `openssl rand -hex 8`. The gate is fail-open by
  design (local dev works with nothing configured), so if your deployed
  site suddenly shows no passcode page, check that this variable exists.
- Get a free TMDB key: create an account at themoviedb.org → Settings →
  API → request an "API Key (v3 auth)". Free for non-commercial use with
  attribution (shown in the search dialog).
- After setting/changing env vars on Vercel, **Redeploy** — running
  deployments don't pick them up.

## Deploying

1. Push your clone to GitHub.
2. Import the repo at https://vercel.com/new (framework: Vite; the
   `api/` directory and `middleware.ts` are picked up automatically).
3. Add the environment variables above.
4. Deploy. Optionally add a custom domain in Vercel project settings
   (a CNAME to your deployment URL).

The passcode page is rendered by Edge Middleware; the API returns
`401 {"error":"unauthorized"}` to unauthenticated calls and the frontend
reloads to the login page. Sessions last ~6 months (HttpOnly cookie).

## Tests

```sh
npm test                # 159 tests
npm run test:coverage   # must stay at 100% (statements/branches/functions/lines)
```

Coverage policy and testing gotchas for contributors: see [AGENTS.md](AGENTS.md).

## Project structure

```
middleware.ts        Passcode gate (Vercel Edge Middleware)
api/                 Vercel serverless functions (Node) — each file is
                     self-contained by design (see AGENTS.md)
  lists.ts           GET /api/lists, POST /api/lists
  lists/[id].ts      PATCH/DELETE /api/lists/:id
  items.ts           GET /api/items?list_id=, POST /api/items
  items/[id].ts      PATCH/DELETE /api/items/:id
  items/reorder.ts   POST /api/items/reorder
  search.ts          TMDB search proxy (key stays server-side)
src/
  App.tsx            All app state + layout
  components/        item-card, sortable-item-card, item-form-dialog,
                     list-selector, status-badge
  components/ui/     generated shadcn/ui primitives (don't hand-edit)
  lib/               api.ts (typed fetch client), theme.ts, types.ts, utils.ts
tests/               Vitest suites (api, middleware, lib, components, app, theme)
schema.sql           Postgres schema — run once in the Neon SQL editor
DEPLOYMENT.md        Step-by-step Neon/Vercel setup
```

## API

| Method | Path             | Body                                             |
| ------ | ---------------- | ------------------------------------------------ |
| GET    | /api/lists       | —                                                |
| POST   | /api/lists       | `{ name }`                                       |
| PATCH  | /api/lists/:id   | `{ name }`                                       |
| DELETE | /api/lists/:id   | — (items cascade-delete)                         |
| GET    | /api/items       | query: `list_id`                                 |
| POST   | /api/items       | `{ list_id, title, url?, poster_url?, status?, notes?, tmdb_id? }` — 409 if the TMDB id is already in the list |
| PATCH  | /api/items/:id   | any subset of `{ title, url, poster_url, status, notes }` |
| DELETE | /api/items/:id   | —                                                |
| POST   | /api/items/reorder | `{ list_id, ordered_ids }` — persists drag-and-drop order |
| GET    | /api/search      | query: `q` (title search) or `media_type`+`tmdb_id` (IMDb link lookup) |

`status` ∈ `watching` | `watched`.
All endpoints sit behind the passcode middleware when `PASSCODE` is set;
unauthenticated API calls get `401 {"error":"unauthorized"}`.

## Scripts

- `npm run dev` — Vite dev server (proxies `/api` → :3001)
- `npm run build` — type-check (src, tests, api) + production build
- `npm run lint` — oxlint
- `npm test` / `npm run test:coverage` — Vitest
- `npm run preview` — preview the production build locally
