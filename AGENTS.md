# AGENTS.md — Guidance for AI agents & contributors

Movie Queue: a mobile-first single-user app for tracking movies/TV across
multiple lists. React 19 + Vite + TypeScript + shadcn/ui (Tailwind v4) frontend,
Vercel serverless functions in `api/`, Neon Postgres via `@neondatabase/serverless`.

## Commands

```sh
npm run dev              # Vite dev server :5173 (proxies /api -> :3001)
npm run build            # tsc -b (type-checks src/, tests/, api/) + vite build
npm run lint             # oxlint
npm test                 # vitest run (146 tests)
npm run test:coverage    # vitest + v8 coverage — MUST stay at 100%
```

Local full-stack dev also needs `npx vercel dev --listen 3001`. On this
machine `.env.local` already carries the real `DATABASE_URL` /
`DATABASE_URL_UNPOOLED` (pulled via `neonctl link`); see DEPLOYMENT.md step 5.

## Coverage policy: 100%, enforced

- Tooling: **Vitest + @vitest/coverage-v8** (configured in `vite.config.ts`
  under `test.coverage`). Thresholds are set to **100% for statements,
  branches, functions, and lines** — `npm run test:coverage` fails the run if
  any metric drops. Treat a coverage failure as a broken build.
- Scope: everything in `src/`, `api/`, and `middleware.ts`. Excluded:
  `src/components/ui/**` (generated shadcn primitives — do not hand-edit or
  test them; regenerate with `npx shadcn@latest add <name>`), `src/main.tsx`
  (entry), type-only declarations.
- Rules when changing code:
  1. Every new branch needs a test that exercises BOTH sides. Run
     `npm run test:coverage` and check the "Uncovered Line #s" column.
  2. **Do not write unreachable defensive branches.** v8 counts them and they
     can never be covered. Prefer: non-null assertions where UI state
     guarantees a value (`selectedListId!`), conditionally rendered dialogs
     (`{deletingItem && <AlertDialog open …>}`) so callbacks receive
     narrowed non-null args, and validation at the boundary (API) instead of
     redundant guards in handlers.
  3. Avoid default parameter values on internal helpers unless a caller
     actually omits them (an unused default is an uncoverable branch).
- Test layout: `tests/*.test.ts(x)`, helpers in `tests/helpers.ts`
  (in-memory mock API: `makeDb`, `mockFetch`, `list`, `item`, `flush`).
  API/middleware tests run under node (`// @vitest-environment node` docblock);
  component/App tests under jsdom (default).

## Test-environment gotchas (learned the hard way)

- **Sonner toasts leak across tests.** The toast store is global and survives
  RTL `cleanup()`; stale toasts remount into the next test's `<Toaster>` and
  break text queries. Call `toast.dismiss()` in beforeEach/afterEach.
- **Radix UI in jsdom** needs the polyfills in `tests/setup.ts`
  (ResizeObserver, hasPointerCapture, scrollIntoView) and
  `userEvent.setup({ pointerEventsCheck: 0 })` (Radix sets pointer-events:none
  on body under modals).
- Radix Select/DropdownMenu only open on real pointer events — drive them with
  `userEvent.click`, never synthetic `dispatchEvent`.
- **dnd-kit keyboard drags in jsdom**: user-event's `{Space}` preventDefaults
  on buttons so the KeyboardSensor never activates — dispatch raw
  `fireEvent.keyDown(handle, { code, key, keyCode })` instead. jsdom has no
  layout, so mock `Element.prototype.getBoundingClientRect` to give each
  `[data-item-id]` card a synthetic rect, and stub `window.scrollTo` /
  `Element.prototype.scrollTo` for autoscroll. See app.test.tsx
  ("drag to reorder").
- A `Request` with a string body auto-gets `content-type: text/plain` — to
  test "missing content-type" send a bodyless request.
- Render `<App />` exactly once per test (double render = duplicate
  accessible names = "Found multiple elements" failures).

## Architecture & conventions

- **API functions MUST stay self-contained.** Vercel's ESM builder does not
  reliably bundle modules shared between `api/` functions; a shared import
  (even with a correct path and `.js` extension) can deploy as a function that
  crashes with `ERR_MODULE_NOT_FOUND` at runtime. Small duplicated helpers
  (getSql/optText/isValidStatus, ~30 lines) in each route file are intentional.
  Do not "DRY them up" into `api/_shared.ts`.
