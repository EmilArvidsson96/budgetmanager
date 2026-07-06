// ─── Månadsskiftets utrymme ("kvar att röra er med") ──────────────────────────
//
// Shared math for the month-boundary ritual in Avstämning, used by both the
// deterministic card and the AI-coach digest so they reason over the SAME
// numbers. Two halves:
//
//   • Bakåt (buildMonthOutcome): varför stack den stängda månaden iväg — eller
//     varför höll den? Utgifter/inkomst/sparande mot plan plus de kategorier
//     som drev avvikelsen.
//   • Framåt (buildSpendingSpace): nya periodens lön har landat — hur mycket är
//     kvar att röra sig med efter räkningarna, och hur mycket bör man tilldela
//     sig själv? Trappan:
//
//         inkomst (faktisk när importerad, annars plan)
//       − räkningar (fasta återkommande poster, redan månadsnormaliserade)
//       = kvar efter räkningar          ← "vi har 15 000 kr var att röra oss med"
//       − rörlig budget (utgiftsplan − räkningar)
//       − planerat sparande
//       = fritt utrymme                 ← "…men bör bara tilldela oss 5 000 var"
//
// Förra månadens utfall bärs framåt som rekommendation: drog månaden över plan
// (eller togs pengar ur bufferten) sänks det föreslagna egna utrymmet med
// överdraget — "förra månaden var tuff, håll igen den här".

import type { AppState } from '@/types'
import { getMonthlyHistory } from './history'
import { budgetedAmount } from './projection'
import { MONTH_NAMES_LONG } from './budgetHelpers'

// Plan-vs-actual noise below these thresholds is ignored — a month is not
// "tough" over a hundralapp, and small category wobbles aren't drivers.
const TOUGH_FLOOR = 500
const DRIVER_FLOOR = 300
const MAX_DRIVERS = 3

export interface OutcomeDriver {
  name: string
  diff: number               // actual − planned; positive = over plan
}

// Why the reviewed month landed where it did — the backward half of the ritual.
export interface MonthOutcome {
  monthId: string
  expenseDiff: number        // actual − planned expenses (positive = over)
  incomeDiff: number         // actual − planned income
  savingsDiff: number | null // actual − planned savings; null = unmeasurable
  savingsDrawdown: number    // kr taken OUT of savings/buffer (0 when none/unknown)
  topOverruns: OutcomeDriver[]     // expense categories most over plan
  biggestUnderrun: OutcomeDriver | null
  tough: boolean             // spent over plan, or drew from the buffer
  holdBack: number           // kr to tighten by next month (0 when !tough)
}

// The forward half: what the new period leaves to move around with.
export interface SpendingSpace {
  monthId: string            // the period the space applies to (after the reviewed month)
  monthLabel: string         // "juli 2026"
  income: number
  incomeSource: 'actual' | 'planned'
  bills: number              // fixed recurring costs
  billsKnown: boolean        // false when no recurring expense items are registered
  afterBills: number         // income − bills
  afterBillsPerPerson: number
  variablePlanned: number    // budgeted expenses beyond the bills (mat, nöje …)
  savingsPlanned: number
  margin: number             // afterBills − variablePlanned − savingsPlanned
  marginPerPerson: number
  holdBack: number           // carried from the reviewed month's outcome
  suggestedPerPerson: number // (margin − holdBack) halved, floored to even hundreds
  lastMonthTough: boolean
}

