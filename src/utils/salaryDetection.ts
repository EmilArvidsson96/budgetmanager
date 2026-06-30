// Salary detection — find the date salary actually landed each month so a budget
// period can begin "when the salary comes" instead of on a fixed nominal day.
//
// Why: a fixed monthStartDay (+ the simple Sat/Sun→Fri shift) only approximates
// payday. Real salary dates wobble (employer differences, red days), so the fixed
// boundary mis-buckets the salary itself or nearby transactions. Zlantar already
// tags income as category 'salary' → income/salary, so we can pin the boundary to
// the real credit.
//
// Approach: for each calendar month, search a window around the expected payday
// (monthStartDay ± windowDays, clamped to within the month) for income/salary
// credits above a threshold, and take the EARLIEST significant one as the anchor —
// i.e. the period begins when the household's money first arrives. With two
// earners, the second salary a few days later falls naturally into the same period.
//
// The window is clamped to the calendar month so anchors[M] always lands within
// month M, which is the invariant getMonthIdForDate relies on (see periodUtils).

import type {
  ZlantarTransaction,
  CategoryDef,
  ZlantarCategoryRule,
  TxOverride,
  AppSettings,
} from '@/types'
import type { SalaryAnchors } from '@/utils/periodUtils'
import { resolveTxCategory } from '@/utils/zlantarParser'

export interface SalaryAnchorInfo {
  // Period id "YYYY-MM" → ISO date that period begins. Undefined when the feature
  // is off or nothing was detected, so callers can pass it straight to the period
  // helpers (which treat undefined as "use nominal monthStartDay").
  anchors?: SalaryAnchors
  // Period ids that have activity but no salary could be identified — surfaced in
  // the UI so the user knows those months fell back to the expected payday.
  flaggedMonths: string[]
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate()
}

// Core detection. Pure — takes everything it needs as arguments.
export function detectSalaryAnchors(
  transactions: ZlantarTransaction[],
  categories: CategoryDef[],
  rules: ZlantarCategoryRule[],
  overrides: Record<string, TxOverride>,
  monthStartDay: number,
  windowDays: number,
  minAmount: number
): SalaryAnchorInfo {
  // Earliest qualifying salary tx per calendar month (period id → ISO date).
  const anchors: SalaryAnchors = {}
  // Every period that has any non-transfer activity — used to flag the gaps.
  const activeMonths = new Set<string>()

  for (const tx of transactions) {
    if (!tx.date || tx.transaction_type === 'transfer') continue

    const year = parseInt(tx.date.slice(0, 4))
    const month = parseInt(tx.date.slice(5, 7))
    const day = parseInt(tx.date.slice(8, 10))
    const periodId = `${year}-${String(month).padStart(2, '0')}`
    activeMonths.add(periodId)

    if (tx.amount < minAmount) continue

    const { catId, subId } = resolveTxCategory(tx, categories, rules, overrides)
    if (catId !== 'income' || subId !== 'salary') continue

    // Only credits inside the payday window count, so a mid-month bonus or a
    // back-pay run doesn't hijack the boundary.
    const dim = daysInMonth(year, month)
    const lo = Math.max(1, monthStartDay - windowDays)
    const hi = Math.min(dim, monthStartDay + windowDays)
    if (day < lo || day > hi) continue

    // Earliest qualifying credit wins — the period starts when money first lands.
    const existing = anchors[periodId]
    if (!existing || tx.date < existing) anchors[periodId] = tx.date
  }

  const flaggedMonths = [...activeMonths].filter((m) => !anchors[m]).sort()
  return {
    anchors: Object.keys(anchors).length > 0 ? anchors : undefined,
    flaggedMonths,
  }
}

// Compute anchors from the slice of app state that detection needs. Returns no
// anchors (and no flags) when the feature is disabled, so every consumer can call
// this unconditionally and pass `.anchors` to the period helpers.
export function getSalaryAnchors(input: {
  allTransactions: ZlantarTransaction[]
  settings: AppSettings
  transactionOverrides?: Record<string, TxOverride>
}): SalaryAnchorInfo {
  const { settings } = input
  if (!settings.salaryAnchoredMonths) return { flaggedMonths: [] }

  return detectSalaryAnchors(
    input.allTransactions,
    settings.categories,
    settings.zlantarCategoryRules,
    input.transactionOverrides ?? {},
    settings.monthStartDay,
    settings.salaryDetectionWindowDays ?? 6,
    settings.salaryMinAmount ?? 5000
  )
}
