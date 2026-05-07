import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type {
  AppState,
  AppSettings,
  MonthlyBudget,
  YearlyBudget,
  MonthlyActuals,
  LiquidityPlan,
  ZlantarImport,
  ZlantarTransaction,
  CategoryDef,
  Account,
  RecurringItem,
  CategoryBudget,
  YearlyCategoryBudget,
  LiquidityEntry,
  ZlantarCategoryRule,
  GroceryReceipt,
  GroceryCategory,
  MatchedTransaction,
} from '@/types'
import { DEFAULT_CATEGORIES, DEFAULT_ZLANTAR_RULES } from './defaultCategories'

// ─── Store migration ──────────────────────────────────────────────────────────

const OLD_INCOME_IDS = new Set(['salary', 'interest', 'refund', 'sale'])

// v0 → v1: consolidate flat income categories into a single 'income' category
function migrateV0(raw: Record<string, unknown>): Record<string, unknown> {
  // ── Settings ──────────────────────────────────────────────────────────────
  const settings = { ...(raw.settings as AppSettings) }
  const cats: CategoryDef[] = settings.categories ?? DEFAULT_CATEGORIES

  const hasOldIncome = cats.some((c) => c.id === 'salary' && c.type === 'income')
  if (hasOldIncome) {
    const incomeCat = DEFAULT_CATEGORIES.find((c) => c.id === 'income')!
    settings.categories = [incomeCat, ...cats.filter((c) => !OLD_INCOME_IDS.has(c.id))]
  }
  if (!settings.zlantarCategoryRules) {
    settings.zlantarCategoryRules = DEFAULT_ZLANTAR_RULES
  }

  // ── Monthly budgets ────────────────────────────────────────────────────────
  const incomeDef = DEFAULT_CATEGORIES.find((c) => c.id === 'income')!
  const monthlyBudgets = { ...(raw.monthlyBudgets as Record<string, MonthlyBudget>) }

  for (const ym of Object.keys(monthlyBudgets)) {
    const budget = monthlyBudgets[ym]
    const oldEntries = budget.categories.filter((c) => OLD_INCOME_IDS.has(c.categoryId))
    if (oldEntries.length === 0) continue

    const incomeEntry: CategoryBudget = {
      categoryId: 'income',
      amount: oldEntries.reduce((s, c) => s + c.amount, 0),
      subcategories: incomeDef.subcategories.map((sub) => ({
        subcategoryId: sub.id,
        amount: oldEntries.find((e) => e.categoryId === sub.id)?.amount ?? 0,
      })),
    }
    monthlyBudgets[ym] = {
      ...budget,
      categories: [incomeEntry, ...budget.categories.filter((c) => !OLD_INCOME_IDS.has(c.categoryId))],
    }
  }

  // ── Yearly budgets ─────────────────────────────────────────────────────────
  const yearlyBudgets = { ...(raw.yearlyBudgets as Record<string, YearlyBudget>) }

  for (const yr of Object.keys(yearlyBudgets)) {
    const budget = yearlyBudgets[yr]
    const oldEntries = budget.categories.filter((c) => OLD_INCOME_IDS.has(c.categoryId))
    if (oldEntries.length === 0) continue

    const incomeEntry: YearlyCategoryBudget = {
      categoryId: 'income',
      annualAmount: oldEntries.reduce((s, c) => s + c.annualAmount, 0),
      monthlyAllocation: 'equal',
      subcategories: incomeDef.subcategories.map((sub) => ({
        subcategoryId: sub.id,
        annualAmount: oldEntries.find((e) => e.categoryId === sub.id)?.annualAmount ?? 0,
      })),
    }
    yearlyBudgets[yr] = {
      ...budget,
      categories: [incomeEntry, ...budget.categories.filter((c) => !OLD_INCOME_IDS.has(c.categoryId))],
    }
  }

  return { ...raw, settings, monthlyBudgets, yearlyBudgets }
}

