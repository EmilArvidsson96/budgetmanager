import type {
  AppState,
  MonthlyBudget,
  CategoryBudget,
  MonthlyActuals,
  YearlyBudget,
  CategoryDef,
} from '@/types'

export const MONTH_NAMES_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'Maj', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dec']
export const MONTH_NAMES_LONG = [
  'Januari', 'Februari', 'Mars', 'April', 'Maj', 'Juni',
  'Juli', 'Augusti', 'September', 'Oktober', 'November', 'December',
]

export function makeMonthId(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`
}

export function formatCurrency(amount: number, showSign = false): string {
  const formatted = new Intl.NumberFormat('sv-SE', {
    style: 'currency',
    currency: 'SEK',
    maximumFractionDigits: 0,
  }).format(Math.abs(amount))
  if (showSign && amount > 0) return `+${formatted}`
  if (amount < 0) return `−${formatted}`
  return formatted
}

export function formatCurrencyCompact(amount: number): string {
  if (Math.abs(amount) >= 1_000_000) {
    return `${(amount / 1_000_000).toFixed(1)} Mkr`
  }
  if (Math.abs(amount) >= 1_000) {
    return `${Math.round(amount / 1_000)} tkr`
  }
  return `${Math.round(amount)} kr`
}

// ─── Monthly budget totals ────────────────────────────────────────────────────

export interface BudgetTotals {
  totalIncome: number
  totalExpense: number
  totalSavings: number
  netBalance: number
}

export function calcBudgetTotals(
  budget: MonthlyBudget,
  categories: CategoryDef[]
): BudgetTotals {
  let totalIncome = 0
  let totalExpense = 0
  let totalSavings = 0

  for (const cb of budget.categories) {
    const cat = categories.find((c) => c.id === cb.categoryId)
    if (!cat) continue
    if (cat.type === 'income') totalIncome += cb.amount
    else if (cat.type === 'savings') totalSavings += cb.amount
    else totalExpense += cb.amount
  }

  return {
    totalIncome,
    totalExpense,
    totalSavings,
    netBalance: totalIncome - totalExpense - totalSavings,
  }
}

export function calcActualTotals(
  actuals: MonthlyActuals,
  categories: CategoryDef[]
): BudgetTotals {
  let totalIncome = 0
  let totalExpense = 0
  let totalSavings = 0

  const catTypeMap = new Map(categories.map((c) => [c.id, c.type]))

  for (const entry of actuals.entries) {
    const type = catTypeMap.get(entry.categoryId)
    if (type === 'income') totalIncome += entry.totalAmount
    else if (type === 'savings') totalSavings += entry.totalAmount
    else totalExpense += entry.totalAmount
  }

  return {
    totalIncome,
    totalExpense,
    totalSavings,
    netBalance: totalIncome - totalExpense - totalSavings,
  }
}

// ─── Yearly aggregation ───────────────────────────────────────────────────────

export interface YearlyMonth {
  month: number
  monthId: string
  isDetailed: boolean
  budgetedAmount: number  // per category total
  actualAmount: number | null
}

export function getYearlyMonthData(
  state: AppState,
  year: number,
  categoryId: string
): YearlyMonth[] {
  const yb = state.yearlyBudgets[String(year)]
  const yc = yb?.categories.find((c) => c.categoryId === categoryId)

  return Array.from({ length: 12 }, (_, i) => {
    const month = i + 1
    const monthId = makeMonthId(year, month)
    const mb = state.monthlyBudgets[monthId]
    const act = state.actuals[monthId]

    let budgetedAmount = 0
    if (mb) {
      budgetedAmount = mb.categories.find((c) => c.categoryId === categoryId)?.amount ?? 0
    } else if (yc) {
      if (yc.monthlyAllocation === 'custom' && yc.customMonthAmounts?.[month] !== undefined) {
        budgetedAmount = yc.customMonthAmounts[month]
      } else if (yc.annualAmount > 0) {
        budgetedAmount = Math.round((yc.annualAmount / 12) * 100) / 100
      }
    }

    const actualAmount = act
      ? act.entries.filter((e) => e.categoryId === categoryId).reduce((s, e) => s + e.totalAmount, 0)
      : null

    return {
      month,
      monthId,
      isDetailed: !!mb,
      budgetedAmount,
      actualAmount,
    }
  })
}

// ─── Create blank monthly budget ─────────────────────────────────────────────

export function createBlankMonthlyBudget(
  year: number,
  month: number,
  categories: CategoryDef[],
  recurringItems: AppState['settings']['recurringItems'],
  prevBudget?: MonthlyBudget
): MonthlyBudget {
  const id = makeMonthId(year, month)

  const cats: CategoryBudget[] = categories.map((cat) => {
    const prevCat = prevBudget?.categories.find((c) => c.categoryId === cat.id)
    return {
      categoryId: cat.id,
      amount: prevCat?.amount ?? 0,
      subcategories: cat.subcategories.map((sub) => {
        const prevSub = prevCat?.subcategories.find((s) => s.subcategoryId === sub.id)
        // Pre-fill from recurring items
        const recurring = recurringItems
          .filter((r) => r.categoryId === cat.id && r.subcategoryId === sub.id)
          .reduce((s, r) => s + r.amount, 0)
        return {
          subcategoryId: sub.id,
          amount: prevSub?.amount ?? recurring,
        }
      }),
    }
  })

  return { id, year, month, categories: cats, isDetailed: true }
}

// ─── Yearly budget helpers ────────────────────────────────────────────────────

export function createBlankYearlyBudget(
  year: number,
  categories: CategoryDef[]
): YearlyBudget {
  return {
    id: String(year),
    year,
    categories: categories.map((cat) => ({
      categoryId: cat.id,
      annualAmount: 0,
      monthlyAllocation: 'equal',
      subcategories: cat.subcategories.map((sub) => ({
        subcategoryId: sub.id,
        annualAmount: 0,
      })),
    })),
  }
}

export function calcYearlyActualTotal(
  state: AppState,
  year: number,
  categoryId: string
): number {
  let total = 0
  for (let m = 1; m <= 12; m++) {
    const act = state.actuals[makeMonthId(year, m)]
    if (act) {
      total += act.entries.filter((e) => e.categoryId === categoryId).reduce((s, e) => s + e.totalAmount, 0)
    }
  }
  return total
}
