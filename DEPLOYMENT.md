# Deployment Guide — Movie Queue

Everything is built and tested locally. These are the exact steps to get it live
on Vercel with a Neon Postgres database. Expect ~15 minutes, no code changes.

Order matters: **Neon first** (you need the connection string), then **Vercel**.

---

## Step 1 — Push the repo to GitHub

The project is a local git repo with one commit (`main` branch). You need it on
GitHub so Vercel can import it.

> **Note:** your machine's SSH key is not authorized on GitHub (this is why
> `/update` fails on your Hermes repo). Easiest path is the **HTTPS** remote +
> `gh` CLI auth, which avoids SSH entirely.

```sh
cd ~/projects/movie-queue

# Option A — GitHub CLI (recommended; handles auth over HTTPS):
brew install gh          # if you don't have it
gh auth login            # choose: GitHub.com → HTTPS → login via browser
gh repo create movie-queue --private --source=. --push

# Option B — manual:
# 1. Create an empty repo at https://github.com/new (no README/gitignore)
# 2. Then:
git remote add origin https://github.com/<your-username>/movie-queue.git
git push -u origin main
```

Verify: the repo page on github.com shows your files (src/, api/, schema.sql…).

---

## Step 2 — Create the Neon database

1. Go to https://console.neon.tech and sign in (GitHub login works; free tier
   is plenty for this app).
2. **Create a project**:
   - Name: `movie-queue` (anything works)
   - Region: pick the US-East region (matches Vercel's `iad1` default — keeps
     latency low)
   - Postgres version: leave the default
3. Once created, open the project → **SQL Editor** in the left sidebar.
4. Open `schema.sql` from this repo (any text editor), copy the **entire**
   contents, paste into the SQL Editor, and click **Run**.
   You should see: `CREATE TABLE`, `CREATE TABLE`, `CREATE INDEX` — three
   statements, no errors.
5. Get your connection string:
   - Left sidebar → **Connection Details** (or Dashboard → "Connect")
   - Select: **Pooled connection** (important — the pooled string works with
     Vercel's serverless functions; the direct/unpooled one can exhaust
     connections)
   - Copy the string. It looks like:
     `postgresql://user:***@ep-something-12345678-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require`
   - If it offers a "password shown once" dialog, copy it now — Neon hides it
     afterward (you can always reset the password from the same screen).

Keep this string handy for Step 3. Don't paste it into chat or commit it.

**Sanity check (optional):** in the Neon SQL Editor run
`SELECT * FROM lists;` — should return 0 rows, no error. That confirms the
schema applied.

---

## Step 3 — Deploy on Vercel

1. Go to https://vercel.com/new and sign in **with GitHub** (so it can see
   your repos).
2. Find `movie-queue` in the list → **Import**.
   - If it's not listed: click "Adjust GitHub App Permissions" and grant access
     to that repo.
