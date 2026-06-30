// ─── Smart budget suggestions ─────────────────────────────────────────────────
//
// Computes target suggestions for a category from history, so setting the budget
// is "pick a number that's already true" rather than guessing from scratch:
//   • förra månaden        — last month's actual
//   • samma månad i fjol   — same calendar month, previous year (seasonal signal)
//   • snitt 6 mån          — trailing 6-month average of imported months
//   • fast del             — sum of recurring items mapped to the category
// All values are signed (income positive, expense negative), matching the budget.

import type { AppState } from '@/types'
import { makeMonthId } from './budgetHelpers'

export interface CategorySuggestions {
  lastMonth?: number
  sameMonthLastYear?: number
  avg6?: number
  recurring?: number
}

// Signed actual total for a category in a month that has imported actuals.
// undefined when the month was never imported — lets us tell "no data" from "0 kr".
function monthActual(state: AppState, monthId: string, categoryId: string): number | undefined {
  const a = state.actuals[monthId]
  if (!a) return undefined
  return a.entries
    .filter((e) => e.categoryId === categoryId)
    .reduce((s, e) => s + e.totalAmount, 0)
}

// Sum of recurring items mapped to a category, signed by type. deriveRecurringItems
// already normalises each item to a monthly amount.
export function recurringForCategory(state: AppState, categoryId: string): number {
  let sum = 0
  for (const r of state.settings.recurringItems) {
    if (r.categoryId !== categoryId) continue
    const mag = Math.abs(r.amount)
    sum += r.type === 'income' ? mag : -mag
  }
  return sum
}

function prevMonthId(monthId: string): string {
  let y = parseInt(monthId.slice(0, 4))
  let m = parseInt(monthId.slice(5, 7)) - 1
  if (m === 0) { m = 12; y-- }
  return makeMonthId(y, m)
}

export function suggestForCategory(state: AppState, monthId: string, categoryId: string): CategorySuggestions {
  const y = parseInt(monthId.slice(0, 4))
  const m = parseInt(monthId.slice(5, 7))

  const lastMonth = monthActual(state, prevMonthId(monthId), categoryId)
  const sameMonthLastYear = monthActual(state, makeMonthId(y - 1, m), categoryId)

  // Trailing 6 months (excluding the target month) that were actually imported.
  let total = 0
  let n = 0
  let cur = monthId
  for (let i = 0; i < 6; i++) {
    cur = prevMonthId(cur)
    const v = monthActual(state, cur, categoryId)
    if (v !== undefined) { total += v; n++ }
  }
  const avg6 = n > 0 ? Math.round(total / n) : undefined

  const rec = recurringForCategory(state, categoryId)

  return {
    lastMonth,
    sameMonthLastYear,
    avg6,
    recurring: rec !== 0 ? rec : undefined,
  }
}

// Calendar-month seasonal nudge for the month view. Null when nothing notable.
export function seasonalHint(month: number): string | null {
  switch (month) {
    case 1:  return 'Januari — ofta lugnare efter julhandeln, men vinterreor och kvartalsräkningar kan dyka upp.'
    case 4:  return 'April — deklarationstider. Skatteåterbäring (eller kvarskatt) kan landa den här perioden.'
    case 6:  return 'Juni — sommar och semester drar ofta iväg resor, mat ute och nöje.'
    case 7:  return 'Juli — semestermånad: räkna med högre rörliga utgifter.'
    case 8:  return 'Augusti — skolstart och hemkomst efter semestern.'
    case 11: return 'November — Black Friday lockar till shopping.'
    case 12: return 'December — julklappar, julmat och resor brukar dra rejält extra.'
    default: return null
  }
}
