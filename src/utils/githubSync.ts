const SYNC_CONFIG_KEY = 'budgethanteraren-sync-v1'
const APP_VERSION = 13

export interface SyncConfig {
  token: string
  owner: string
  repo: string
  path: string
}

interface SyncMeta {
  lastPushedAt: string | null
  lastFileSha: string | null
}

type StoredConfig = SyncConfig & SyncMeta

interface GitHubFileContent {
  pushedAt: string
  appVersion: number
  state: Record<string, unknown>
}

export function loadSyncConfig(): StoredConfig | null {
  try {
    const raw = localStorage.getItem(SYNC_CONFIG_KEY)
    if (!raw) return null
    return JSON.parse(raw) as StoredConfig
  } catch {
    return null
  }
}

export function saveSyncConfig(config: SyncConfig) {
  const existing = loadSyncConfig()
  localStorage.setItem(
    SYNC_CONFIG_KEY,
    JSON.stringify({
      lastPushedAt: null,
      lastFileSha: null,
      ...existing,
      ...config,
    })
  )
}

export function updateSyncMeta(meta: Partial<SyncMeta>) {
  const existing = loadSyncConfig()
  if (!existing) return
  localStorage.setItem(SYNC_CONFIG_KEY, JSON.stringify({ ...existing, ...meta }))
}

export function clearSyncConfig() {
  localStorage.removeItem(SYNC_CONFIG_KEY)
}

function decodeBase64Utf8(b64: string): string {
  return decodeURIComponent(escape(atob(b64.replace(/\s/g, ''))))
}

// Fetches the sync file from GitHub.
//   - Returns null when the file does not exist at all (404).
//   - Returns { file: null, sha } ONLY when the file is genuinely empty (size 0) —
//     the one case where it is safe to overwrite it with local data.
//   - Returns { file, sha } with parsed contents otherwise.
//   - THROWS when the file exists with real content that cannot be retrieved or
//     parsed. Never silently returns null for a non-empty file, so a device can
//     never clobber a populated remote file it merely failed to read.
//
// The Contents API only inlines base64 `content` for files under ~1 MB; larger
// files come back with an empty content field, so we refetch the raw bytes.
export async function fetchFromGitHub(
  config: SyncConfig
): Promise<{ file: GitHubFileContent | null; sha: string } | null> {
  const url = `https://api.github.com/repos/${config.owner}/${config.repo}/contents/${encodeURIComponent(config.path)}`
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${config.token}`,
      Accept: 'application/vnd.github.v3+json',
    },
  })
  if (res.status === 404) return null
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { message?: string }
    throw new Error(`GitHub: ${res.status} ${body.message ?? res.statusText}`)
  }
  const raw = await res.json() as { content?: string; sha: string; size?: number; encoding?: string }

  // A truly empty file (size 0) is the only safe-to-overwrite case.
  if ((raw.size ?? 0) === 0) return { file: null, sha: raw.sha }

  // Get the text: inline base64 when present, otherwise refetch raw (large files).
  let text = ''
  if (raw.content && raw.encoding === 'base64') {
    text = decodeBase64Utf8(raw.content)
  } else {
    const rawRes = await fetch(url, {
      headers: {
        Authorization: `Bearer ${config.token}`,
        Accept: 'application/vnd.github.raw',
      },
    })
    if (!rawRes.ok) {
      throw new Error(`GitHub: kunde inte hämta filinnehåll (${rawRes.status}). Filen finns och lämnas orörd.`)
    }
    text = await rawRes.text()
  }

  const trimmed = text.trim()
  if (!trimmed) {
    // Non-zero size but blank content — ambiguous. Do NOT overwrite; surface it.
    throw new Error('GitHub: filen finns men innehållet kunde inte läsas. Lämnar den orörd för säkerhets skull.')
  }
  try {
    return { file: JSON.parse(trimmed) as GitHubFileContent, sha: raw.sha }
  } catch {
    throw new Error('GitHub: filen innehåller ogiltig JSON. Lämnar den orörd för säkerhets skull.')
  }
}

export async function pushToGitHub(
  config: SyncConfig,
  state: Record<string, unknown>,
  sha: string | null,
  pushedAt: string
): Promise<string> {
  const url = `https://api.github.com/repos/${config.owner}/${config.repo}/contents/${config.path}`
  const file: GitHubFileContent = { pushedAt, appVersion: APP_VERSION, state }
  const content = btoa(unescape(encodeURIComponent(JSON.stringify(file, null, 2))))

  const body: Record<string, unknown> = { message: `Budget sync ${pushedAt}`, content }
  if (sha) body.sha = sha

  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${config.token}`,
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { message?: string }
    throw new Error(`GitHub push: ${res.status} ${err.message ?? res.statusText}`)
  }
  const result = await res.json() as { content: { sha: string } }
  return result.content.sha
}

export function extractAppStateForSync(
  storeState: Record<string, unknown>
): Record<string, unknown> {
  const keys = [
    'settings', 'budgetBaseline', 'budgetOverrides', 'budgetHistory', 'planGrid',
    'monthlyBudgets', 'yearlyBudgets', 'actuals', 'liquidityPlans', 'groceryReceipts',
    'allTransactions', 'transactionOverrides', 'lastZlantarImport', 'importSnapshots',
    'reconciliations', 'importConflicts', 'monthCloses', 'wealthForecasts',
  ]
  const out: Record<string, unknown> = {}
  for (const k of keys) {
    if (k in storeState) out[k] = storeState[k]
  }
  // Strip sensitive data before uploading
  if (out.settings) {
    const s = { ...(out.settings as Record<string, unknown>) }
    delete s.anthropicApiKey
    out.settings = s
  }
  return out
}