3. On the configure screen:
   - **Framework Preset**: should auto-detect **Vite** — leave it.
   - **Build / Output / Install commands**: leave all defaults
     (`npm install`, `npm run build`, output `dist`).
   - **Environment Variables** — add these BEFORE hitting Deploy:
     | Name           | Value                                |
     |----------------|--------------------------------------|
     | `DATABASE_URL` | the pooled Neon string from Step 2.5 |
     | `PASSCODE`     | your site unlock passcode (see Step 4) |
     | `TMDB_API_KEY` | free TMDB v3 API key (see Step 4b) |
   - Alternative to typing it: install the **Neon integration**
     (https://vercel.com/integrations/neon) which links the Neon project and
     injects `DATABASE_URL` automatically. Either way works; the manual env
     var is the fastest path today.
4. Click **Deploy**. Wait ~1 minute for the build.
5. When it finishes you get a URL like `https://movie-queue-xxxx.vercel.app`.
   Open it.

### Verify the deployment

On the live site:
1. Tap the **+** next to the list selector → create a list ("Test List").
2. Tap **Add** → enter a title + an IMDb URL → **Add item**.
3. The card should appear with the status badge; reload the page — it must
   still be there (that proves Neon persistence, not just browser state).
4. Delete the test item and list.

If you see an error toast instead: Vercel project → **Deployments → current →
Functions** tab shows per-function logs; 95% of the time it's a missing or
mistyped `DATABASE_URL` (make sure it's the **pooled** string and includes
`?sslmode=require`).

---

## Step 4 — Passcode protection (implemented — just set PASSCODE)

The repo includes `middleware.ts`, a Vercel Edge Middleware that gates the
whole site behind a passcode:

- Unauthenticated visitors see a built-in unlock page (served by the
  middleware itself, works even if the SPA is broken).
- A correct passcode sets an HttpOnly cookie (`mq_auth`, sha256-hashed value,
  ~6-month expiry) — subsequent requests pass through, including all `/api/*`
  calls. Wrong cookie / expired cookie on an API call returns `401 JSON`, and
  the frontend reloads to show the unlock page.
- **Fail-open:** if `PASSCODE` is not set, the gate is disabled and the site is
  publicly accessible (so the deploy is never bricked before you configure it).

To enable:

1. Pick a passcode. Generate one with: `openssl rand -hex 8`
   (or use any memorable phrase — it's your personal site).
2. Vercel → Project → **Settings → Environment Variables** → add `PASSCODE`
   with that value, applying to Production (and Preview if you want).
3. **Redeploy** (Deployments → ⋯ → Redeploy). Env vars don't apply to
   already-built deployments.
4. Visit the site → you should get the unlock page. Enter the passcode once;
   you stay unlocked for ~6 months per browser.

To rotate: change `PASSCODE` and redeploy — all existing cookies stop working
(the cookie stores a hash of the old passcode).

Notes:
- This is casual protection (keeps out strangers and bots), not real auth —
  there are no per-user accounts by design.
- The middleware matcher excludes `/assets/*` and the favicon (static files
  contain no data); everything else — HTML pages and all API routes — is gated.

---

## Step 4b — TMDB API key (optional, enables poster/title search)

The "Add item" dialog has a TMDB search box: type a title, tap the result, and
title + poster + IMDb link auto-fill. It needs a free API key:

1. Create an account at https://www.themoviedb.org (free).
2. Open https://www.themoviedb.org/settings/api → **Request an API Key** →
   choose **Developer** → accept the terms, fill the short form
   (for "Application Name" put e.g. "personal movie tracker", for URL your
   Vercel site address; personal/non-commercial use is approved instantly).
3. Copy the **API Key (v3 auth)** value.
4. Vercel → Project → **Settings → Environment Variables** → add
   `TMDB_API_KEY` with that value → **Redeploy**.

Cost: $0 for non-commercial use (rate limit ~40-50 req/10s — far more than a
personal tracker generates). The app shows the required TMDB attribution line
in the search dialog. If the key is unset or wrong, search shows a
"not configured" message and manual entry keeps working — nothing breaks.

---

## Step 5 — Local development against the real DB (optional)

Only needed when you want to make changes:

```sh
cd ~/projects/movie-queue

# 1. Get the real connection strings into .env.local (git-ignored).
#    Easiest — Neon CLI (one-time browser login, then it pulls them for you):
#      npm i -g neonctl && neonctl login
#      neonctl link        # pick the movie-queue project
#    This writes DATABASE_URL + DATABASE_URL_UNPOOLED (and gitignores .neon).
#    Manual alternative: copy the POOLED connection string from the Neon
#    console into .env.local as DATABASE_URL. Optionally add your PASSCODE
#    value there too if you want to test the gate locally.

# 2. Terminal 1 — serverless functions locally (uses .env.local):
npx vercel dev --listen 3001
#    (first run asks to link the project — say yes, pick movie-queue)

# 3. Terminal 2 — frontend with hot reload (proxies /api → :3001):
npm run dev
#    → open http://localhost:5173
```

Local dev hits the **same Neon database** as production. If you want
isolation, create a second Neon project (or a Neon **branch** — the console
has one-click branching) and put that string in `.env.local` instead.

### Making changes later

```sh
git add -A && git commit -m "describe your change"
git push        # Vercel auto-deploys every push to main
```

Preview builds get their own URL for each branch/PR automatically.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `DATABASE_URL is not set` toast on the live site | Env var missing — add it in Vercel Settings → Environment Variables, then **Redeploy** (Deployments → … → Redeploy). Env changes don't apply to existing builds. |
| Everything loads but lists never appear | Check the Functions logs (Deployments → Functions). Usually a wrong/expired password in the connection string — reset it in Neon, update the env var, redeploy. |
| `relation "lists" does not exist` in logs | schema.sql wasn't run (or was run against a different Neon project/branch). Re-run it in the SQL Editor of the project matching your connection string. |
| Build fails on Vercel but works locally | Delete the Vercel deployment and re-import, or check that the repo push included `package-lock.json` (it must — Vercel uses it for reproducible installs). |
| Poster images don't show | The poster URL must be a direct image link (ends in .jpg/.png or serves an image) and the host must allow hotlinking. IMDb page URLs are NOT image URLs — grab the poster from TMDB (right-click poster on themoviedb.org → copy image address) or any image host. |

---

## Quick reference

- Repo: `~/projects/movie-queue` (branch `main`, one commit)
- Schema: `schema.sql` — run once in Neon SQL Editor
- Env var: `DATABASE_URL` = Neon **pooled** connection string (Vercel + `.env.local`)
- Live logs: Vercel → Project → Deployments → Functions
- DB console: https://console.neon.tech → your project → SQL Editor / Tables