// v1 → v2: budget amounts for expense/savings/transfer are now stored as negative
function migrateV1(raw: Record<string, unknown>): Record<string, unknown> {
  const settings = raw.settings as AppSettings
  const catTypeMap = new Map((settings?.categories ?? []).map((c) => [c.id, c.type]))

  const monthlyBudgets = { ...(raw.monthlyBudgets as Record<string, MonthlyBudget>) }
  for (const ym of Object.keys(monthlyBudgets)) {
    const budget = monthlyBudgets[ym]
    monthlyBudgets[ym] = {
      ...budget,
      categories: budget.categories.map((c) => {
        const type = catTypeMap.get(c.categoryId)
        if (type === 'expense' || type === 'savings' || type === 'transfer') {
          return {
            ...c,
            amount: c.amount > 0 ? -c.amount : c.amount,
            subcategories: c.subcategories.map((s) => ({
              ...s,
              amount: s.amount > 0 ? -s.amount : s.amount,
            })),
          }
        }
        return c
      }),
    }
  }

  const yearlyBudgets = { ...(raw.yearlyBudgets as Record<string, YearlyBudget>) }
  for (const yr of Object.keys(yearlyBudgets)) {
    const budget = yearlyBudgets[yr]
    yearlyBudgets[yr] = {
      ...budget,
      categories: budget.categories.map((c) => {
        const type = catTypeMap.get(c.categoryId)
        if (type === 'expense' || type === 'savings' || type === 'transfer') {
          return {
            ...c,
            annualAmount: c.annualAmount > 0 ? -c.annualAmount : c.annualAmount,
            subcategories: c.subcategories.map((s) => ({
              ...s,
              annualAmount: s.annualAmount > 0 ? -s.annualAmount : s.annualAmount,
            })),
          }
        }
        return c
      }),
    }
  }

  return { ...raw, monthlyBudgets, yearlyBudgets }
}

const DEFAULT_SETTINGS: AppSettings = {
  currency: 'SEK',
  defaultView: 'monthly',
  fiscalYearStart: 1,
  categories: DEFAULT_CATEGORIES,
  accounts: [],
  recurringItems: [],
  zlantarCategoryRules: DEFAULT_ZLANTAR_RULES,
}

interface AppStore extends AppState {
  // Settings
  updateSettings: (s: Partial<AppSettings>) => void
  setCategories: (cats: CategoryDef[]) => void
  upsertAccount: (account: Account) => void
  removeAccount: (id: string) => void
  upsertRecurring: (item: RecurringItem) => void
  removeRecurring: (id: string) => void

  // Monthly budgets
  upsertMonthlyBudget: (budget: MonthlyBudget) => void
  updateMonthlyCategories: (id: string, categories: CategoryBudget[]) => void
  removeMonthlyBudget: (id: string) => void

  // Yearly budgets
  upsertYearlyBudget: (budget: YearlyBudget) => void
  removeYearlyBudget: (id: string) => void

  // Actuals
  upsertActuals: (actuals: MonthlyActuals) => void
  removeActuals: (id: string) => void

  // Liquidity
  upsertLiquidityPlan: (plan: LiquidityPlan) => void
  upsertLiquidityEntry: (planId: string, entry: LiquidityEntry) => void
  removeLiquidityEntry: (planId: string, entryId: string) => void

  // Zlantar category rules
  upsertZlantarRule: (rule: ZlantarCategoryRule) => void
  removeZlantarRule: (id: string) => void

  // Zlantar import
  setZlantarImport: (imp: ZlantarImport) => void

  // Grocery receipts
  addGroceryReceipt: (receipt: GroceryReceipt) => void
  removeGroceryReceipt: (id: string) => void
  updateGroceryReceiptItemCategory: (receiptId: string, itemIndex: number, category: GroceryCategory) => void
  setReceiptMatchedTransaction: (receiptId: string, tx: MatchedTransaction | undefined) => void
}

