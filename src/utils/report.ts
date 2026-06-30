// ─── Monthly report assembly ──────────────────────────────────────────────────
//
// Turns the stored state into ONE month's report — the data behind the /rapport
// view that Emil sends his partner each month. Purely derived: everything comes
// from getMonthlyHistory() (actual vs planned per month + per category, savings as
// a balance delta) plus the month's account balances for net worth.
//
// The design brief: minimal text, big numbers, graphs. So this module does all the
// comparison maths up front (vs förra månaden, vs snitt, sparkvot, andelar) and
// hands the view a flat, render-ready object.

import type { AppState } from '@/types'
import { getMonthlyHistory, averageOf, type MonthHistoryPoint } from './history'
import { MONTH_NAMES_LONG } from './budgetHelpers'

// Cohesive palette — terracotta brand first, then the chart colours used elsewhere.
const CAT_COLORS = [
  '#C96332', '#0891b2', '#0d9488', '#059669', '#65a30d', '#d97706',
  '#dc2626', '#db2777', '#7c3aed', '#4f46e5', '#0284c7', '#16a34a',
]

const TOP_CATEGORIES = 5
const TREND_MONTHS = 8
const AVG_WINDOW = 6

export interface ReportStat {
  actual: number
  planned: number
  prev?: number        // same metric, previous month (undefined if not imported)
  avg?: number         // trailing average over up to AVG_WINDOW prior months
}

export interface ReportCategory {
  id: string
  name: string
  color: string
  amount: number       // positive magnitude this month
  share: number        // 0–1 of total expenses
  prev?: number        // same category, previous month
  delta?: number       // amount − prev (undefined when prev unknown)
}

export type HighlightTone = 'good' | 'bad' | 'neutral' | 'milestone'

// Semantic icon key — the view maps these to lucide icons + colours, so the data
// layer stays free of any presentation/JSX.
export type HighlightIcon =
  | 'surplus'
  | 'deficit'
  | 'saved'
  | 'savings-rate'
  | 'drawdown'
  | 'under-budget'
  | 'over-budget'
  | 'top-category'

export interface Highlight {
  tone: HighlightTone
  icon: HighlightIcon
  text: string
}

export interface TrendPoint {
  monthId: string
  label: string
  net: number
  income: number
  expense: number
  savings: number
}

export interface NetWorthPoint {
  label: string
  value: number
}

// How the month's income was used, as fractions of a common base (≤ 1 together).
export interface MoneyFlow {
  base: number         // the kr the fractions are taken from (≈ income)
  expenseFrac: number
  savingsFrac: number
  leftoverFrac: number
  leftover: number     // kr left over after expenses + savings (≥ 0)
}

export interface MonthlyReport {
  monthId: string
  title: string                 // "Juni 2026"
  hasData: boolean
  income: ReportStat
  expense: ReportStat
  savings: ReportStat & { known: boolean }
  net: ReportStat
  savingsRate: number           // savings.actual / income.actual (can be negative)
  flow: MoneyFlow
  categories: ReportCategory[]  // top N by spend + a lumped "Övrigt"
  netWorth?: { value: number; prev?: number; series: NetWorthPoint[] }
  trend: TrendPoint[]           // trailing window ending at this month
  highlights: Highlight[]
}

function labelLong(monthId: string): string {
  const year = monthId.slice(0, 4)
  const month = parseInt(monthId.slice(5, 7))
  return `${MONTH_NAMES_LONG[month - 1]} ${year}`
}

// Net worth per imported month, with per-account CARRY-FORWARD.
//
// Each month's balances come from its import, but Zlantar exports don't always
// include every account every month. Summing only the accounts present in a given
// month makes net worth lurch — e.g. a month missing the loan spikes by the whole
// loan amount, which then flattens the rest of the trend line to nothing. So we
// carry each account's most recent known balance forward into months that omit it.
//
// Loans are stored negative → result is a plain signed sum. Honors includeInNetWorth
// (default included). A month gets a value once ≥1 net-worth account is known by then.
function netWorthByMonth(state: AppState): Map<string, number> {
  const included = new Map(state.settings.accounts.map((a) => [a.id, a.includeInNetWorth !== false]))
  const carried = new Map<string, number>()   // accountId -> latest known balance
  const out = new Map<string, number>()
  for (const monthId of Object.keys(state.actuals).sort()) {
    for (const ab of state.actuals[monthId].accountBalances) {
      carried.set(ab.accountId, ab.balance)
    }
    let nw = 0
    let known = false
    for (const [accId, balance] of carried) {
      if (included.get(accId) === false) continue   // default to included when unknown
      nw += balance
      known = true
    }
    if (known) out.set(monthId, nw)
  }
  return out
}

