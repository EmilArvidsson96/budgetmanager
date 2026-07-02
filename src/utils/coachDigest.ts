// ─── AI coach digest ──────────────────────────────────────────────────────────
//
// The token-efficient payload the financial coach reasons over. The app does ALL
// the arithmetic here (reusing the same engines the views render from) and hands
// Claude ~40 finished numbers — never a raw transaction. This is deliberate:
//   • cheap — a few hundred input tokens instead of a multi-thousand-token export;
//   • correct — LLMs are poor at arithmetic, so we never ask it to compute, only to
//     reason and prioritise. In particular "savings" is pre-computed as a balance
//     delta (closing − opening on savings/ISK/investment accounts), so the model
//     cannot re-derive it wrongly from transfer transactions.
//
// Everything is derived from stored state, rounded, and signed per the conventions
// noted on each field. `savingsKnown` distinguishes "0 saved" from "unmeasurable"
// (the previous month wasn't imported) — treating those the same is the classic
// confidently-wrong failure this digest is designed to prevent.

import type { AppState, CoachVerdict } from '@/types'
import { getMonthlyHistory, averageOf, type MonthHistoryPoint } from './history'
import { buildProjection, currentMonthId, classifyAccount } from './projection'
import { netWorthByMonth } from './report'
import { getMonthIdForDate } from './periodUtils'
import { getSalaryAnchors } from './salaryDetection'
import { MONTH_NAMES_LONG, MONTH_NAMES_SHORT } from './budgetHelpers'

// Swedish mortgage-interest deduction (schablon): 30 % of interest is refunded via
// tax, up to 100k interest/yr. We use the flat 30 % as an approximation and let the
// doctrine caveat the >100k tapering.
const INTEREST_DEDUCTION = 0.3
const BUFFER_TARGET_MONTHS = 3
const TROUGH_HORIZON = 12
const MAX_VARIANCES = 5
const MAX_TROUGH_DRIVERS = 4

export interface CoachVarianceItem {
  category: string
  planned: number        // positive magnitude planned this month
  actual: number         // positive magnitude spent
  diff: number           // actual − planned (positive = over budget)
  isCatchAll: boolean     // the Övrigt / 'other' bucket
}

export interface CoachTroughDriver {
  monthLabel: string
  description: string
  amount: number         // positive magnitude
}

export interface CoachDigest {
  // meta
  periodLabel: string
  monthId: string
  currency: string
  partnerName?: string
  monthsImported: number
  dataWarnings: string[]

  // 1. net worth (loans already negative → signed sums)
  netWorth: number | null
  netWorthDeltaMonth: number | null
  netWorth6moAgo: number | null
  netWorthDelta6mo: number | null
  netWorthPerMonth6mo: number | null

  // 2. realised savings (balance delta; can be negative = drawdown)
  savingsThisMonth: number | null
  savingsKnown: boolean
  savingsAvg3mo: number | null
  savingsAvg6mo: number | null
  savingsAvg12mo: number | null
  savingsRateThisMonth: number | null   // fraction of income
  savingsRate6mo: number | null

  // 3. cash flow (positive magnitudes)
  incomeThisMonth: number
  incomeAvg3mo: number
  incomeAvg6mo: number
  incomeAvg12mo: number
  expenseThisMonth: number
  expenseAvg3mo: number
  expenseAvg6mo: number
  expenseAvg12mo: number
  netThisMonth: number                   // income − expense − savings

  // 4. buffer
  liquidNow: number
  bufferMonths: number | null            // liquidNow ÷ avg monthly expense (6 mo)
  bufferTargetMonths: number

  // 5. plan-vs-actual variances
  variances: CoachVarianceItem[]
  catchAllOverPlan: number | null        // Övrigt actual − planned, when > 0

  // 6. liquidity look-ahead (from now, next 12 months)
  troughLiquidity: number | null
  troughLabel: string | null
  troughDrivers: CoachTroughDriver[]

  // 7. leverage snapshot
  mortgageBalance: number                // sum of liability balances (negative)
  mortgageRateNominal: number | null     // fraction, balance-weighted
  mortgageRateRealAfterTax: number | null
  forcedAmortPerMonth: number | null     // sum of monthlyPayment on liabilities

  // continuity (previous review)
  prevNudge: string | null
  prevThroughline: string | null
  prevVerdict: CoachVerdict | null
}

