// ─── Forward financial projection ─────────────────────────────────────────────
//
// Projects liquidity (cash) and net worth month-by-month over a horizon, driven by:
//   • the budget as forecast — monthly budget where it exists, else the yearly
//     budget allocation (income − operating expenses);
//   • per-account assumptions — expected return, monthly contribution, loan
//     amortization;
//   • manual one-off entries (reuses the existing LiquidityEntry list).
//
// Sign conventions (verified against zlantarParser / store):
//   • Account balances are raw-signed: a loan/credit debt is NEGATIVE.
//     → net worth is therefore a plain signed SUM, no manual subtraction.
//   • Budget expense/savings/transfer amounts are stored NEGATIVE, income positive.
//
// Saving is modeled via per-account `monthlyContribution`, NOT the budget's
// savings/transfer categories — those are deliberately excluded from the cashflow
// to avoid double-counting. (Surfaced to the user in the Plan view.)

import type { AppState, Account, AccountType } from '@/types'
import { MONTH_NAMES_SHORT } from './budgetHelpers'
import { getMonthIdForDate, type SalaryAnchors } from './periodUtils'
import { getSalaryAnchors } from './salaryDetection'

export type AccountRole = 'liquid' | 'asset' | 'liability'

export interface ProjectionAccountMeta {
  id: string
  name: string
  type: AccountType
  role: AccountRole
}

export interface ProjectionMonth {
  monthId: string                          // 'YYYY-MM'
  label: string                            // e.g. "Jun 26"
  isBaseline: boolean                      // true for the leading "now" anchor
  liquidity: number
  netWorth: number
  netCashflow: number                      // planned net flow into liquidity this month
  totalAssets: number                      // liquid + growth assets (excludes liabilities)
  totalLiabilities: number                 // sum of liability balances (negative)
  values: Record<string, number>           // accountId -> value this month (all roles)
}

export interface ProjectionResult {
  months: ProjectionMonth[]
  accounts: ProjectionAccountMeta[]
}

// Default annual return when an asset account has none set — kept at 0 so the
// projection never invents growth the user didn't ask for.
const num = (v: number | undefined): number => (typeof v === 'number' && isFinite(v) ? v : 0)

export function classifyAccount(acc: Account): AccountRole {
  if (acc.type === 'loan' || acc.type === 'credit') return 'liability'
  if (acc.includeInLiquidity) return 'liquid'
  return 'asset'
}

// Step a 'YYYY-MM' id forward by one month.
function nextMonthId(monthId: string): string {
  const year = parseInt(monthId.slice(0, 4))
  const month = parseInt(monthId.slice(5, 7))
  return month === 12
    ? `${year + 1}-01`
    : `${year}-${String(month + 1).padStart(2, '0')}`
}

function labelFor(monthId: string): string {
  const month = parseInt(monthId.slice(5, 7))
  const yy = monthId.slice(2, 4)
  return `${MONTH_NAMES_SHORT[month - 1]} ${yy}`
}

// The yearly budget to use for a given year, carrying forward the most recent
// available budget when the year has none of its own. Holds the latest budget ≤
// year flat going forward; for years before any budget, uses the earliest.
// This stops the forecast from losing all income once the budgeted years run out.
function resolveYearlyBudget(state: AppState, year: number) {
  const years = Object.keys(state.yearlyBudgets).map(Number).sort((a, b) => a - b)
  if (years.length === 0) return undefined
  let pick: number | undefined
  for (const y of years) if (y <= year) pick = y
  if (pick === undefined) pick = years[0]
  return state.yearlyBudgets[String(pick)]
}

// Last-resort fallback when there are NO yearly budgets at all: carry forward the
// nearest monthly budget (latest ≤ monthId, else earliest) flat.
function resolveCarryMonthly(state: AppState, monthId: string) {
  const ids = Object.keys(state.monthlyBudgets).sort()
  if (ids.length === 0) return undefined
  let pick: string | undefined
  for (const id of ids) if (id <= monthId) pick = id
  if (pick === undefined) pick = ids[0]
  return state.monthlyBudgets[pick]
}

// The standing baseline ("normalmånad") target for a category, or undefined if the
// baseline has no entry for it. When bySub is set the target equals the sum of its
// subcategory targets. Exported so the editors can show/seed the raw baseline.
export function baselineTarget(state: AppState, categoryId: string): number | undefined {
  const bc = state.budgetBaseline?.categories.find((c) => c.categoryId === categoryId)
  if (!bc) return undefined
  if (bc.bySub) {
    return (bc.subTargets ?? []).reduce((s, t) => s + t.target, 0)
  }
  return bc.target
}

