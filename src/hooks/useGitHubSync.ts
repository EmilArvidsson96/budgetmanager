import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '@/store'
import {
  loadSyncConfig,
  fetchFromGitHub,
  pushToGitHub,
  updateSyncMeta,
  extractAppStateForSync,
} from '@/utils/githubSync'

export type SyncStatus = 'idle' | 'syncing' | 'error' | 'ok'

// Module-level sync state shared across all consumers without adding to Zustand.
let _status: SyncStatus = 'idle'
let _error: string | null = null
let _lastSyncedAt: string | null = null
let _currentSha: string | null = null
let _debounceTimer: ReturnType<typeof setTimeout> | null = null
let _suppressNextPush = false  // set true while loading from GitHub to skip echo push
// Blocks all pushes until the initial pull-and-decide has finished. Without this,
// a device that already has local data could push it and clobber the remote file
// before it has even read what's there. Only released once the startup flow
// decides the local copy is the one to keep.
let _initialSyncDone = false

const _listeners = new Set<() => void>()

function notifyListeners() {
  _listeners.forEach((fn) => fn())
}

function setStatus(status: SyncStatus, error?: string, syncedAt?: string) {
  _status = status
  _error = error ?? null
  if (syncedAt) _lastSyncedAt = syncedAt
  notifyListeners()
}

export function useSyncStatus() {
  const [, tick] = useState(0)
  useEffect(() => {
    const fn = () => tick((n) => n + 1)
    _listeners.add(fn)
    return () => { _listeners.delete(fn) }
  }, [])
  return { status: _status, error: _error, lastSyncedAt: _lastSyncedAt }
}

async function doPush(): Promise<void> {
  const config = loadSyncConfig()
  if (!config?.token) return

  setStatus('syncing')
  try {
    const state = extractAppStateForSync(useAppStore.getState() as unknown as Record<string, unknown>)
    const pushedAt = new Date().toISOString()
    const sha = await pushToGitHub(config, state, _currentSha, pushedAt)
    _currentSha = sha
    updateSyncMeta({ lastPushedAt: pushedAt, lastFileSha: sha })
    setStatus('ok', undefined, pushedAt)
  } catch (err) {
    setStatus('error', String(err))
  }
}

export async function triggerManualSync(): Promise<void> {
  // Refuse to push before the initial pull succeeded — pushing stale local data
  // here could overwrite a populated remote file this device never read.
  if (!_initialSyncDone) {
    setStatus('error', 'Kan inte synka: den första hämtningen från GitHub är inte klar. Ladda om sidan och försök igen.')
    return
  }
  if (_debounceTimer) {
    clearTimeout(_debounceTimer)
    _debounceTimer = null
  }
  await doPush()
}

export function useGitHubSync() {
  const initDone = useRef(false)

  // On mount: pull from GitHub if configured and newer
  useEffect(() => {
    if (initDone.current) return
    initDone.current = true

    const config = loadSyncConfig()
    if (!config?.token) return

    ;(async () => {
      setStatus('syncing')
      try {
        const result = await fetchFromGitHub(config)

        if (!result || !result.file) {
          // File doesn't exist (result null) or is genuinely empty (size 0). Only
          // in these cases is it safe to upload local data — fetchFromGitHub throws
          // rather than returning here for a populated-but-unreadable file, so a
          // device can never clobber real remote data it merely failed to read.
          const state = extractAppStateForSync(useAppStore.getState() as unknown as Record<string, unknown>)
          const pushedAt = new Date().toISOString()
          const sha = await pushToGitHub(config, state, result?.sha ?? null, pushedAt)
          _currentSha = sha
          updateSyncMeta({ lastPushedAt: pushedAt, lastFileSha: sha })
          _initialSyncDone = true
          setStatus('ok', undefined, pushedAt)
          return
        }

        _currentSha = result.sha
        const { file } = result
        const lastPushedAt = config.lastPushedAt

        if (!lastPushedAt || file.pushedAt > lastPushedAt) {
          // GitHub has data this device hasn't seen (never synced, or remote is
          // newer) — load it into the store. This is the path a fresh phone takes:
          // it pulls the desktop's data instead of pushing its own stale copy.
          _suppressNextPush = true
          const incoming = file.state as Record<string, unknown>

          // Preserve local sensitive fields the server copy doesn't have
          const localSettings = useAppStore.getState().settings
          if (incoming.settings && localSettings.anthropicApiKey) {
            incoming.settings = {
              ...(incoming.settings as Record<string, unknown>),
              anthropicApiKey: localSettings.anthropicApiKey,
            }
          }

          useAppStore.setState(incoming, false)
          updateSyncMeta({ lastPushedAt: file.pushedAt, lastFileSha: result.sha })
          _initialSyncDone = true
          setStatus('ok', undefined, file.pushedAt)
        } else {
          // This device previously pushed and the remote hasn't moved since — our
          // local copy is authoritative. Refresh the SHA with a no-op-ish push.
          const state = extractAppStateForSync(useAppStore.getState() as unknown as Record<string, unknown>)
          const pushedAt = new Date().toISOString()
          const sha = await pushToGitHub(config, state, _currentSha, pushedAt)
          _currentSha = sha
          updateSyncMeta({ lastPushedAt: pushedAt, lastFileSha: sha })
          _initialSyncDone = true
          setStatus('ok', undefined, pushedAt)
        }
      } catch (err) {
        // Leave _initialSyncDone false so no auto-push fires after a failed read —
        // a device that couldn't read the remote must never overwrite it.
        setStatus('error', String(err))
      }
    })()
  }, [])

  // Subscribe to store changes and schedule a debounced push
  useEffect(() => {
    const unsub = useAppStore.subscribe(() => {
      if (_suppressNextPush) {
        _suppressNextPush = false
        return
      }
      // Never auto-push before the initial pull has completed successfully —
      // otherwise a device with stale local data could overwrite the remote
      // file before it has read it.
      if (!_initialSyncDone) return
      const config = loadSyncConfig()
      if (!config?.token) return

      if (_debounceTimer) clearTimeout(_debounceTimer)
      _debounceTimer = setTimeout(() => {
        _debounceTimer = null
        doPush()
      }, 5000)
    })
    return () => {
      unsub()
      if (_debounceTimer) {
        clearTimeout(_debounceTimer)
        _debounceTimer = null
      }
    }
  }, [])
}
