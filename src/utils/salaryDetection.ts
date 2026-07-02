// Salary detection — find the date salary actually landed each month so a budget
// period can begin "when the salary comes" instead of on a fixed nominal day.
//
// Why: a fixed monthStartDay only approximates payday, so the boundary mis-buckets
// the salary and nearby transactions. We pin the boundary to the real credit.
//
// What the real data taught us (see the household's history):
//   • Salary lands on days ~18–28 and is reliably tagged income/salary — even when
//     the description is the employer's name rather than "LÖN".
//   • The confusers are OTHER large recurring credits earlier in the month: tax
//     refunds (raw category 'refund', e.g. "SK9610…"), which are salary-sized and
//     recur, so an amount-only heuristic wrongly picks them.
// So detection: search the WHOLE calendar month (never a window tied to
// monthStartDay), take the income/salary-tagged credit as the primary signal, and
// only fall back to a recurring-amount match — with refund/interest/sale/subsidy
// explicitly excluded — for months that have no tagged salary at all.
//
// Anchoring rule: the EARLIEST qualifying credit that month is the anchor — the
// period begins when the household's money first arrives. With two earners the
// second salary a few days later falls naturally into the same period.
//
// Every anchor lands within its own calendar month (all candidates come from that
// month), which is the invariant getMonthIdForDate relies on (see periodUtils).

import type {
  ZlantarTransaction,
  CategoryDef,
  ZlantarCategoryRule,
  TxOverride,
  AppSettings,
} from '@/types'
import type { SalaryAnchors, SalaryPeriodConfig } from '@/utils/periodUtils'
import { resolveTxCategory } from '@/utils/zlantarParser'

export interface SalaryMatch {
  date: string          // ISO date the period is anchored to
  amount: number        // the matched credit amount
  via: 'tag' | 'recurring'
}

export interface SalaryAnchorInfo {
  // The period config to pass to the period helpers, or undefined when the feature
  // is off (helpers then use legacy calendar/monthStartDay behaviour, no shift).
  config?: SalaryPeriodConfig
  // Detected salary dates, keyed by CALENDAR month "YYYY-MM" (not the shifted
  // reconciliation label). Kept for the UI preview / diagnostics.
  anchors?: SalaryAnchors
  // Calendar months that have activity but no salary could be identified — the
  // reconciliation periods they open fall back to expectedSalaryDay.
  flaggedMonths: string[]
  // Per-detected-month detail (matched amount + how it was found), for the UI.
  matches: Record<string, SalaryMatch>
}

// Income subtypes / raw Zlantar categories that are income but NOT salary. Kept
// out of the recurring-amount fallback so a recurring tax refund never anchors.
const NON_SALARY_SUBS = new Set(['refund', 'sale', 'interest'])
const NON_SALARY_RAW = new Set(['refund', 'sale', 'interest', 'subsidy', 'account', 'stocks'])

interface Candidate {
  periodId: string
  date: string
  amount: number
  tagged: boolean       // resolves to income/salary
  eligibleForRecurring: boolean  // not a known non-salary income (refund/etc.)
}

export interface SalaryDetectionOptions {
  minAmount: number
  tolerancePct: number       // ± band around a recurring amount, e.g. 20
  minRecurringMonths: number // distinct months an amount must recur in
}

// Core detection. Pure — takes everything it needs as arguments.
export function detectSalaryAnchors(
  transactions: ZlantarTransaction[],
  categories: CategoryDef[],
  rules: ZlantarCategoryRule[],
  overrides: Record<string, TxOverride>,
  opts: SalaryDetectionOptions
): SalaryAnchorInfo {
  const { minAmount, tolerancePct, minRecurringMonths } = opts
  const tol = Math.max(0, tolerancePct) / 100

  const activeMonths = new Set<string>()
  const candidates: Candidate[] = []

  for (const tx of transactions) {
    if (!tx.date || tx.transaction_type === 'transfer') continue

    const periodId = tx.date.slice(0, 7) // "YYYY-MM" — candidates are whole-month
    activeMonths.add(periodId)

    if (tx.amount < minAmount) continue

    const { catId, subId } = resolveTxCategory(tx, categories, rules, overrides)
    const rawCat = tx.category ?? ''
    const tagged = catId === 'income' && subId === 'salary'
    const knownNonSalary = NON_SALARY_SUBS.has(subId) || NON_SALARY_RAW.has(rawCat)

    candidates.push({
      periodId,
      date: tx.date,
      amount: tx.amount,
      tagged,
      eligibleForRecurring: !knownNonSalary,
    })
  }

  const anchors: SalaryAnchors = {}
  const matches: Record<string, SalaryMatch> = {}
  const setEarliest = (c: Candidate, via: SalaryMatch['via']) => {
    const current = matches[c.periodId]
    if (!current || c.date < current.date) {
      anchors[c.periodId] = c.date
      matches[c.periodId] = { date: c.date, amount: c.amount, via }
    }
  }

  // Pass 1 — the reliable signal: earliest tagged salary per month.
  for (const c of candidates) {
    if (c.tagged) setEarliest(c, 'tag')
  }

  // Pass 2 — fallback for months with NO tagged salary: an amount that recurs
  // across months (within tolerance), among salary-eligible credits only.
  const recurPool = candidates.filter((c) => c.eligibleForRecurring)
  const recurCache = new Map<number, boolean>()
  const isRecurring = (amount: number): boolean => {
    const cached = recurCache.get(amount)
    if (cached !== undefined) return cached
    const lo = amount * (1 - tol)
    const hi = amount * (1 + tol)
    const months = new Set<string>()
    for (const c of recurPool) {
      if (c.amount >= lo && c.amount <= hi) months.add(c.periodId)
      if (months.size >= minRecurringMonths) break
    }
    const r = months.size >= minRecurringMonths
    recurCache.set(amount, r)
    return r
  }
  for (const c of candidates) {
    if (matches[c.periodId]) continue      // already tag-anchored this month
    if (!c.eligibleForRecurring || c.tagged) continue
    if (!isRecurring(c.amount)) continue
    setEarliest(c, 'recurring')
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

  const detected = detectSalaryAnchors(
    input.allTransactions,
    settings.categories,
    settings.zlantarCategoryRules,
    input.transactionOverrides ?? {},
    {
      minAmount: settings.salaryMinAmount ?? 20000,
      tolerancePct: settings.salaryAmountTolerancePct ?? 20,
      minRecurringMonths: settings.salaryMinRecurringMonths ?? 2,
    }
  )

  const config: SalaryPeriodConfig = {
    anchors: detected.anchors ?? {},
    incomeCutDay: settings.incomeCutDay ?? 20,
    expectedSalaryDay: settings.expectedSalaryDay ?? 25,
  }
  // Detection flags CALENDAR months with no salary; the reconciliation period that
  // then falls back to expectedSalaryDay is the following label (M → M+1). Shift so
  // flaggedMonths are the period labels the rest of the app compares against.
  const flaggedMonths = detected.flaggedMonths.map((calId) => {
    const y = parseInt(calId.slice(0, 4))
    const m = parseInt(calId.slice(5, 7))
    return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`
  })
  return { config, anchors: detected.anchors, flaggedMonths, matches: detected.matches }
}