export const useAppStore = create<AppStore>()(
  persist(
    (set) => ({
      settings: DEFAULT_SETTINGS,
      monthlyBudgets: {},
      yearlyBudgets: {},
      actuals: {},
      liquidityPlans: {},
      groceryReceipts: [],
      allTransactions: [],
      lastZlantarImport: undefined,

      updateSettings: (s) =>
        set((state) => ({ settings: { ...state.settings, ...s } })),

      setCategories: (cats) =>
        set((state) => ({ settings: { ...state.settings, categories: cats } })),

      upsertAccount: (account) =>
        set((state) => {
          const accounts = state.settings.accounts.filter((a) => a.id !== account.id)
          return { settings: { ...state.settings, accounts: [...accounts, account] } }
        }),

      removeAccount: (id) =>
        set((state) => ({
          settings: {
            ...state.settings,
            accounts: state.settings.accounts.filter((a) => a.id !== id),
          },
        })),

      upsertRecurring: (item) =>
        set((state) => {
          const items = state.settings.recurringItems.filter((r) => r.id !== item.id)
          return { settings: { ...state.settings, recurringItems: [...items, item] } }
        }),

      removeRecurring: (id) =>
        set((state) => ({
          settings: {
            ...state.settings,
            recurringItems: state.settings.recurringItems.filter((r) => r.id !== id),
          },
        })),

      upsertMonthlyBudget: (budget) =>
        set((state) => ({
          monthlyBudgets: { ...state.monthlyBudgets, [budget.id]: budget },
        })),

      updateMonthlyCategories: (id, categories) =>
        set((state) => ({
          monthlyBudgets: {
            ...state.monthlyBudgets,
            [id]: { ...state.monthlyBudgets[id], categories },
          },
        })),

      removeMonthlyBudget: (id) =>
        set((state) => {
          const { [id]: _, ...rest } = state.monthlyBudgets
          return { monthlyBudgets: rest }
        }),

      upsertYearlyBudget: (budget) =>
        set((state) => ({
          yearlyBudgets: { ...state.yearlyBudgets, [budget.id]: budget },
        })),

      removeYearlyBudget: (id) =>
        set((state) => {
          const { [id]: _, ...rest } = state.yearlyBudgets
          return { yearlyBudgets: rest }
        }),

      upsertActuals: (actuals) =>
        set((state) => ({
          actuals: { ...state.actuals, [actuals.id]: actuals },
        })),

      removeActuals: (id) =>
        set((state) => {
          const { [id]: _, ...rest } = state.actuals
          return { actuals: rest }
        }),

      upsertLiquidityPlan: (plan) =>
        set((state) => ({
          liquidityPlans: { ...state.liquidityPlans, [plan.id]: plan },
        })),

      upsertLiquidityEntry: (planId, entry) =>
        set((state) => {
          const plan = state.liquidityPlans[planId]
          if (!plan) return {}
          const entries = plan.entries.filter((e) => e.id !== entry.id)
          return {
            liquidityPlans: {
              ...state.liquidityPlans,
              [planId]: { ...plan, entries: [...entries, entry] },
            },
          }
        }),

      removeLiquidityEntry: (planId, entryId) =>
        set((state) => {
          const plan = state.liquidityPlans[planId]
          if (!plan) return {}
          return {
            liquidityPlans: {
              ...state.liquidityPlans,
              [planId]: {
                ...plan,
                entries: plan.entries.filter((e) => e.id !== entryId),
              },
            },
          }
        }),

      upsertZlantarRule: (rule) =>
        set((state) => {
          const rules = state.settings.zlantarCategoryRules.filter((r) => r.id !== rule.id)
          return { settings: { ...state.settings, zlantarCategoryRules: [...rules, rule] } }
        }),

      removeZlantarRule: (id) =>
        set((state) => ({
          settings: {
            ...state.settings,
            zlantarCategoryRules: state.settings.zlantarCategoryRules.filter((r) => r.id !== id),
          },
        })),

      setZlantarImport: (imp) =>
        set((state) => {
          const existingKeys = new Set(
            state.allTransactions.map((tx: ZlantarTransaction) =>
              `${tx.date}|${tx.amount}|${tx.description ?? ''}`
            )
          )
          const newTxs = imp.transactions.filter(
            (tx) => !existingKeys.has(`${tx.date}|${tx.amount}|${tx.description ?? ''}`)
          )
          return {
            lastZlantarImport: imp,
            allTransactions: [...state.allTransactions, ...newTxs],
          }
        }),

      addGroceryReceipt: (receipt) =>
        set((state) => ({ groceryReceipts: [...state.groceryReceipts, receipt] })),

      removeGroceryReceipt: (id) =>
        set((state) => ({ groceryReceipts: state.groceryReceipts.filter((r) => r.id !== id) })),

      updateGroceryReceiptItemCategory: (receiptId, itemIndex, category) =>
        set((state) => ({
          groceryReceipts: state.groceryReceipts.map((r) => {
            if (r.id !== receiptId) return r
            const items = r.items.map((item, i) =>
              i === itemIndex ? { ...item, category } : item
            )
            return { ...r, items }
          }),
        })),

      setReceiptMatchedTransaction: (receiptId, tx) =>
        set((state) => ({
          groceryReceipts: state.groceryReceipts.map((r) =>
            r.id === receiptId ? { ...r, matchedTransaction: tx } : r
          ),
        })),
    }),
    {
      name: 'budgethanteraren-v1',
      version: 2,
      migrate: (persistedState: unknown, version: number) => {
        let state = (persistedState ?? {}) as Record<string, unknown>
        if (version < 1) state = migrateV0(state)
        if (version < 2) state = migrateV1(state)
        return state
      },
    }
  )
)