- API shape: `GET/POST /api/lists`, `PATCH/DELETE /api/lists/:id`,
  `GET ?list_id=/POST /api/items`, `PATCH/DELETE /api/items/:id`,
  `POST /api/items/reorder` (`{list_id, ordered_ids}` — persists drag order;
  the Neon HTTP driver has no multi-statement transactions, so position
  updates are issued via Promise.all and a partial failure is tolerated),
  `GET /api/search` (TMDB proxy: `?q=` title search, `?media_type=&tmdb_id=`
  IMDb-link lookup; 503 when `TMDB_API_KEY` is unset).
  All errors return `{ "error": string }`; handlers wrap everything in
  try/catch and map to 400/404/405/500. Item PATCH = SELECT, merge in JS,
  UPDATE (the Neon HTTP driver does not support nested `sql` fragments as
  parameter values). Item `status` ∈ `watching` | `watched` (only two
  statuses since the 2026-10 collapse; DB CHECK constraint matches).
  Items carry `tmdb_id` (null for manual entries); POST 409s when the same
  TMDB id already exists in the target list — partial unique index
  `(list_id, tmdb_id) WHERE tmdb_id IS NOT NULL` + pre-check (23505 is caught
  as a race backstop). The add dialog offers already-present search results
  disabled with an "In list" pill (App passes `existingTmdbIds`).
- IDs are `INTEGER GENERATED ALWAYS AS IDENTITY` (int8/bigint comes back from
  Neon as a **string** and would poison the API types); cast aggregates with
  `::int`.
- Frontend data flow: plain `fetch` via the typed client in `src/lib/api.ts`
  (no react-query). A 401 from any API call triggers `window.location.reload()`
  so the middleware can serve the login page (see Passcode below).
- State lives in `App.tsx` (lists, selectedListId, items, filter, dialogs).
  A dedicated effect keeps `selectedListId` valid when lists change; don't
  duplicate selection-fixing logic inside handlers.
- Mobile-first: single-column cards <640px, sticky compact header, `min-h-dvh`,
  no hover-only affordances (touch users can't see them).
- shadcn/ui theme is neutral, defined as oklch CSS variables in
  `src/index.css` under `@theme inline`.

## Passcode gate (middleware.ts)

Vercel Edge Middleware at the repo root. Cookie `mq_auth` = sha256 of
"`<PASSCODE>:movie-queue`"; login form is served inline by the middleware
(no SPA route). **Fail-open**: if `PASSCODE` env var is unset, everything
passes through. Matcher excludes `/assets/`, the favicon, and
`/apple-touch-icon.png` — static icons must bypass the gate so iOS can fetch
the home-screen icon without a session.

Testing with the gate enabled:

- Unit/integration tests are unaffected — they call handlers and the
  middleware directly with mocks; no live site involved.
- Local dev is unaffected — the middleware only runs on Vercel (`PASSCODE` is
  normally absent from `.env.local`).
- Live-site checks (browser automation) use the saved **Hermes vault** login
  for the origin under test — vault entries are origin-pinned, so each
  hostname that serves the app (deployment URL, custom domain) needs its own
  entry with the same passcode. Flow:
  open the unlock page, `browser_vault action=fill` with the handle (the
  secret is injected server-side and never enters the conversation), submit
  the form. The `mq_auth` cookie is HttpOnly and lasts ~6 months, but the
  automation browser may drop it between sessions — just fill+submit again.
  Fallback if no vault entry exists: pause at the unlock page and have the
  USER type the passcode into the browser — agents must never ask for,
  accept, or type the passcode itself.
- For one-off authenticated API calls against production (e.g. invoking a
  temporary migration route), the simplest path is an in-page
  `fetch('/api/…')` from the unlocked browser session — the HttpOnly cookie
  rides along automatically.
- Rotating `PASSCODE` invalidates every cookie (the hash no longer matches),
  including the test browser's — repeat the vault unlock afterwards, and the
  vault entry itself must be updated (`hermes vault rm` + `hermes vault add`).

## Theming (dark/light mode)

Tailwind v4 was already the styling layer; dark mode uses its class-based
variant (`@custom-variant dark` + the `.dark` oklch variable block in
`src/index.css` — both ship with the shadcn setup). The moving parts:

- `src/lib/theme.ts` — `getInitialTheme` (localStorage `mq_theme` wins, else
  `prefers-color-scheme`), `applyTheme` (toggles `.dark` on `<html>`,
  persists, and syncs the `theme-color` meta so the mobile browser chrome
  tint follows the active theme). The toggle button lives in the App header.
- `index.html` has a tiny inline script that applies the stored theme BEFORE
  first paint (no light/dark flash), including the `theme-color` meta for
  dark. It's plain JS in the HTML shell, outside coverage scope — keep it in
  sync with theme.ts manually.
- `public/apple-touch-icon.png` (180×180, full-bleed dark tile + white
  clapperboard — iOS applies its own corner mask) backs the home-screen icon;
  the SVG favicon backs browser tabs. Regenerate both together if the icon
  changes.
- The middleware login page (`middleware.ts`) can't import app code (Edge
  runtime, self-contained), so it carries its own copy of the same inline
  script + `.dark` CSS rules. Update all THREE places together if the storage
  key or theme model changes.
