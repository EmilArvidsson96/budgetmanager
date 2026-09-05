// Persists the main app store in IndexedDB instead of localStorage.
//
// The persisted state (transaction history, import snapshots, receipts, ...)
// only grows over years of use and routinely outgrows localStorage's ~5-10 MB
// per-origin quota. Zustand's persist middleware writes to storage on every
// `set()` call, so once that quota is hit, localStorage.setItem throws
// QuotaExceededError *synchronously* inside whatever store action triggered
// it — aborting that action mid-way (e.g. a multi-step import stops partway
// through) while the last-written localStorage copy stays stale. IndexedDB
// has no comparable practical ceiling for this app's data sizes, and writes
// here are async, so a failure can never abort a store action synchronously.
//
// getItem() also does a one-time migration: on first read, if IndexedDB has
// nothing yet but the old localStorage key does, it adopts that value and
// clears the localStorage key so it stops competing for the same quota.

import type { StateStorage } from 'zustand/middleware'

const DB_NAME = 'budgethanteraren-store'
const DB_VERSION = 1
const STORE = 'kv'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function idbGet(key: string): Promise<string | null> {
  const db = await openDb()
  try {
    return await new Promise<string | null>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly')
      const req = tx.objectStore(STORE).get(key)
      req.onsuccess = () => resolve((req.result as string | undefined) ?? null)
      req.onerror = () => reject(req.error)
    })
  } finally {
    db.close()
  }
}

async function idbSet(key: string, value: string): Promise<void> {
  const db = await openDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put(value, key)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } finally {
    db.close()
  }
}

async function idbDel(key: string): Promise<void> {
  const db = await openDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).delete(key)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } finally {
    db.close()
  }
}

export const indexedDbStorage: StateStorage = {
  getItem: async (name) => {
    const fromIdb = await idbGet(name)
    if (fromIdb != null) return fromIdb

    // One-time migration from the old localStorage-backed persist. The copy
    // there may already be stale if this device had started hitting quota
    // errors, but it's still the best available baseline.
    try {
      const legacy = localStorage.getItem(name)
      if (legacy != null) {
        await idbSet(name, legacy)
        localStorage.removeItem(name)
        return legacy
      }
    } catch {
      // localStorage unavailable/blocked — IndexedDB is the only source now.
    }
    return null
  },
  setItem: async (name, value) => {
    await idbSet(name, value)
  },
  removeItem: async (name) => {
    await idbDel(name)
    try { localStorage.removeItem(name) } catch { /* ignore */ }
  },
}
