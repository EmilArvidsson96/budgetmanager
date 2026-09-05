// Cloudflare Worker: receives in-app bug/feature reports and files them as
// GitHub issues on the private budgetmanager_data repo. This exists because the
// app itself is a static site with no backend — a GitHub token has to live
// somewhere off the client, and this Worker is that somewhere. It never ships
// the token to the browser; it only ever leaves this Worker as an
// Authorization header on the outbound call to GitHub.
//
// Reports land in the PRIVATE data repo (not the public app repo) because they
// can carry a full app-state snapshot, which may contain real account
// balances and transactions.

export interface Env {
  GITHUB_TOKEN: string
}

const REPO = 'EmilArvidsson96/budgetmanager_data'
const ALLOWED_ORIGIN = 'https://emilarvidsson96.github.io'
const MAX_BODY_BYTES = 500_000
const MAX_ISSUE_BODY_CHARS = 60_000

interface ReportPayload {
  kind?: string
  title?: string
  description?: string
  context?: Record<string, unknown>
  appState?: unknown
}

function corsHeaders(): HeadersInit {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  })
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}\n...[trunkerad]` : text
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() })
    if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

    // Belt-and-suspenders alongside CORS: CORS only stops browsers from reading
    // a cross-origin response, it doesn't stop a direct curl. Checking Origin
    // here rejects casual cross-site abuse too (still not a security boundary
    // against a determined attacker who can spoof headers).
    const origin = request.headers.get('Origin')
    if (origin !== ALLOWED_ORIGIN) return json({ error: 'Forbidden origin' }, 403)

    const contentLength = Number(request.headers.get('Content-Length') ?? '0')
    if (contentLength > MAX_BODY_BYTES) return json({ error: 'Payload too large' }, 413)

    let payload: ReportPayload
    try {
      payload = await request.json()
    } catch {
      return json({ error: 'Invalid JSON' }, 400)
    }

    const title = payload.title?.trim()
    const description = payload.description?.trim()
    const kind = payload.kind === 'enhancement' ? 'enhancement' : payload.kind === 'bug' ? 'bug' : null
    if (!title || !description || !kind) {
      return json({ error: 'title, description and a valid kind are required' }, 400)
    }

    const bodyParts = [description, '', '---', '**Kontext:**', '```json', JSON.stringify(payload.context ?? {}, null, 2), '```']
    if (payload.appState !== undefined) {
      bodyParts.push('', '**App-state:**', '```json', truncate(JSON.stringify(payload.appState, null, 2), MAX_ISSUE_BODY_CHARS), '```')
    }

    const ghRes = await fetch(`https://api.github.com/repos/${REPO}/issues`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'budgetmanager-report-worker',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title,
        body: truncate(bodyParts.join('\n'), 65_000),
        labels: ['in-app-report', kind],
      }),
    })

    if (!ghRes.ok) {
      const text = await ghRes.text()
      return json({ error: `GitHub error ${ghRes.status}: ${text.slice(0, 500)}` }, 502)
    }

    const issue = (await ghRes.json()) as { number: number }
    return json({ ok: true, number: issue.number })
  },
}