// Budgeted (planned) amount for one category in one period. Resolution order —
// most specific first, so per-month tweaks and history win over the rolling base:
//   1. explicit per-month override (budgetOverrides)
//   2. legacy per-month budget table (preserves closed-month history)
//   3. frozen elapsed-month snapshot (budgetHistory) — locks past months to their
//      latest adjustment so editing the baseline never rewrites history
//   4. rolling baseline target ("normalmånad")
//   5. legacy yearly allocation (monthly → custom → ÷12), carried forward
//   6. legacy carry-forward of the nearest monthly budget
// Signed throughout (expenses negative). Exported for plan-vs-actual comparisons.
export function budgetedAmount(state: AppState, monthId: string, categoryId: string): number {
  const year = parseInt(monthId.slice(0, 4))
  const month = parseInt(monthId.slice(5, 7))

  // 1. Per-month override.
  const ov = state.budgetOverrides?.[monthId]?.[categoryId]
  if (ov !== undefined) return ov

  // 2. Legacy per-month budget (kept so already-closed months keep their plan).
  const mb = state.monthlyBudgets[monthId]
  if (mb) {
    const cat = mb.categories.find((c) => c.categoryId === categoryId)
    if (cat) return cat.amount
  }

  // 3. Frozen elapsed-month snapshot.
  const frozen = state.budgetHistory?.[monthId]?.[categoryId]
  if (frozen !== undefined) return frozen

  // 4. Rolling baseline.
  const base = baselineTarget(state, categoryId)
  if (base !== undefined) return base

  // 5. Legacy yearly allocation (with carry-forward).
  const yb = resolveYearlyBudget(state, year)
  if (yb) {
    const yc = yb.categories.find((c) => c.categoryId === categoryId)
    if (yc) {
      if (yc.monthlyAllocation === 'custom' && yc.customMonthAmounts?.[month] !== undefined) {
        return yc.customMonthAmounts[month]
      }
      return yc.annualAmount / 12
    }
    return 0
  }

  // 6. No yearly budgets anywhere → carry forward the nearest monthly budget.
  const cmb = resolveCarryMonthly(state, monthId)
  if (cmb) {
    return cmb.categories.find((c) => c.categoryId === categoryId)?.amount ?? 0
  }
  return 0
}

// ─── Elapsed-budget freezing ──────────────────────────────────────────────────
//
// Once a period rolls into the past, its effective per-category plan is snapshotted
// into budgetHistory so later baseline edits never rewrite history. This is what
// makes "the latest adjustment to a budget is always saved" hold WITHOUT a
// month-close ritual: while a month is current its budget is live; the moment it
// elapses, whatever the plan is at that point is locked in.