- jsdom note: `tests/setup.ts` stubs `window.matchMedia` (matches:false);
  theme tests re-stub per case. Clear `localStorage` + the `.dark` class in
  afterEach or theme state leaks between tests.

## Repo/config gotchas

- Template tsconfigs are JSONC (comments) — strict-JSON tools refuse to patch
  them; rewrite whole files instead.
- TypeScript 6: never add `baseUrl` (TS5101); `paths` alone works.
- `tests/` and `api/` ARE type-checked by `npm run build`
  (tsconfig.app.json includes src+tests; tsconfig.node.json includes
  vite.config.ts+api). Keep it that way.
- Use `import.meta.dirname`, not `__dirname`, in vite.config.ts.
- Deploy flow: push to `main` → Vercel auto-builds. Env vars: `DATABASE_URL`
  (Neon pooled), `PASSCODE`, `TMDB_API_KEY`. Adding/changing env vars requires
  a **Redeploy**. The Vercel CLI is installed and logged in on this machine
  (`vercel whoami`); `vercel env pull` still redacts sensitive values to
  `[SENSITIVE]` placeholders — use `neonctl link` for the real DB URLs.
- Schema changes: edit `schema.sql` AND run the migration on the live DB;
  nothing auto-migrates. Preferred path (set up on this machine): the Neon
  CLI is authed (`neonctl`, project `royal-glade-33438308` linked), so
  `.env.local` carries the real `DATABASE_URL`/`DATABASE_URL_UNPOOLED`.
  Run one-off SQL with `node --env-file=.env.local --input-type=module -e
  "import { neon } from '@neondatabase/serverless'; …"` — the `psql` on PATH
  is a Docker shim and Docker is not running, and `neonctl psql` needs Docker
  too. Verify with a SELECT after every DDL/DML. Fallback if the CLI is
  unavailable: temporary one-shot migration route in `api/` (fixed,
  idempotent SQL), deployed → invoked once → removed in the next commit.
- TMDB auth quirk: the project key gets 401 with `Authorization: Bearer` —
  authenticate with the api_key query param instead (what `api/search.ts`
  does). Legacy IMDb-linked rows were backfilled to `tmdb_id` via TMDB
  `/find/{tt}?external_source=imdb_id` (one-shot, complete: 57/57; the only
  NULL rows left are ones with no URL at all).
- Drag-to-reorder: dnd-kit. Cards sort by `items.position` (GET returns them
  in order); new items get `MAX(position)+1` so they append at the end (the
  card menu's "Move to top" jumps one to #1). Dragging is enabled in EVERY
  filter view: `handleDragEnd` rebuilds the FULL list order (`arrayMove` on
  the unfiltered `items`), so a filtered drag drops the item into the target's
  full-list slot and hidden items keep their relative positions.
  Each card also displays a rank badge (`#N`, dimmed span in the card
  header): the index in the VISIBLE (filtered) order via the `rankById` memo
  in App.tsx — every tab numbers from #1; in the All view it equals the full
  list order and follows live drags. `position` itself
  is NOT a display rank (new items push it to 0/-1/-2…). The card actions
  menu also has "Move to top" (`handleMoveToTop`): it rebuilds the FULL list
  order and persists via the same reorder endpoint, so it is safe in filtered
  views too — as is dragging now.
- Filter tab strip: `TabsList` gets `overflow-x-auto overflow-y-hidden` +
  hidden scrollbars and every `TabsTrigger` gets `shrink-0` (via className in
  App.tsx, never by editing `ui/` primitives) so the chips swipe inside their
  gray container on phones instead of bleeding out. `overflow-y-hidden` is
  required — `overflow-x:auto` alone silently makes BOTH axes scrollable
  (1px of vertical overflow = rubber-band wobble).

## Definition of done for any change

1. `npm run build` clean, `npm run lint` clean (advisory warnings OK).
2. `npm test` green and `npm run test:coverage` at 100/100/100/100.
3. New API behavior covered in `tests/api.test.ts`; new UI behavior covered in
   `tests/app.test.tsx` (integration-first) or `tests/components.test.tsx`.
4. Commit message describes the change; push to `main` to deploy.
