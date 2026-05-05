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

// ─── Monthly budget — extra init modes ───────────────────────────────────────

function prevMonthIds(year: number, month: number, count: number): string[] {
  const ids: string[] = []
  for (let i = 1; i <= count; i++) {
    let m = month - i
    let y = year
    if (m <= 0) { m += 12; y-- }
    ids.push(makeMonthId(y, m))
  }
  return ids
}

export function createMonthlyBudgetFromActuals(
  year: number,
  month: number,
  categories: CategoryDef[],
  recurringItems: AppState['settings']['recurringItems'],
  sourceActuals: MonthlyActuals
): MonthlyBudget {
  const id = makeMonthId(year, month)
  const cats: CategoryBudget[] = categories.map((cat) => {
    const entries = sourceActuals.entries.filter((e) => e.categoryId === cat.id)
    const amount = entries.reduce((s, e) => s + e.totalAmount, 0)
    return {
      categoryId: cat.id,
      amount: Math.round(amount),
      subcategories: cat.subcategories.map((sub) => {
        const subEntry = entries.find((e) => e.subcategoryId === sub.id)
        const recurring = recurringItems
          .filter((r) => r.categoryId === cat.id && r.subcategoryId === sub.id)
          .reduce((s, r) => s + r.amount, 0)
        return {
          subcategoryId: sub.id,
          amount: subEntry !== undefined ? Math.round(subEntry.totalAmount) : recurring,
        }
      }),
    }
  })
  return { id, year, month, categories: cats, isDetailed: true }
}

export function createMonthlyBudgetFrom6AvgBudget(
  year: number,
  month: number,
  categories: CategoryDef[],
  recurringItems: AppState['settings']['recurringItems'],
  monthlyBudgets: Record<string, MonthlyBudget>
): MonthlyBudget {
  const ids = prevMonthIds(year, month, 6)
  const budgets = ids.map((id) => monthlyBudgets[id]).filter((b): b is MonthlyBudget => !!b)
  const n = budgets.length || 1
  const id = makeMonthId(year, month)
  const cats: CategoryBudget[] = categories.map((cat) => {
    const totalAmt = budgets.reduce((s, b) => {
      return s + (b.categories.find((c) => c.categoryId === cat.id)?.amount ?? 0)
    }, 0)
    return {
      categoryId: cat.id,
      amount: Math.round(totalAmt / n),
      subcategories: cat.subcategories.map((sub) => {
        const totalSubAmt = budgets.reduce((s, b) => {
          const bc = b.categories.find((c) => c.categoryId === cat.id)
          return s + (bc?.subcategories.find((sc) => sc.subcategoryId === sub.id)?.amount ?? 0)
        }, 0)
        const recurring = recurringItems
          .filter((r) => r.categoryId === cat.id && r.subcategoryId === sub.id)
          .reduce((s, r) => s + r.amount, 0)
        return {
          subcategoryId: sub.id,
          amount: budgets.length > 0 ? Math.round(totalSubAmt / n) : recurring,
        }
      }),
    }
  })
  return { id, year, month, categories: cats, isDetailed: true }
}

export function createMonthlyBudgetFrom6AvgActuals(
  year: number,
  month: number,
  categories: CategoryDef[],
  recurringItems: AppState['settings']['recurringItems'],
  actuals: Record<string, MonthlyActuals>
): MonthlyBudget {
  const ids = prevMonthIds(year, month, 6)
  const acts = ids.map((id) => actuals[id]).filter((a): a is MonthlyActuals => !!a)
  const n = acts.length || 1
  const id = makeMonthId(year, month)
  const cats: CategoryBudget[] = categories.map((cat) => {
    const totalAmt = acts.reduce((s, a) => {
      return s + a.entries.filter((e) => e.categoryId === cat.id).reduce((ss, e) => ss + e.totalAmount, 0)
    }, 0)
    return {
      categoryId: cat.id,
      amount: Math.round(totalAmt / n),
      subcategories: cat.subcategories.map((sub) => {
        const totalSubAmt = acts.reduce((s, a) => {
          const subEntry = a.entries.find((e) => e.categoryId === cat.id && e.subcategoryId === sub.id)
          return s + (subEntry?.totalAmount ?? 0)
        }, 0)
        const recurring = recurringItems
          .filter((r) => r.categoryId === cat.id && r.subcategoryId === sub.id)
          .reduce((s, r) => s + r.amount, 0)
        return {
          subcategoryId: sub.id,
          amount: acts.length > 0 ? Math.round(totalSubAmt / n) : recurring,
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

export function createYearlyBudgetFromPrevYearBudget(
  year: number,
  categories: CategoryDef[],
  prevYearlyBudget: YearlyBudget
): YearlyBudget {
  return {
    id: String(year),
    year,
    categories: categories.map((cat) => {
      const prevCat = prevYearlyBudget.categories.find((c) => c.categoryId === cat.id)
      return {
        categoryId: cat.id,
        annualAmount: prevCat?.annualAmount ?? 0,
        monthlyAllocation: 'equal',
        subcategories: cat.subcategories.map((sub) => {
          const prevSub = prevCat?.subcategories.find((s) => s.subcategoryId === sub.id)
          return { subcategoryId: sub.id, annualAmount: prevSub?.annualAmount ?? 0 }
        }),
      }
    }),
  }
}

export function createYearlyBudgetFromActuals(
  year: number,
  categories: CategoryDef[],
  actuals: Record<string, MonthlyActuals>,
  sourceYear: number
): YearlyBudget {
  return {
    id: String(year),
    year,
    categories: categories.map((cat) => {
      let annualAmount = 0
      for (let m = 1; m <= 12; m++) {
        const act = actuals[makeMonthId(sourceYear, m)]
        if (act) {
          annualAmount += act.entries
            .filter((e) => e.categoryId === cat.id)
            .reduce((s, e) => s + e.totalAmount, 0)
        }
      }
      return {
        categoryId: cat.id,
        annualAmount: Math.round(annualAmount),
        monthlyAllocation: 'equal',
        subcategories: cat.subcategories.map((sub) => ({ subcategoryId: sub.id, annualAmount: 0 })),
      }
    }),
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
