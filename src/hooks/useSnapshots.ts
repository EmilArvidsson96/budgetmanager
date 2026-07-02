import { useEffect, useRef } from 'react'
import { useAppStore } from '@/store'
import { createSnapshot, getLatestSnapshotTime, SNAPSHOT_INTERVAL_MS } from '@/utils/snapshots'

// Captures an automatic backup snapshot at most once per SNAPSHOT_INTERVAL_MS,
// triggered by store changes. Retention/down-sampling is handled inside
// createSnapshot. Local-only; runs independently of GitHub sync.
export function useSnapshots() {
  const lastSnapshotAt = useRef<number | null>(null)
  const ready = useRef(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      lastSnapshotAt.current = await getLatestSnapshotTime()
      if (cancelled) return
      ready.current = true
      // Capture an initial snapshot if none exists or the last is stale.
      const now = Date.now()
      if (lastSnapshotAt.current === null || now - lastSnapshotAt.current >= SNAPSHOT_INTERVAL_MS) {
        try {
          await createSnapshot('auto')
          lastSnapshotAt.current = Date.now()
        } catch {
          /* IndexedDB unavailable (e.g. private mode) — skip silently */
        }
      }
    })()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    const unsub = useAppStore.subscribe(() => {
      if (!ready.current) return
      const now = Date.now()
      if (lastSnapshotAt.current !== null && now - lastSnapshotAt.current < SNAPSHOT_INTERVAL_MS) return
      // Claim the slot immediately so concurrent changes don't double-capture.
      lastSnapshotAt.current = now
      createSnapshot('auto').catch(() => { /* skip on error */ })
    })
    return () => { unsub() }
  }, [])
}
