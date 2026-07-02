// Local backup/rollback snapshots, stored in IndexedDB (the persisted app state
// can exceed localStorage's ~5 MB quota once transaction history grows).
//
// Snapshots are captured at most once per 10 minutes and then down-sampled by age
// so storage stays bounded while keeping a useful rollback horizon:
//   • younger than 1 week   → keep one per 10 minutes
//   • 1 week – 1 month      → keep one per day
//   • 1 – 3 months          → keep one per week
//   • older than 3 months   → keep one per month
//
// Snapshots are per-device (local only). Cross-device history already lives in the
// GitHub sync repo's commit log.

import { useAppStore } from '@/store'

const DB_NAME = 'budgethanteraren-backups'
const STORE = 'snapshots'
const DB_VERSION = 1

export const SNAPSHOT_INTERVAL_MS = 10 * 60 * 1000  // 10 minutes
const MAX_SNAPSHOTS = 1000                            // hard safety cap

const MINUTE = 60 * 1000
const DAY = 24 * 60 * MINUTE
const WEEK = 7 * DAY

export interface Snapshot {
  id: string                       // ISO timestamp (unique key)
  takenAt: string                  // ISO
  appVersion?: number
  reason: 'auto' | 'manual' | 'pre-restore'
  state: Record<string, unknown>   // full persisted app state
}

// Keys of AppState we snapshot — the full persisted model, including local-only
// secrets (they never leave the device).
const STATE_KEYS = [
  'settings', 'budgetBaseline', 'budgetOverrides', 'budgetHistory', 'planGrid',
  'monthlyBudgets', 'yearlyBudgets', 'actuals', 'liquidityPlans', 'groceryReceipts',
  'allTransactions', 'transactionOverrides', 'lastZlantarImport', 'importSnapshots',
  'reconciliations', 'importConflicts', 'monthCloses', 'wealthForecasts',
]

export function captureCurrentState(): Record<string, unknown> {
  const full = useAppStore.getState() as unknown as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const k of STATE_KEYS) {
    if (k in full) out[k] = full[k]
  }
  return out
}

// ─── IndexedDB plumbing ────────────────────────────────────────────────────────

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  const db = await openDB()
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode)
    const store = tx.objectStore(STORE)
    const req = fn(store)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
    tx.oncomplete = () => db.close()
  })
}

export async function listSnapshots(): Promise<Snapshot[]> {
  const all = await withStore<Snapshot[]>('readonly', (s) => s.getAll() as IDBRequest<Snapshot[]>)
  // Newest first.
  return all.sort((a, b) => b.takenAt.localeCompare(a.takenAt))
}

export async function getSnapshot(id: string): Promise<Snapshot | undefined> {
  return withStore<Snapshot | undefined>('readonly', (s) => s.get(id) as IDBRequest<Snapshot | undefined>)
}

async function putSnapshot(snap: Snapshot): Promise<void> {
  await withStore('readwrite', (s) => s.put(snap))
}

export async function deleteSnapshot(id: string): Promise<void> {
  await withStore('readwrite', (s) => s.delete(id))
}

export async function clearAllSnapshots(): Promise<void> {
  await withStore('readwrite', (s) => s.clear())
}

// ─── Retention / down-sampling ──────────────────────────────────────────────────

// Bucket width (ms) for a snapshot of the given age. One snapshot is kept per
// bucket, so older snapshots are progressively thinned out.
function bucketWidthForAge(ageMs: number): number {
  if (ageMs < WEEK)      return SNAPSHOT_INTERVAL_MS  // < 1 week  → 10 min
  if (ageMs < 30 * DAY)  return DAY                   // < 1 month → 1 day
  if (ageMs < 90 * DAY)  return WEEK                  // < 3 months→ 1 week
  return 30 * DAY                                     // older     → ~1 month
}

// Returns the ids to delete to satisfy the retention policy. Keeps the newest
// snapshot in each age bucket, and always keeps the single most recent snapshot.
export function selectSnapshotsToPrune(snapshots: Snapshot[], now: number): string[] {
  if (snapshots.length <= 1) return []

  // Newest first.
  const sorted = [...snapshots].sort((a, b) => b.takenAt.localeCompare(a.takenAt))
  const keptBuckets = new Set<string>()
  const toDelete: string[] = []

  sorted.forEach((snap, i) => {
    if (i === 0) return  // always keep the most recent
    const t = new Date(snap.takenAt).getTime()
    const age = now - t
    const width = bucketWidthForAge(age)
    const bucketKey = `${width}:${Math.floor(t / width)}`
    if (keptBuckets.has(bucketKey)) {
      toDelete.push(snap.id)
    } else {
      keptBuckets.add(bucketKey)
    }
  })

  // Hard cap: if still over the limit, drop the oldest survivors.
  const survivors = sorted.filter((s) => !toDelete.includes(s.id))
  if (survivors.length > MAX_SNAPSHOTS) {
    const excess = survivors.slice(MAX_SNAPSHOTS)  // oldest, since sorted desc
    for (const s of excess) toDelete.push(s.id)
  }

  return toDelete
}

async function prune(now: number): Promise<void> {
  const all = await listSnapshots()
  const ids = selectSnapshotsToPrune(all, now)
  for (const id of ids) await deleteSnapshot(id)
}

// ─── Public API ─────────────────────────────────────────────────────────────────

// Create a snapshot of the current state, then run retention. `reason` labels it.
export async function createSnapshot(reason: Snapshot['reason']): Promise<Snapshot> {
  const takenAt = new Date().toISOString()
  const snap: Snapshot = {
    id: takenAt,
    takenAt,
    reason,
    state: captureCurrentState(),
  }
  await putSnapshot(snap)
  await prune(Date.now())
  return snap
}

// Restore a snapshot into the live store. Captures the current state first (as a
// 'pre-restore' snapshot) so the restore itself can be undone.
export async function restoreSnapshot(id: string): Promise<void> {
  const snap = await getSnapshot(id)
  if (!snap) throw new Error('Snapshot hittades inte')
  await createSnapshot('pre-restore')
  // Preserve the local Anthropic API key if the snapshot predates one being set.
  const current = useAppStore.getState()
  const incoming = { ...snap.state } as Record<string, unknown>
  if (incoming.settings && current.settings.anthropicApiKey) {
    const s = incoming.settings as Record<string, unknown>
    if (!s.anthropicApiKey) {
      incoming.settings = { ...s, anthropicApiKey: current.settings.anthropicApiKey }
    }
  }
  useAppStore.setState(incoming, false)
}

export async function getLatestSnapshotTime(): Promise<number | null> {
  const all = await listSnapshots()
  if (all.length === 0) return null
  return new Date(all[0].takenAt).getTime()
}
