// Vercel Edge Middleware — site-wide passcode gate.
//
// Auth model: a cookie `mq_auth` whose value is sha256("<passcode>:movie-queue").
// - PASSCODE env var set + valid cookie      -> request continues
// - PASSCODE set + form POST with passcode   -> set cookie, redirect /
// - PASSCODE set + no cookie, HTML request   -> inline login page
// - PASSCODE set + no cookie, other request  -> 401 JSON (frontend reloads to login)
// - PASSCODE NOT set                         -> gate open (fail-open so the site
//   is never bricked before the env var is configured)
//
// Uses only standard Web APIs (Request/Response/WebCrypto) so it runs on the
// Edge runtime and is unit-testable under plain Node.

export const config = {
  // Everything except hashed static assets, the favicon, and the iOS
  // home-screen icon (all static, so the gate must not intercept them).
  matcher: ['/((?!assets/|favicon.svg|apple-touch-icon.png).*)'],
}

const COOKIE = 'mq_auth'
const SALT = 'movie-queue'
const MAX_AGE = 60 * 60 * 24 * 180 // ~6 months

async function sha256hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function getCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) return decodeURIComponent(rest.join('='))
  }
  return undefined
}

function loginPage(error: boolean): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<meta name="robots" content="noindex"/>
<title>Watchlist — Passcode</title>
<style>
  :root { color-scheme: light; }
  html.dark { color-scheme: dark; }
  body { margin:0; min-height:100dvh; display:flex; align-items:center; justify-content:center;
         font-family: system-ui, -apple-system, sans-serif; background:#fafafa; color:#171717; }
  html.dark body { background:#171717; color:#fafafa; }
  form { width:min(90vw, 340px); padding:28px 24px; border:1px solid rgba(127,127,127,.25);
         border-radius:12px; background:rgba(127,127,127,.06); display:grid; gap:14px; }
  h1 { margin:0; font-size:18px; }
  p { margin:0; font-size:13px; opacity:.7; }
  input { padding:10px 12px; font-size:16px; border:1px solid rgba(127,127,127,.4);
          border-radius:8px; background:transparent; color:inherit; }
  button { padding:10px 12px; font-size:15px; font-weight:600; border:0; border-radius:8px;
           background:#171717; color:#fafafa; cursor:pointer; }
  html.dark button { background:#fafafa; color:#171717; }
  .error { color:#dc2626; font-size:13px; }
  html.dark .error { color:#f87171; }
</style>
<script>
  // Match the app's theme choice (localStorage) or the OS preference.
  try {
    var t = localStorage.getItem('mq_theme');
    if (t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches) {
      document.documentElement.classList.add('dark');
    }
  } catch (e) {}
</script>
</head>
<body>
<form method="POST" action="/">
  <h1>Watchlist</h1>
  <p>This site is passcode-protected.</p>
  ${error ? '<p class="error">Wrong passcode — try again.</p>' : ''}
  <input type="password" name="passcode" placeholder="Passcode" autofocus required minlength="1"/>
  <button type="submit">Unlock</button>
</form>
</body>
</html>`
}

function unauthorizedJson(): Response {
  return new Response(JSON.stringify({ error: 'unauthorized' }), {
    status: 401,
    headers: { 'content-type': 'application/json' },
  })
}

export default async function middleware(req: Request): Promise<Response | undefined> {
  const passcode = process.env.PASSCODE
  if (!passcode) return undefined // gate open until PASSCODE is configured

  const expected = await sha256hex(`${passcode}:${SALT}`)

  // Login attempt: urlencoded form POST carrying a passcode field.
  if (req.method === 'POST') {
    const contentType = req.headers.get('content-type') ?? ''
    if (contentType.includes('application/x-www-form-urlencoded')) {
      const body = await req.formData()
      if (body.has('passcode')) {
        const attempt = String(body.get('passcode'))
        if ((await sha256hex(`${attempt}:${SALT}`)) === expected) {
          return new Response(null, {
            status: 302,
            headers: {
              location: '/',
              'set-cookie': `${COOKIE}=${expected}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE}; Secure`,
            },
          })
        }
        return new Response(loginPage(true), {
          status: 401,
          headers: { 'content-type': 'text/html; charset=utf-8' },
        })
      }
    }
  }

  // Authenticated -> continue to the app.
  if (getCookie(req.headers.get('cookie'), COOKIE) === expected) return undefined

  // Unauthenticated.
  const { pathname } = new URL(req.url)
  if (pathname.startsWith('/api/')) return unauthorizedJson()
  const accept = req.headers.get('accept') ?? ''
  if (accept.includes('text/html')) {
    return new Response(loginPage(false), {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    })
  }
  return unauthorizedJson()
}
