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

export async function fetchFromGitHub(
  config: SyncConfig
): Promise<{ file: GitHubFileContent; sha: string } | null> {
  const url = `https://api.github.com/repos/${config.owner}/${config.repo}/contents/${config.path}`
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
  const raw = await res.json() as { content: string; sha: string }
  const decoded = decodeURIComponent(escape(atob(raw.content.replace(/\n/g, ''))))
  return { file: JSON.parse(decoded) as GitHubFileContent, sha: raw.sha }
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