// Period id for "today" under the current period settings + salary anchors.
export function currentMonthId(state: AppState): string {
  const t = new Date()
  const iso = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`
  const { anchors } = getSalaryAnchors(state)
  return getMonthIdForDate(iso, state.settings.monthStartDay, state.settings.monthStartBusinessDay, anchors)
}

// The effective budget for one month: one signed amount per income/expense/savings
// category (transfers are never budgeted). Resolves through budgetedAmount, so it
// captures overrides, legacy tables, already-frozen values and the baseline alike.
export function snapshotMonthBudget(state: AppState, monthId: string): Record<string, number> {
  const snap: Record<string, number> = {}
  for (const cat of state.settings.categories) {
    if (cat.type === 'transfer') continue
    snap[cat.id] = budgetedAmount(state, monthId, cat.id)
  }
  return snap
}

// Freeze every elapsed month that has actuals and isn't frozen yet. Returns a new
// budgetHistory map, or null when nothing changed so callers can skip the set().
// Already-frozen months are left untouched — their captured adjustment is final.
export function computeFrozenElapsed(state: AppState): Record<string, Record<string, number>> | null {
  const cur = currentMonthId(state)
  const next = { ...state.budgetHistory }
  let changed = false
  for (const monthId of Object.keys(state.actuals)) {
    if (monthId >= cur) continue   // only elapsed periods get frozen
    if (next[monthId]) continue    // keep the adjustment captured when it elapsed
    next[monthId] = snapshotMonthBudget(state, monthId)
    changed = true
  }
  return changed ? next : null
}

// Planned income and operating-expense magnitudes for one period.
// Savings/transfer categories are excluded (see file header).
function budgetedFlowForMonth(state: AppState, monthId: string): { income: number; operatingExpense: number } {
  let income = 0
  let operatingExpense = 0
  for (const cat of state.settings.categories) {
    if (cat.type === 'income') {
      income += budgetedAmount(state, monthId, cat.id)
    } else if (cat.type === 'expense') {
      operatingExpense += Math.abs(budgetedAmount(state, monthId, cat.id))
    }
    // savings & transfer: intentionally skipped
  }
  return { income, operatingExpense }
}

// Signed sum of manual one-off entries that fall in the given period.
function manualNetForMonth(state: AppState, monthId: string, anchors?: SalaryAnchors): number {
  const { monthStartDay, monthStartBusinessDay } = state.settings
  let net = 0
  for (const plan of Object.values(state.liquidityPlans)) {
    for (const e of plan.entries) {
      if (!e.date) continue
      if (getMonthIdForDate(e.date, monthStartDay, monthStartBusinessDay, anchors) === monthId) {
        net += e.amount
      }
    }
  }
  return net
}

export interface ProjectionInput {
  state: AppState
  startMonthId: string
  horizon: number   // number of future months (e.g. 12, 24, 36)
}

export function buildProjection({ state, startMonthId, horizon }: ProjectionInput): ProjectionResult {
  const accounts = state.settings.accounts.filter((a) => a.includeInNetWorth !== false)
  const { anchors } = getSalaryAnchors(state)

  // Latest import snapshot → map of accountId -> raw-signed balance.
  const snapMap = new Map<string, number>()
  if (state.importSnapshots.length > 0) {
    const latest = state.importSnapshots.reduce((a, b) => (a.importedAt > b.importedAt ? a : b))
    for (const ab of latest.accountBalances) snapMap.set(ab.accountId, ab.balance)
  }

  const meta: ProjectionAccountMeta[] = accounts.map((a) => ({
    id: a.id,
    name: a.name,
    type: a.type,
    role: classifyAccount(a),
  }))
  const roleOf = new Map(meta.map((m) => [m.id, m.role]))

  // Starting balances.
  const startValue = (acc: Account): number => {
    const snap = snapMap.get(acc.id)
    if (roleOf.get(acc.id) === 'liability') {
      if (snap !== undefined) return snap
      return acc.loanBalance != null ? -Math.abs(acc.loanBalance) : 0
    }
    // liquid or asset: manual value overrides snapshot (property has only manual)
    return acc.manualValue ?? snap ?? 0
  }

  // Mutable per-account values, plus a fixed liquid pool.
  const values: Record<string, number> = {}
  let liquidity = 0
  for (const acc of accounts) {
    const v = startValue(acc)
    values[acc.id] = v
    if (roleOf.get(acc.id) === 'liquid') liquidity += v
  }

  const assetAccts = accounts.filter((a) => roleOf.get(a.id) === 'asset')
  const liabilityAccts = accounts.filter((a) => roleOf.get(a.id) === 'liability')

  const snapshotPoint = (monthId: string, netCashflow: number, isBaseline: boolean): ProjectionMonth => {
    let totalAssets = liquidity
    let totalLiabilities = 0
    const pointValues: Record<string, number> = {}
    for (const a of accounts) {
      const role = roleOf.get(a.id)!
      if (role === 'liquid') {
        pointValues[a.id] = values[a.id]
      } else if (role === 'asset') {
        pointValues[a.id] = values[a.id]
        totalAssets += values[a.id]
      } else {
        pointValues[a.id] = values[a.id]
        totalLiabilities += values[a.id]
      }
    }
    return {
      monthId,
      label: labelFor(monthId),
      isBaseline,
      liquidity,
      netWorth: totalAssets + totalLiabilities,
      netCashflow,
      totalAssets,
      totalLiabilities,
      values: pointValues,
    }
  }

  const months: ProjectionMonth[] = []
  // Baseline anchor ("now").
  months.push(snapshotPoint(startMonthId, 0, true))

  let monthId = startMonthId
  for (let t = 0; t < horizon; t++) {
    monthId = nextMonthId(monthId)

    // Grow assets.
    let contributions = 0
    for (const a of assetAccts) {
      const r = num(a.expectedReturn) / 12
      const c = num(a.monthlyContribution)
      values[a.id] = values[a.id] * (1 + r) + c
      if (!a.contributionIsBudgeted) contributions += c
    }

    // Accrue loan interest, then amortize (don't overpay).
    let loanPayments = 0
    for (const l of liabilityAccts) {
      const rate = num(l.interestRate) / 100 / 12
      values[l.id] = values[l.id] * (1 + rate)
      const owed = Math.max(0, -values[l.id])
      const pay = Math.min(num(l.monthlyPayment), owed)
      values[l.id] += pay
      if (!l.contributionIsBudgeted) loanPayments += pay
    }

    // Budget-driven operating cashflow + manual one-offs.
    const { income, operatingExpense } = budgetedFlowForMonth(state, monthId)
    const manualNet = manualNetForMonth(state, monthId, anchors)
    const netCashflow = income - operatingExpense - contributions - loanPayments + manualNet

    liquidity += netCashflow

    months.push(snapshotPoint(monthId, netCashflow, false))
  }

  return { months, accounts: meta }
}
