// Salary detection — find the date salary actually landed each month so a budget
// period can begin "when the salary comes" instead of on a fixed nominal day.
//
// Why: a fixed monthStartDay (+ the simple Sat/Sun→Fri shift) only approximates
// payday. Real salary dates wobble (employer differences, red days), so the fixed
// boundary mis-buckets the salary itself or nearby transactions.
//
// The label is unreliable: Zlantar sometimes tags the credit 'salary', sometimes
// it's just the employer's name and the category is something else. So we don't
// trust the tag. The robust signal is a RECURRING deposit of roughly the same
// size (±tolerance) landing near the expected payday every month. We learn that
// amount from history and match on it; the category tag is only a bonus signal.
//
// Approach, per calendar month:
//   1. collect "window credits" — positive, non-transfer credits ≥ minAmount that
//      land within monthStartDay ± windowDays (clamped to the calendar month).
//   2. a window credit is salary-like if EITHER its amount recurs (within
//      tolerance) in ≥ minRecurring distinct months, OR it's tagged income/salary.
//   3. the EARLIEST salary-like credit that month is the anchor — the period
//      begins when the household's money first arrives. With two earners the
//      second salary a few days later falls naturally into the same period.
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

export interface SalaryMatch {
  date: string          // ISO date the period is anchored to
  amount: number        // the matched credit amount
  via: 'recurring' | 'tag' | 'both'
}

export interface SalaryAnchorInfo {
  // Period id "YYYY-MM" → ISO date that period begins. Undefined when the feature
  // is off or nothing was detected, so callers can pass it straight to the period
  // helpers (which treat undefined as "use nominal monthStartDay").
  anchors?: SalaryAnchors
  // Period ids that have activity but no salary could be identified — surfaced in
  // the UI so the user knows those months fell back to the expected payday.
  flaggedMonths: string[]
  // Per-anchored-period detail (matched amount + how it was found), for the UI.
  matches: Record<string, SalaryMatch>
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate()
}

// A candidate credit that landed inside a month's payday window.
interface WindowCredit {
  periodId: string
  date: string
  amount: number
  tagged: boolean       // resolves to income/salary
}

export interface SalaryDetectionOptions {
  monthStartDay: number
  windowDays: number
  minAmount: number
  tolerancePct: number      // ± band around a recurring amount, e.g. 20
  minRecurringMonths: number // how many distinct months an amount must recur in
}

// Core detection. Pure — takes everything it needs as arguments.
export function detectSalaryAnchors(
  transactions: ZlantarTransaction[],
  categories: CategoryDef[],
  rules: ZlantarCategoryRule[],
  overrides: Record<string, TxOverride>,
  opts: SalaryDetectionOptions
): SalaryAnchorInfo {
  const { monthStartDay, windowDays, minAmount, tolerancePct, minRecurringMonths } = opts
  const tol = Math.max(0, tolerancePct) / 100

  // Every period that has any non-transfer activity — used to flag the gaps.
  const activeMonths = new Set<string>()
  // Positive credits that landed inside each month's payday window.
  const windowCredits: WindowCredit[] = []

  for (const tx of transactions) {
    if (!tx.date || tx.transaction_type === 'transfer') continue

    const year = parseInt(tx.date.slice(0, 4))
    const month = parseInt(tx.date.slice(5, 7))
    const day = parseInt(tx.date.slice(8, 10))
    const periodId = `${year}-${String(month).padStart(2, '0')}`
    activeMonths.add(periodId)

    if (tx.amount < minAmount) continue

    // Only credits inside the payday window count, so a mid-month bonus or a
    // back-pay run doesn't hijack the boundary (and the anchor stays in-month).
    const dim = daysInMonth(year, month)
    const lo = Math.max(1, monthStartDay - windowDays)
    const hi = Math.min(dim, monthStartDay + windowDays)
    if (day < lo || day > hi) continue

    const { catId, subId } = resolveTxCategory(tx, categories, rules, overrides)
    windowCredits.push({
      periodId,
      date: tx.date,
      amount: tx.amount,
      tagged: catId === 'income' && subId === 'salary',
    })
  }

  // Is this credit's amount recurring? True when at least `minRecurringMonths`
  // DISTINCT months have a window credit within ±tol of it (counting its own).
  const recurs = (amount: number): boolean => {
    const lo = amount * (1 - tol)
    const hi = amount * (1 + tol)
    const months = new Set<string>()
    for (const wc of windowCredits) {
      if (wc.amount >= lo && wc.amount <= hi) months.add(wc.periodId)
      if (months.size >= minRecurringMonths) return true
    }
    return false
  }
  // Memoize per distinct amount so we don't re-scan for every credit.
  const recurCache = new Map<number, boolean>()
  const isRecurring = (amount: number): boolean => {
    const cached = recurCache.get(amount)
    if (cached !== undefined) return cached
    const r = recurs(amount)
    recurCache.set(amount, r)
    return r
  }

  // Earliest salary-like credit per month becomes the anchor.
  const anchors: SalaryAnchors = {}
  const matches: Record<string, SalaryMatch> = {}
  for (const wc of windowCredits) {
    const recurring = isRecurring(wc.amount)
    if (!recurring && !wc.tagged) continue

    const current = matches[wc.periodId]
    if (!current || wc.date < current.date) {
      anchors[wc.periodId] = wc.date
      matches[wc.periodId] = {
        date: wc.date,
        amount: wc.amount,
        via: recurring && wc.tagged ? 'both' : recurring ? 'recurring' : 'tag',
      }
    }
  }

  const flaggedMonths = [...activeMonths].filter((m) => !anchors[m]).sort()
  return {
    anchors: Object.keys(anchors).length > 0 ? anchors : undefined,
    flaggedMonths,
    matches,
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
  if (!settings.salaryAnchoredMonths) return { flaggedMonths: [], matches: {} }

  return detectSalaryAnchors(
    input.allTransactions,
    settings.categories,
    settings.zlantarCategoryRules,
    input.transactionOverrides ?? {},
    {
      monthStartDay: settings.monthStartDay,
      windowDays: settings.salaryDetectionWindowDays ?? 6,
      minAmount: settings.salaryMinAmount ?? 5000,
      tolerancePct: settings.salaryAmountTolerancePct ?? 20,
      minRecurringMonths: settings.salaryMinRecurringMonths ?? 2,
    }
  )
}
