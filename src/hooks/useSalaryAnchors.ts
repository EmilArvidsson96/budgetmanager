import { useMemo } from 'react'
import { useAppStore } from '@/store'
import { getSalaryAnchors, type SalaryAnchorInfo } from '@/utils/salaryDetection'

// React-facing wrapper around getSalaryAnchors. Memoized on the inputs detection
// actually reads, so the anchors object is stable across renders (important: it's
// used in other useMemo dependency arrays for bucketing). Kept separate from the
// pure detection module so the store can import detection without an import cycle.
export function useSalaryAnchors(): SalaryAnchorInfo {
  const allTransactions = useAppStore((s) => s.allTransactions)
  const settings = useAppStore((s) => s.settings)
  const transactionOverrides = useAppStore((s) => s.transactionOverrides)

  return useMemo(
    () => getSalaryAnchors({ allTransactions, settings, transactionOverrides }),
    [allTransactions, settings, transactionOverrides]
  )
}
