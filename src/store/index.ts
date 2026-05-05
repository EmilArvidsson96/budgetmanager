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
  CategoryDef,
  Account,
  RecurringItem,
  CategoryBudget,
  LiquidityEntry,
  ZlantarCategoryRule,
} from '@/types'
import { DEFAULT_CATEGORIES, DEFAULT_ZLANTAR_RULES } from './defaultCategories'

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
}

export const useAppStore = create<AppStore>()(
  persist(
    (set) => ({
      settings: DEFAULT_SETTINGS,
      monthlyBudgets: {},
      yearlyBudgets: {},
      actuals: {},
      liquidityPlans: {},
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

      setZlantarImport: (imp) => set({ lastZlantarImport: imp }),
    }),
    { name: 'budgethanteraren-v1' }
  )
)