// Months with actuals, newest first — drives the report month picker.
export function availableReportMonths(state: AppState): { id: string; label: string }[] {
  return Object.keys(state.actuals)
    .sort()
    .reverse()
    .map((id) => ({ id, label: labelLong(id) }))
}

function emptyStat(): ReportStat {
  return { actual: 0, planned: 0 }
}

function buildHighlights(
  cur: MonthHistoryPoint,
  savingsRate: number,
  avgExpense: number | undefined,
  topCategory: ReportCategory | undefined
): Highlight[] {
  const out: Highlight[] = []

  // 1. The headline result.
  if (cur.net.actual >= 0) {
    out.push({ tone: 'good', icon: 'surplus', text: `Plus i kassan med ${kr(cur.net.actual)}` })
  } else {
    out.push({ tone: 'bad', icon: 'deficit', text: `Back ${kr(Math.abs(cur.net.actual))} den här månaden` })
  }

  // 2. Savings — only when measurable.
  if (cur.savingsKnown) {
    if (savingsRate >= 0.2) {
      out.push({ tone: 'milestone', icon: 'savings-rate', text: `Sparade ${Math.round(savingsRate * 100)} % av inkomsten` })
    } else if (cur.savings.actual >= 0 && savingsRate >= 0.05) {
      out.push({ tone: 'good', icon: 'saved', text: `La undan ${kr(cur.savings.actual)}` })
    } else if (cur.savings.actual < 0) {
      out.push({ tone: 'neutral', icon: 'drawdown', text: `Tog ${kr(Math.abs(cur.savings.actual))} ur sparandet` })
    }
  }

  // 3. Spending vs the recent normal — only one of these, only if we have a baseline.
  if (avgExpense && avgExpense > 0) {
    const diff = cur.expense.actual - avgExpense
    if (diff <= -0.05 * avgExpense) {
      out.push({ tone: 'good', icon: 'under-budget', text: `${kr(Math.abs(diff))} lägre utgifter än vanligt` })
    } else if (diff >= 0.05 * avgExpense) {
      out.push({ tone: 'neutral', icon: 'over-budget', text: `${kr(diff)} högre utgifter än vanligt` })
    }
  }

  // 4. Biggest single cost — context, never alarming. Only if room left.
  if (out.length < 4 && topCategory) {
    out.push({ tone: 'neutral', icon: 'top-category', text: `Störst: ${topCategory.name} (${kr(topCategory.amount)})` })
  }

  return out.slice(0, 4)
}

// Compact integer-kr string for highlight text (the charts use formatCurrency).
function kr(v: number): string {
  return `${Math.round(v).toLocaleString('sv-SE')} kr`
}

