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
  YearlyCategoryBudget,
  LiquidityEntry,
  ZlantarCategoryRule,
  GroceryReceipt,
  GroceryCategory,
  MatchedTransaction,
  ImportSnapshot,
  AccountBalance,
  AccountType,
  ReconciliationRecord,
  TxOverride,
  TxConflict,
  MonthClose,
} from '@/types'
import { extractOwner, buildMonthEntries } from '@/utils/zlantarParser'
import { txKey, reconciledKeysFromRecords } from '@/utils/transferReconciliation'
import { getMonthIdForDate } from '@/utils/periodUtils'
import { DEFAULT_CATEGORIES, DEFAULT_ZLANTAR_RULES, GROCERY_LEVEL3 } from './defaultCategories'

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

// v2 → v3: add importSnapshots array
function migrateV2(raw: Record<string, unknown>): Record<string, unknown> {
  return { ...raw, importSnapshots: [] }
}

// v3 → v4: add reconciliations array for transfer reconciliation between owners
function migrateV3(raw: Record<string, unknown>): Record<string, unknown> {
  return { ...raw, reconciliations: [] }
}

// v4 → v5: re-key accounts from `${bank.name}_${account_index}` to account_number,
// so accounts from different Zlantar exports (e.g. two partners' data) don't collide.
// The mapping is recovered from lastZlantarImport.data.banks if present; accounts
// with no recoverable mapping keep their old ID.
function migrateV4(raw: Record<string, unknown>): Record<string, unknown> {
  const lastImport = raw.lastZlantarImport as ZlantarImport | undefined
  const banks = lastImport?.data?.banks
  if (!banks || banks.length === 0) return raw

  const idMap = new Map<string, string>()
  for (const bank of banks) {
    for (const acc of bank.accounts ?? []) {
      if (acc.account_number) {
        idMap.set(`${bank.name}_${acc.account_index}`, acc.account_number)
      }
    }
  }
  if (idMap.size === 0) return raw

  const remap = (id: string | undefined): string | undefined =>
    id === undefined ? undefined : idMap.get(id) ?? id

  // Settings: accounts + recurringItems.accountId
  const settings = { ...(raw.settings as AppSettings | undefined) } as AppSettings
  if (Array.isArray(settings.accounts)) {
    const owner = lastImport && extractOwner(lastImport.data)
    settings.accounts = settings.accounts.map((a) => {
      const newId = idMap.get(a.id) ?? a.id
      // Backfill owner for accounts that came from this lastImport but had no owner set.
      const fillOwner = owner && !a.owner && idMap.has(a.id) ? owner : a.owner
      return { ...a, id: newId, owner: fillOwner }
    })
  }
  if (Array.isArray(settings.recurringItems)) {
    settings.recurringItems = settings.recurringItems.map((r) =>
      r.accountId ? { ...r, accountId: remap(r.accountId)! } : r
    )
  }

  const remapBalances = (list: AccountBalance[] | undefined): AccountBalance[] =>
    (list ?? []).map((ab) => ({ ...ab, accountId: remap(ab.accountId)! }))

  // Actuals
  const actuals = { ...(raw.actuals as Record<string, MonthlyActuals> | undefined) } as Record<string, MonthlyActuals>
  for (const ym of Object.keys(actuals)) {
    actuals[ym] = { ...actuals[ym], accountBalances: remapBalances(actuals[ym].accountBalances) }
  }

  // ImportSnapshots
  const importSnapshots = (raw.importSnapshots as ImportSnapshot[] | undefined) ?? []
  const remappedSnapshots = importSnapshots.map((s) => ({
    ...s,
    accountBalances: remapBalances(s.accountBalances),
  }))

  // LiquidityPlans
  const liquidityPlans = { ...(raw.liquidityPlans as Record<string, LiquidityPlan> | undefined) } as Record<string, LiquidityPlan>
  for (const yr of Object.keys(liquidityPlans)) {
    const plan = liquidityPlans[yr]
    liquidityPlans[yr] = {
      ...plan,
      startingBalances: remapBalances(plan.startingBalances),
      entries: (plan.entries ?? []).map((e) =>
        e.accountId ? { ...e, accountId: remap(e.accountId)! } : e
      ),
    }
  }

  return { ...raw, settings, actuals, importSnapshots: remappedSnapshots, liquidityPlans }
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

// v5 → v6: introduce transactionOverrides (per-transaction re-categorization) and
// seed the grocery level-3 onto an existing 'food' category that predates it, so
// upgrading users get the same defaults as a fresh install.
function migrateV5(raw: Record<string, unknown>): Record<string, unknown> {
  const transactionOverrides = (raw.transactionOverrides as Record<string, TxOverride>) ?? {}
  const settings = (raw.settings ?? {}) as AppSettings
  const categories = (settings.categories ?? DEFAULT_CATEGORIES).map((c) =>
    c.id === 'food' && !(c.level3 && c.level3.length) ? { ...c, level3: GROCERY_LEVEL3 } : c
  )
  return { ...raw, transactionOverrides, settings: { ...settings, categories } }
}

// v6 → v7: add monthCloses map for the monthly close/reconciliation ritual.
function migrateV6(raw: Record<string, unknown>): Record<string, unknown> {
  return { ...raw, monthCloses: (raw.monthCloses as Record<string, MonthClose>) ?? {} }
}

// v7 → v8: add importConflicts array for tracking previously flagged tx conflicts.
function migrateV7(raw: Record<string, unknown>): Record<string, unknown> {
  return { ...raw, importConflicts: [] }
}

// Rebuild one already-imported month's actuals from allTransactions + overrides,
// preserving the snapshot's accountBalances / importedAt. Runs after every
// re-categorization so aggregated budget totals stay in sync with the transactions.
// Months that were never imported (no existing actuals) are left untouched —
// re-categorization still shows live in the Transactions view.
function recomputeMonth(
  state: AppState,
  monthId: string,
  overrides: Record<string, TxOverride>
): Record<string, MonthlyActuals> {
  const existing = state.actuals[monthId]
  if (!existing) return state.actuals
  const { settings } = state
  const reconciled = reconciledKeysFromRecords(state.reconciliations)
  const entries = buildMonthEntries(
    state.allTransactions, monthId, settings.categories, settings.zlantarCategoryRules,
    overrides, reconciled, settings.monthStartDay, settings.monthStartBusinessDay
  )
  return { ...state.actuals, [monthId]: { ...existing, entries } }
}

// Rebuild all imported actuals from allTransactions using new settings.
// Used when category rules, categories, or period boundaries change so the user
// never has to re-import just to see the effect of a settings change.
// Period changes can shift transactions between months, so we union old and new
// month IDs and drop any that end up with no entries.
function recomputeAllActuals(
  state: AppState,
  newSettings: AppSettings,
): Record<string, MonthlyActuals> {
  if (state.allTransactions.length === 0) return state.actuals

  const reconciled = reconciledKeysFromRecords(state.reconciliations)

  // Months that will have transactions under the new period settings
  const newMonthIds = new Set<string>()
  for (const tx of state.allTransactions) {
    if (!tx.date || tx.transaction_type === 'transfer') continue
    newMonthIds.add(getMonthIdForDate(tx.date, newSettings.monthStartDay, newSettings.monthStartBusinessDay))
  }

  // Union old + new month IDs so a period shift doesn't silently drop data
  const allMonthIds = new Set([...Object.keys(state.actuals), ...newMonthIds])

  // Fallback account balances: use the most recently imported snapshot
  const existingList = Object.values(state.actuals)
  const latestSnapshot = existingList.length > 0
    ? existingList.reduce((a, b) => (a.importedAt > b.importedAt ? a : b))
    : null

  const result: Record<string, MonthlyActuals> = {}
  for (const monthId of allMonthIds) {
    const existing = state.actuals[monthId]
    const entries = buildMonthEntries(
      state.allTransactions, monthId, newSettings.categories, newSettings.zlantarCategoryRules,
      state.transactionOverrides, reconciled, newSettings.monthStartDay, newSettings.monthStartBusinessDay
    )
    if (entries.length === 0) continue
    const [yearStr, monthStr] = monthId.split('-')
    result[monthId] = {
      id: monthId,
      year: parseInt(yearStr),
      month: parseInt(monthStr),
      entries,
      accountBalances: existing?.accountBalances ?? latestSnapshot?.accountBalances ?? [],
      importedAt: existing?.importedAt ?? latestSnapshot?.importedAt ?? new Date().toISOString(),
    }
  }
  return result
}

const DEFAULT_SETTINGS: AppSettings = {
  currency: 'SEK',
  defaultView: 'monthly',
  fiscalYearStart: 1,
  monthStartDay: 1,
  monthStartBusinessDay: false,
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

  // Per-transaction category overrides (keyed by txKey)
  setTransactionOverride: (txId: string, override: TxOverride) => void
  clearTransactionOverride: (txId: string) => void

  // Transfer reconciliation (between owners)
  addReconciliationRecord: (record: ReconciliationRecord) => void
  removeReconciliationRecord: (id: string) => void

  // Import conflict tracking
  setImportConflicts: (conflicts: TxConflict[]) => void

  // Monthly close / reconciliation ritual
  closeMonth: (close: MonthClose) => void
  reopenMonth: (monthId: string) => void

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
      transactionOverrides: {},
      lastZlantarImport: undefined,
      importSnapshots: [],
      reconciliations: [],
      importConflicts: [],
      monthCloses: {},

      updateSettings: (s) =>
        set((state) => {
          const newSettings = { ...state.settings, ...s }
          const periodChanged =
            (s.monthStartDay !== undefined && s.monthStartDay !== state.settings.monthStartDay) ||
            (s.monthStartBusinessDay !== undefined && s.monthStartBusinessDay !== state.settings.monthStartBusinessDay)
          if (periodChanged) {
            return { settings: newSettings, actuals: recomputeAllActuals(state, newSettings) }
          }
          return { settings: newSettings }
        }),

      setCategories: (cats) =>
        set((state) => {
          const newSettings = { ...state.settings, categories: cats }
          return { settings: newSettings, actuals: recomputeAllActuals(state, newSettings) }
        }),

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
        set((state) => {
          const existing = state.actuals[actuals.id]
          if (!existing || actuals.accountBalances.length === 0) {
            return { actuals: { ...state.actuals, [actuals.id]: actuals } }
          }
          // Merge accountBalances: new values win for accounts present in the new import,
          // but preserve balances for accounts that belong to a different partner's import
          // and are absent from this one — so re-importing one partner's data never wipes
          // the other partner's account balances from the snapshot.
          const newIds = new Set(actuals.accountBalances.map((ab) => ab.accountId))
          const mergedBalances = [
            ...actuals.accountBalances,
            ...existing.accountBalances.filter((ab) => !newIds.has(ab.accountId)),
          ]
          return {
            actuals: {
              ...state.actuals,
              [actuals.id]: { ...actuals, accountBalances: mergedBalances },
            },
          }
        }),

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
          const newSettings = { ...state.settings, zlantarCategoryRules: [...rules, rule] }
          return { settings: newSettings, actuals: recomputeAllActuals(state, newSettings) }
        }),

      removeZlantarRule: (id) =>
        set((state) => {
          const newSettings = {
            ...state.settings,
            zlantarCategoryRules: state.settings.zlantarCategoryRules.filter((r) => r.id !== id),
          }
          return { settings: newSettings, actuals: recomputeAllActuals(state, newSettings) }
        }),

      setZlantarImport: (imp) =>
        set((state) => {
          const existingKeys = new Set(state.allTransactions.map(txKey))
          const newTxs = imp.transactions.filter((tx) => !existingKeys.has(txKey(tx)))

          // Build account balance snapshot from this import
          const accountBalances: AccountBalance[] = []
          for (const bank of imp.data.banks ?? []) {
            for (const acc of bank.accounts ?? []) {
              const type = ((): AccountType => {
                switch (acc.type) {
                  case 'Loan':          return 'loan'
                  case 'Credit':        return 'credit'
                  case 'Savings':       return 'savings'
                  case 'Transactional': return 'checking'
                  default:              return 'other'
                }
              })()
              accountBalances.push({
                accountId: acc.account_number,
                accountName: acc.name,
                accountType: type,
                balance: acc.balance,
                currency: 'SEK',
              })
            }
          }

          const snapshot: ImportSnapshot = {
            id: imp.importedAt,
            importedAt: imp.importedAt,
            accountBalances,
          }

          // Avoid duplicate snapshots (same importedAt)
          const snapshots = state.importSnapshots.some((s) => s.id === snapshot.id)
            ? state.importSnapshots
            : [...state.importSnapshots, snapshot]

          return {
            lastZlantarImport: imp,
            allTransactions: [...state.allTransactions, ...newTxs],
            importSnapshots: snapshots,
          }
        }),

      setTransactionOverride: (txId, override) =>
        set((state) => {
          const transactionOverrides = { ...state.transactionOverrides, [txId]: override }
          const tx = state.allTransactions.find((t) => txKey(t) === txId)
          if (!tx?.date) return { transactionOverrides }
          const monthId = getMonthIdForDate(tx.date, state.settings.monthStartDay, state.settings.monthStartBusinessDay)
          return { transactionOverrides, actuals: recomputeMonth(state, monthId, transactionOverrides) }
        }),

      clearTransactionOverride: (txId) =>
        set((state) => {
          const { [txId]: _removed, ...transactionOverrides } = state.transactionOverrides
          const tx = state.allTransactions.find((t) => txKey(t) === txId)
          if (!tx?.date) return { transactionOverrides }
          const monthId = getMonthIdForDate(tx.date, state.settings.monthStartDay, state.settings.monthStartBusinessDay)
          return { transactionOverrides, actuals: recomputeMonth(state, monthId, transactionOverrides) }
        }),

      addReconciliationRecord: (record) =>
        set((state) => {
          const filtered = state.reconciliations.filter((r) => r.id !== record.id)
          return { reconciliations: [...filtered, record] }
        }),

      removeReconciliationRecord: (id) =>
        set((state) => ({
          reconciliations: state.reconciliations.filter((r) => r.id !== id),
        })),

      setImportConflicts: (conflicts) =>
        set(() => ({ importConflicts: conflicts })),

      closeMonth: (close) =>
        set((state) => ({ monthCloses: { ...state.monthCloses, [close.monthId]: close } })),

      reopenMonth: (monthId) =>
        set((state) => {
          const { [monthId]: _, ...rest } = state.monthCloses
          return { monthCloses: rest }
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
      version: 8,
      migrate: (persistedState: unknown, version: number) => {
        let state = (persistedState ?? {}) as Record<string, unknown>
        if (version < 1) state = migrateV0(state)
        if (version < 2) state = migrateV1(state)
        if (version < 3) state = migrateV2(state)
        if (version < 4) state = migrateV3(state)
        if (version < 5) state = migrateV4(state)
        if (version < 6) state = migrateV5(state)
        if (version < 7) state = migrateV6(state)
        if (version < 8) state = migrateV7(state)
        return state
      },
    }
  )
)
