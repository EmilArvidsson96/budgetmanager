// ─── Historical follow-up aggregation ─────────────────────────────────────────
//
// Walks every imported month and builds a per-month time series of ACTUAL vs
// PLANNED for income, expenses (per category) and savings — the data behind the
// Historik view. Reads what's already stored, so it's purely derived:
//   • income / expense actuals come from the month's aggregated `entries`
//     (transfers are already excluded when entries are built);
//   • the planned figures come from budgetedAmount(), which now resolves frozen
//     elapsed-month snapshots before the rolling baseline — so each past month is
//     compared against the plan that was in effect when it elapsed, not today's;
//   • savings actual is the balance change of the savings-type accounts over the
//     month (closing − opening), NOT a sum of savings transactions — money is
//     routed through a spender account first, so the transfers would double-count.
//     This mirrors the Avstämning waterfall.

import type { AppState } from '@/types'
import { budgetedAmount } from './projection'
import { MONTH_NAMES_SHORT } from './budgetHelpers'

// Account types whose month-over-month balance change counts as "savings".
const SAVINGS_ACCOUNT_TYPES = new Set(['savings', 'isk', 'investment'])

export interface ActualPlanned {
  actual: number   // positive magnitude (income/expense/savings-set-aside); savings can go negative when the buffer was drawn down
  planned: number  // positive magnitude
}

export interface MonthHistoryPoint {
  monthId: string                              // 'YYYY-MM'
  label: string                                // e.g. "Jun 26"
  income: ActualPlanned
  expense: ActualPlanned
  savings: ActualPlanned                       // actual = net balance delta of savings accounts (signed)
  net: ActualPlanned                           // income − expense − savings
  savingsKnown: boolean                        // false when the previous month wasn't imported (delta unmeasurable)
  byCat: Record<string, ActualPlanned>         // per income/expense category, positive magnitudes
}

function labelFor(monthId: string): string {
  const month = parseInt(monthId.slice(5, 7))
  return `${MONTH_NAMES_SHORT[month - 1]} ${monthId.slice(2, 4)}`
}

function prevMonthId(monthId: string): string {
  const year = parseInt(monthId.slice(0, 4))
  const month = parseInt(monthId.slice(5, 7))
  return month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, '0')}`
}

// Full month-by-month history, ascending by monthId, for every month with actuals.
export function getMonthlyHistory(state: AppState): MonthHistoryPoint[] {
  const { categories } = state.settings
  const typeOf = new Map(categories.map((c) => [c.id, c.type]))
  const incomeCats = categories.filter((c) => c.type === 'income')
  const expenseCats = categories.filter((c) => c.type === 'expense')
  const savingsCats = categories.filter((c) => c.type === 'savings')

  // Only months with real activity. A balance-only snapshot month (entries empty,
  // e.g. an import that carried just account balances) has no income/expense signal
  // and would skew averages and budget-adherence toward zero — skip it. Its balances
  // are still read below as the opening for the next month's savings delta.
  const monthIds = Object.keys(state.actuals)
    .filter((id) => state.actuals[id].entries.length > 0)
    .sort()

  return monthIds.map((monthId) => {
    const act = state.actuals[monthId]

    // ── Actuals from aggregated entries (income/expense) ──────────────────────
    let incomeActual = 0
    let expenseActual = 0
    const catActual: Record<string, number> = {}
    for (const e of act.entries) {
      const t = typeOf.get(e.categoryId)
      if (t === 'income') {
        incomeActual += e.totalAmount
        catActual[e.categoryId] = (catActual[e.categoryId] ?? 0) + e.totalAmount
      } else if (t === 'expense') {
        const mag = Math.abs(e.totalAmount)
        expenseActual += mag
        catActual[e.categoryId] = (catActual[e.categoryId] ?? 0) + mag
      }
      // savings/transfer entries: ignored here (savings via balance delta below)
    }

    // ── Savings actual = balance delta of savings-type accounts ───────────────
    const opening = new Map(
      (state.actuals[prevMonthId(monthId)]?.accountBalances ?? []).map((ab) => [ab.accountId, ab.balance])
    )
    let savingsActual = 0
    let savingsKnown = false
    for (const ab of act.accountBalances) {
      if (!SAVINGS_ACCOUNT_TYPES.has(ab.accountType)) continue
      const o = opening.get(ab.accountId)
      if (o === undefined) continue
      savingsActual += ab.balance - o
      savingsKnown = true
    }

    // ── Planned (budgetedAmount), as positive magnitudes ──────────────────────
    const byCat: Record<string, ActualPlanned> = {}
    let incomePlanned = 0
    for (const c of incomeCats) {
      const planned = budgetedAmount(state, monthId, c.id)
      incomePlanned += planned
      byCat[c.id] = { actual: catActual[c.id] ?? 0, planned }
    }
    let expensePlanned = 0
    for (const c of expenseCats) {
      const planned = Math.abs(budgetedAmount(state, monthId, c.id))
      expensePlanned += planned
      byCat[c.id] = { actual: catActual[c.id] ?? 0, planned }
    }
    let savingsPlanned = 0
    for (const c of savingsCats) {
      savingsPlanned += Math.abs(budgetedAmount(state, monthId, c.id))
    }

    const netActual = incomeActual - expenseActual - savingsActual
    const netPlanned = incomePlanned - expensePlanned - savingsPlanned

    return {
      monthId,
      label: labelFor(monthId),
      income: { actual: incomeActual, planned: incomePlanned },
      expense: { actual: expenseActual, planned: expensePlanned },
      savings: { actual: savingsActual, planned: savingsPlanned },
      net: { actual: netActual, planned: netPlanned },
      savingsKnown,
      byCat,
    }
  })
}

// Average over the given points of a metric selector — ignores months where the
// selector returns null (e.g. savings before any opening balance is known).
export function averageOf(
  points: MonthHistoryPoint[],
  pick: (p: MonthHistoryPoint) => number | null
): number {
  let sum = 0
  let n = 0
  for (const p of points) {
    const v = pick(p)
    if (v === null) continue
    sum += v
    n += 1
  }
  return n === 0 ? 0 : sum / n
}