export function buildMonthlyReport(state: AppState, monthId: string): MonthlyReport {
  const title = labelLong(monthId)
  const history = getMonthlyHistory(state)
  const idx = history.findIndex((p) => p.monthId === monthId)

  if (idx === -1) {
    return {
      monthId,
      title,
      hasData: false,
      income: emptyStat(),
      expense: emptyStat(),
      savings: { ...emptyStat(), known: false },
      net: emptyStat(),
      savingsRate: 0,
      flow: { base: 0, expenseFrac: 0, savingsFrac: 0, leftoverFrac: 0, leftover: 0 },
      categories: [],
      trend: [],
      highlights: [],
    }
  }

  const cur = history[idx]
  const prev: MonthHistoryPoint | undefined = history[idx - 1]
  const trailing = history.slice(Math.max(0, idx - AVG_WINDOW), idx)

  const stat = (pick: (p: MonthHistoryPoint) => { actual: number; planned: number }): ReportStat => ({
    actual: pick(cur).actual,
    planned: pick(cur).planned,
    prev: prev ? pick(prev).actual : undefined,
    avg: trailing.length ? averageOf(trailing, (p) => pick(p).actual) : undefined,
  })

  const income = stat((p) => p.income)
  const expense = stat((p) => p.expense)
  const net = stat((p) => p.net)

  // Savings is special: months with no prior import have an unmeasurable balance
  // delta (savingsKnown === false). Treating those as 0 would skew "mot snitt", so
  // the average and previous value only consider months where it was measurable.
  const knownTrailing = trailing.filter((p) => p.savingsKnown)
  const savings = {
    actual: cur.savings.actual,
    planned: cur.savings.planned,
    prev: prev && prev.savingsKnown ? prev.savings.actual : undefined,
    avg: knownTrailing.length
      ? knownTrailing.reduce((s, p) => s + p.savings.actual, 0) / knownTrailing.length
      : undefined,
    known: cur.savingsKnown,
  }

  const savingsRate = income.actual > 0 ? savings.actual / income.actual : 0

  // ── Money flow: how the month's income was used ────────────────────────────
  const savingsPos = Math.max(0, savings.actual)
  const base = income.actual > 0 ? income.actual : expense.actual + savingsPos || 1
  const expenseFrac = Math.min(1, expense.actual / base)
  const savingsFrac = Math.min(1 - expenseFrac, savingsPos / base)
  const leftoverFrac = Math.max(0, 1 - expenseFrac - savingsFrac)
  const flow: MoneyFlow = {
    base,
    expenseFrac,
    savingsFrac,
    leftoverFrac,
    leftover: leftoverFrac * base,
  }

  // ── Expense categories: top N by spend + lumped "Övrigt" ────────────────────
  const expenseCats = state.settings.categories.filter((c) => c.type === 'expense')
  const ranked = expenseCats
    .map((c, i) => ({
      id: c.id,
      name: c.name,
      color: c.color ?? CAT_COLORS[i % CAT_COLORS.length],
      amount: cur.byCat[c.id]?.actual ?? 0,
      prev: prev ? prev.byCat[c.id]?.actual ?? 0 : undefined,
    }))
    .filter((c) => c.amount > 0)
    .sort((a, b) => b.amount - a.amount)

  const totalExpense = ranked.reduce((s, c) => s + c.amount, 0) || 1
  const head = ranked.slice(0, TOP_CATEGORIES)
  const tail = ranked.slice(TOP_CATEGORIES)
  const categories: ReportCategory[] = head.map((c) => ({
    ...c,
    share: c.amount / totalExpense,
    delta: c.prev === undefined ? undefined : c.amount - c.prev,
  }))
  if (tail.length) {
    const amount = tail.reduce((s, c) => s + c.amount, 0)
    categories.push({
      id: '__rest__',
      name: 'Övrigt',
      color: '#cbd5e1',
      amount,
      share: amount / totalExpense,
    })
  }

  // ── Net worth (this month + a trailing series for the sparkline) ────────────
  const nwByMonth = netWorthByMonth(state)
  const nwValue = nwByMonth.get(monthId)
  let netWorth: MonthlyReport['netWorth']
  if (nwValue !== undefined) {
    const series: NetWorthPoint[] = []
    for (const p of history.slice(Math.max(0, idx - (TREND_MONTHS - 1)), idx + 1)) {
      const v = nwByMonth.get(p.monthId)
      if (v !== undefined) series.push({ label: p.label, value: v })
    }
    netWorth = { value: nwValue, prev: prev ? nwByMonth.get(prev.monthId) : undefined, series }
  }

  // ── Trend window (resultat per månad), ending at the selected month ─────────
  const trend: TrendPoint[] = history
    .slice(Math.max(0, idx - (TREND_MONTHS - 1)), idx + 1)
    .map((p) => ({
      monthId: p.monthId,
      label: p.label,
      net: p.net.actual,
      income: p.income.actual,
      expense: p.expense.actual,
      savings: p.savingsKnown ? p.savings.actual : 0,
    }))

  const highlights = buildHighlights(cur, savingsRate, expense.avg, categories[0])

  return {
    monthId,
    title,
    hasData: true,
    income,
    expense,
    savings,
    net,
    savingsRate,
    flow,
    categories,
    netWorth,
    trend,
    highlights,
  }
}