export function nextMonthIdOf(monthId: string): string {
  const year = parseInt(monthId.slice(0, 4))
  const month = parseInt(monthId.slice(5, 7))
  return month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, '0')}`
}

export function monthLabelOf(monthId: string): string {
  return `${MONTH_NAMES_LONG[parseInt(monthId.slice(5, 7)) - 1].toLowerCase()} ${monthId.slice(0, 4)}`
}

export function buildMonthOutcome(state: AppState, monthId: string): MonthOutcome | null {
  const point = getMonthlyHistory(state).find((p) => p.monthId === monthId)
  if (!point) return null

  const nameOf = new Map(state.settings.categories.map((c) => [c.id, c.name]))
  const expenseIds = new Set(
    state.settings.categories.filter((c) => c.type === 'expense').map((c) => c.id)
  )
  const drivers = Object.entries(point.byCat)
    .filter(([id]) => expenseIds.has(id))
    .map(([id, v]) => ({ name: nameOf.get(id) ?? id, diff: Math.round(v.actual - v.planned) }))

  const topOverruns = drivers
    .filter((d) => d.diff > DRIVER_FLOOR)
    .sort((a, b) => b.diff - a.diff)
    .slice(0, MAX_DRIVERS)
  const underruns = drivers.filter((d) => d.diff < -DRIVER_FLOOR).sort((a, b) => a.diff - b.diff)

  const expenseDiff = Math.round(point.expense.actual - point.expense.planned)
  const incomeDiff = Math.round(point.income.actual - point.income.planned)
  const savingsDiff = point.savingsKnown
    ? Math.round(point.savings.actual - point.savings.planned)
    : null
  const savingsDrawdown =
    point.savingsKnown && point.savings.actual < 0 ? Math.round(-point.savings.actual) : 0

  const tough = expenseDiff > TOUGH_FLOOR || savingsDrawdown > 0
  // An expense overrun and a savings shortfall usually share one cause — carry
  // the larger of them forward, never the sum.
  const savingsShortfall = savingsDiff !== null && savingsDiff < 0 ? -savingsDiff : 0
  const holdBack = tough ? Math.max(0, expenseDiff, savingsShortfall) : 0

  return {
    monthId,
    expenseDiff,
    incomeDiff,
    savingsDiff,
    savingsDrawdown,
    topOverruns,
    biggestUnderrun: underruns[0] ?? null,
    tough,
    holdBack,
  }
}

// Build the spending space for the period AFTER the reviewed month. Pass the
// reviewed month's outcome so its overrun tempers the suggestion; null outcome
// (month not measurable) means no hold-back. Returns null when there is neither
// income nor an expense plan to reason about.
export function buildSpendingSpace(
  state: AppState,
  reviewedMonthId: string,
  outcome: MonthOutcome | null
): SpendingSpace | null {
  const spaceId = nextMonthIdOf(reviewedMonthId)
  const cats = state.settings.categories
  const typeOf = new Map(cats.map((c) => [c.id, c.type]))

  // The new period's income — actual once imported (salary usually lands as the
  // period opens), plan until then.
  let incomeActual = 0
  for (const e of state.actuals[spaceId]?.entries ?? []) {
    if (typeOf.get(e.categoryId) === 'income') incomeActual += e.totalAmount
  }
  let incomePlanned = 0
  let expensePlanned = 0
  let savingsPlanned = 0
  for (const c of cats) {
    if (c.type === 'income') incomePlanned += budgetedAmount(state, spaceId, c.id)
    else if (c.type === 'expense') expensePlanned += Math.abs(budgetedAmount(state, spaceId, c.id))
    else if (c.type === 'savings') savingsPlanned += Math.abs(budgetedAmount(state, spaceId, c.id))
  }

  const incomeSource: 'actual' | 'planned' = incomeActual > 0 ? 'actual' : 'planned'
  const income = Math.round(incomeSource === 'actual' ? incomeActual : incomePlanned)
  if (income <= 0 && expensePlanned <= 0) return null

  // Bills = fixed recurring expense items (already normalised to monthly amounts).
  const bills = Math.round(
    state.settings.recurringItems
      .filter((r) => r.type === 'expense')
      .reduce((s, r) => s + Math.abs(r.amount), 0)
  )

  const afterBills = income - bills
  const variablePlanned = Math.round(Math.max(0, expensePlanned - bills))
  savingsPlanned = Math.round(savingsPlanned)
  const margin = afterBills - variablePlanned - savingsPlanned

  const holdBack = outcome?.holdBack ?? 0
  // Suggestions read as allowances — floor to even hundreds ("5 000 kr var").
  const suggestedPerPerson = Math.floor(Math.max(0, margin - holdBack) / 2 / 100) * 100

  return {
    monthId: spaceId,
    monthLabel: monthLabelOf(spaceId),
    income,
    incomeSource,
    bills,
    billsKnown: bills > 0,
    afterBills,
    afterBillsPerPerson: Math.round(afterBills / 2),
    variablePlanned,
    savingsPlanned,
    margin,
    marginPerPerson: Math.round(margin / 2),
    holdBack,
    suggestedPerPerson,
    lastMonthTough: outcome?.tough ?? false,
  }
}