const r = (n: number): number => Math.round(n)
const r4 = (n: number): number => Math.round(n * 10000) / 10000
const r3 = (n: number): number => Math.round(n * 1000) / 1000

function prevMonthId(monthId: string): string {
  const year = parseInt(monthId.slice(0, 4))
  const month = parseInt(monthId.slice(5, 7))
  return month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, '0')}`
}

// Elapsed calendar months from period a → b (both 'YYYY-MM'). Used so per-month
// rates divide by real time, not by array-index distance in the (gap-compacted)
// history series.
function monthsBetween(aId: string, bId: string): number {
  const ay = parseInt(aId.slice(0, 4)), am = parseInt(aId.slice(5, 7))
  const by = parseInt(bId.slice(0, 4)), bm = parseInt(bId.slice(5, 7))
  return (by - ay) * 12 + (bm - am)
}

function labelLong(monthId: string): string {
  const year = monthId.slice(0, 4)
  const month = parseInt(monthId.slice(5, 7))
  return `${MONTH_NAMES_LONG[month - 1]} ${year}`
}

// The period that just closed when this period's salary landed — i.e. the single
// most-recent elapsed month with activity — but only when it has no review yet.
// Drives the "review is due" prompt in Avstämning. Null once that month is reviewed
// (so it doesn't re-fire, and doesn't nag backward through an unreviewed backlog —
// older months are still reachable via month navigation, just not flagged "due").
export function coachDueMonthId(state: AppState): string | null {
  const cur = currentMonthId(state)
  const reviewable = Object.keys(state.actuals)
    .filter((id) => id < cur && (state.actuals[id].entries?.length ?? 0) > 0)
    .sort()
  const latest = reviewable[reviewable.length - 1]
  if (!latest) return null
  return state.coachReviews[latest] ? null : latest
}

// Whether a coach review can be produced for this period (it has imported activity).
export function isCoachReviewable(state: AppState, monthId: string): boolean {
  return (state.actuals[monthId]?.entries?.length ?? 0) > 0
}

// Trailing window of `n` months ending at and INCLUDING the point at `idx`.
function trailing(history: MonthHistoryPoint[], idx: number, n: number): MonthHistoryPoint[] {
  return history.slice(Math.max(0, idx - (n - 1)), idx + 1)
}

export function buildCoachDigest(state: AppState, monthId: string): CoachDigest {
  const history = getMonthlyHistory(state)
  const idx = history.findIndex((p) => p.monthId === monthId)
  const cur = idx >= 0 ? history[idx] : undefined

  const dataWarnings: string[] = []

  // ── Trailing averages (inclusive of the reviewed month) ─────────────────────
  const w3 = idx >= 0 ? trailing(history, idx, 3) : []
  const w6 = idx >= 0 ? trailing(history, idx, 6) : []
  const w12 = idx >= 0 ? trailing(history, idx, 12) : []
  const savingsAvg = (w: MonthHistoryPoint[]): number | null => {
    const known = w.filter((p) => p.savingsKnown)
    return known.length ? averageOf(known, (p) => p.savings.actual) : null
  }

  const incomeAvg6 = averageOf(w6, (p) => p.income.actual)
  const expenseAvg6 = averageOf(w6, (p) => p.expense.actual)
  const savingsAvg6 = savingsAvg(w6)

  // ── Net worth ───────────────────────────────────────────────────────────────
  const nwByMonth = netWorthByMonth(state)
  const netWorth = idx >= 0 ? nwByMonth.get(monthId) ?? null : null
  const nwPrev = idx > 0 ? nwByMonth.get(history[idx - 1].monthId) : undefined
  const netWorthDeltaMonth =
    netWorth !== null && nwPrev !== undefined ? netWorth - nwPrev : null

  // Furthest-back known net worth within the trailing 6 history points → "≈6 mo ago".
  // Divide by the true calendar-month span (not the array-index distance), so import
  // gaps don't inflate the per-month rate.
  let nw6Value: number | null = null
  let nw6MonthId: string | null = null
  for (let back = 6; back >= 1; back--) {
    const h = history[idx - back]
    if (!h) continue
    const v = nwByMonth.get(h.monthId)
    if (v !== undefined) { nw6Value = v; nw6MonthId = h.monthId; break }
  }
  const nw6Back = nw6MonthId ? monthsBetween(nw6MonthId, monthId) : 0
  const netWorthDelta6mo =
    netWorth !== null && nw6Value !== null ? netWorth - nw6Value : null
  const netWorthPerMonth6mo =
    netWorthDelta6mo !== null && nw6Back > 0 ? netWorthDelta6mo / nw6Back : null

  // ── Realised savings ────────────────────────────────────────────────────────
  const savingsKnown = cur?.savingsKnown ?? false
  const savingsThisMonth = cur && savingsKnown ? cur.savings.actual : null
  const incomeThisMonth = cur?.income.actual ?? 0
  const savingsRateThisMonth =
    savingsThisMonth !== null && incomeThisMonth > 0 ? savingsThisMonth / incomeThisMonth : null
  // Rate over a CONSISTENT month set: pool savings and income over the same
  // savingsKnown months (dividing an avg-over-known by an avg-over-all would mix
  // month sets and misstate the rate when income differs between them).
  const known6 = w6.filter((p) => p.savingsKnown)
  const savingsRate6mo = (() => {
    if (known6.length === 0) return null
    const inc = known6.reduce((s, p) => s + p.income.actual, 0)
    const sav = known6.reduce((s, p) => s + p.savings.actual, 0)
    return inc > 0 ? sav / inc : null
  })()
  if (!savingsKnown) {
    dataWarnings.push('Sparande ej mätbart denna månad (föregående månad saknar importerade saldon).')
  }

  // ── Buffer ──────────────────────────────────────────────────────────────────
  const projection = buildProjection({ state, startMonthId: currentMonthId(state), horizon: TROUGH_HORIZON })
  const now = projection.months[0]
  const liquidNow = now?.liquidity ?? 0
  const bufferMonths = expenseAvg6 > 0 ? liquidNow / expenseAvg6 : null

  // ── Plan-vs-actual variances (expense categories) ───────────────────────────
  const expenseCats = state.settings.categories.filter((c) => c.type === 'expense')
  const variances: CoachVarianceItem[] = []
  let catchAllOverPlan: number | null = null
  if (cur) {
    for (const c of expenseCats) {
      const bucket = cur.byCat[c.id]
      if (!bucket) continue
      const actual = bucket.actual
      const planned = bucket.planned
      if (actual === 0 && planned === 0) continue
      const isCatchAll = c.id === 'other'
      const diff = actual - planned
      variances.push({ category: c.name, planned: r(planned), actual: r(actual), diff: r(diff), isCatchAll })
      if (isCatchAll && diff > 0) catchAllOverPlan = r(diff)
    }
    variances.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff))
  }

  // ── Liquidity look-ahead (trough over the next 12 months, from now) ─────────
  const future = projection.months.slice(1)
  let troughLiquidity: number | null = null
  let troughLabel: string | null = null
  if (future.length) {
    const t = future.reduce((lo, m) => (m.liquidity < lo.liquidity ? m : lo), future[0])
    troughLiquidity = r(t.liquidity)
    troughLabel = t.label
  }

  // Upcoming planned one-off costs that pull liquidity down (largest first). Bounded
  // to the SAME window the trough is computed over — an outflow beyond the horizon
  // can't be what drives a trough inside it, so it must not be surfaced as the cause.
  const todayIso = (() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  })()
  const { monthStartDay, monthStartBusinessDay } = state.settings
  const { anchors } = getSalaryAnchors(state)
  const lastProjMonthId = future.length ? future[future.length - 1].monthId : monthId
  const troughDrivers: CoachTroughDriver[] = Object.values(state.liquidityPlans)
    .flatMap((p) => p.entries)
    .filter((e) => {
      if (!e.date || e.amount >= 0 || e.includeInProjection === false) return false
      if (e.date < todayIso) return false
      const mid = getMonthIdForDate(e.date, monthStartDay, monthStartBusinessDay, anchors)
      return mid <= lastProjMonthId
    })
    .sort((a, b) => a.amount - b.amount) // most negative first
    .slice(0, MAX_TROUGH_DRIVERS)
    .map((e) => ({
      monthLabel: `${MONTH_NAMES_SHORT[parseInt(e.date.slice(5, 7)) - 1]} ${e.date.slice(2, 4)}`,
      description: e.description || 'Planerad utgift',
      amount: r(Math.abs(e.amount)),
    }))

  // ── Leverage snapshot ─────────────────────────────────────────────────────--
  const liabilities = state.settings.accounts.filter((a) => classifyAccount(a) === 'liability')
  let mortgageBalance = 0
  let weightedRateNum = 0
  let weightedRateDen = 0
  let forcedAmort = 0
  let hasAmort = false
  for (const acc of liabilities) {
    const bal = now?.values[acc.id] ?? (acc.loanBalance != null ? -Math.abs(acc.loanBalance) : 0)
    mortgageBalance += bal
    if (typeof acc.interestRate === 'number' && acc.interestRate > 0) {
      weightedRateNum += Math.abs(bal) * acc.interestRate
      weightedRateDen += Math.abs(bal)
    }
    if (typeof acc.monthlyPayment === 'number' && acc.monthlyPayment > 0) {
      forcedAmort += acc.monthlyPayment
      hasAmort = true
    }
  }
  // interestRate is stored as a percent (e.g. 2.42), so normalise to a fraction.
  const rateNominal = weightedRateDen > 0 ? (weightedRateNum / weightedRateDen) / 100 : null
  const rateReal = rateNominal !== null ? rateNominal * (1 - INTEREST_DEDUCTION) : null

  // ── Continuity ────────────────────────────────────────────────────────────--
  const prev = state.coachReviews[prevMonthId(monthId)]

  if (history.length < 3) {
    dataWarnings.push('Kort historik (färre än 3 importerade månader) — trendsiffror är osäkra.')
  }

  return {
    periodLabel: labelLong(monthId),
    monthId,
    currency: state.settings.currency || 'SEK',
    partnerName: state.settings.partnerName,
    monthsImported: history.length,
    dataWarnings,

    netWorth: netWorth !== null ? r(netWorth) : null,
    netWorthDeltaMonth: netWorthDeltaMonth !== null ? r(netWorthDeltaMonth) : null,
    netWorth6moAgo: nw6Value !== null ? r(nw6Value) : null,
    netWorthDelta6mo: netWorthDelta6mo !== null ? r(netWorthDelta6mo) : null,
    netWorthPerMonth6mo: netWorthPerMonth6mo !== null ? r(netWorthPerMonth6mo) : null,

    savingsThisMonth: savingsThisMonth !== null ? r(savingsThisMonth) : null,
    savingsKnown,
    savingsAvg3mo: savingsAvg(w3) !== null ? r(savingsAvg(w3)!) : null,
    savingsAvg6mo: savingsAvg6 !== null ? r(savingsAvg6) : null,
    savingsAvg12mo: savingsAvg(w12) !== null ? r(savingsAvg(w12)!) : null,
    savingsRateThisMonth: savingsRateThisMonth !== null ? r3(savingsRateThisMonth) : null,
    savingsRate6mo: savingsRate6mo !== null ? r3(savingsRate6mo) : null,

    incomeThisMonth: r(incomeThisMonth),
    incomeAvg3mo: r(averageOf(w3, (p) => p.income.actual)),
    incomeAvg6mo: r(incomeAvg6),
    incomeAvg12mo: r(averageOf(w12, (p) => p.income.actual)),
    expenseThisMonth: r(cur?.expense.actual ?? 0),
    expenseAvg3mo: r(averageOf(w3, (p) => p.expense.actual)),
    expenseAvg6mo: r(expenseAvg6),
    expenseAvg12mo: r(averageOf(w12, (p) => p.expense.actual)),
    netThisMonth: r(cur?.net.actual ?? 0),

    liquidNow: r(liquidNow),
    bufferMonths: bufferMonths !== null ? r3(bufferMonths) : null,
    bufferTargetMonths: BUFFER_TARGET_MONTHS,

    variances: variances.slice(0, MAX_VARIANCES),
    catchAllOverPlan,

    troughLiquidity,
    troughLabel,
    troughDrivers,

    mortgageBalance: r(mortgageBalance),
    mortgageRateNominal: rateNominal !== null ? r4(rateNominal) : null,
    mortgageRateRealAfterTax: rateReal !== null ? r4(rateReal) : null,
    forcedAmortPerMonth: hasAmort ? r(forcedAmort) : null,

    prevNudge: prev?.nudge ?? null,
    prevThroughline: prev?.throughline ?? null,
    prevVerdict: prev?.verdict ?? null,
  }
}
