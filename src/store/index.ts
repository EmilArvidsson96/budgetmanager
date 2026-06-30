import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type {
  AppState,
  AppSettings,
  MonthlyBudget,
  YearlyBudget,
  BudgetBaseline,
  BaselineCategory,
  PlanGridConfig,
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
  ReconciliationRecord,
  TxOverride,
  TxConflict,
  MonthClose,
  WealthForecastSnapshot,
} from '@/types'
import {
  extractOwner,
  buildMonthEntries,
  buildAccountBalances,
  mergeAccountBalances,
  accountBalancesEqual,
} from '@/utils/zlantarParser'
import { txKey, reconciledKeysFromRecords } from '@/utils/transferReconciliation'
import { getMonthIdForDate } from '@/utils/periodUtils'
import { getSalaryAnchors } from '@/utils/salaryDetection'
import { computeFrozenElapsed, currentMonthId, snapshotMonthBudget } from '@/utils/projection'
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

// v8 → v9: introduce the rolling budget baseline + per-month overrides — the new
// editable budget model. Seed the baseline from the most recent yearly budget
// (annual ÷ 12) or, failing that, the most recent monthly budget, so existing
// plans carry over. The legacy monthly/yearly tables are kept untouched as a
// fallback (see budgetedAmount) so closed-month history survives.
function migrateV8(raw: Record<string, unknown>): Record<string, unknown> {
  if (raw.budgetBaseline && raw.budgetOverrides) return raw

  const yearly = (raw.yearlyBudgets as Record<string, YearlyBudget>) ?? {}
  const monthly = (raw.monthlyBudgets as Record<string, MonthlyBudget>) ?? {}

  let categories: BaselineCategory[] = []
  const yearKeys = Object.keys(yearly).sort()
  const monthKeys = Object.keys(monthly).sort()
  if (yearKeys.length > 0) {
    const yb = yearly[yearKeys[yearKeys.length - 1]]
    categories = yb.categories.map((c) => ({
      categoryId: c.categoryId,
      target: Math.round(c.annualAmount / 12),
    }))
  } else if (monthKeys.length > 0) {
    const mb = monthly[monthKeys[monthKeys.length - 1]]
    categories = mb.categories.map((c) => ({ categoryId: c.categoryId, target: c.amount }))
  }

  return {
    ...raw,
    budgetBaseline: (raw.budgetBaseline as BudgetBaseline) ?? { categories },
    budgetOverrides: (raw.budgetOverrides as Record<string, Record<string, number>>) ?? {},
  }
}

// v9 → v10: merge orphaned top-level income categories into the canonical 'income'
// category as subcategories. These could have been created by the import flow before
// handleCreateCategory was fixed to add subcategories instead of new top-level cats.
function migrateV9(raw: Record<string, unknown>): Record<string, unknown> {
  const settings = { ...(raw.settings as AppSettings) }
  const cats: CategoryDef[] = settings.categories ?? DEFAULT_CATEGORIES

  // Any category with type 'income' that is not the canonical 'income' category is orphaned.
  const orphaned = cats.filter((c) => c.type === 'income' && c.id !== 'income')
  if (orphaned.length === 0) return raw

  const orphanedIds = new Set(orphaned.map((c) => c.id))
  const incomeCat = cats.find((c) => c.id === 'income')
  if (!incomeCat) return raw

  // Add orphaned categories as subcategories under 'income', using their id as subcategory id.
  const newSubs = orphaned.map((c) => ({ id: c.id, name: c.name, parentId: 'income' }))
  settings.categories = cats
    .filter((c) => !orphanedIds.has(c.id))
    .map((c) => c.id === 'income' ? { ...c, subcategories: [...c.subcategories, ...newSubs] } : c)

  // Remap Zlantar rules.
  settings.zlantarCategoryRules = (settings.zlantarCategoryRules ?? []).map((r) =>
    orphanedIds.has(r.appCategoryId)
      ? { ...r, appCategoryId: 'income', appSubcategoryId: r.appCategoryId }
      : r
  )

  // Remap budget baseline entries.
  const baseline = raw.budgetBaseline as BudgetBaseline | undefined
  let newBaseline = baseline
  if (baseline) {
    const orphanedLines = baseline.categories.filter((c) => orphanedIds.has(c.categoryId))
    if (orphanedLines.length > 0) {
      const newSubTargets = orphanedLines.map((e) => ({ subcategoryId: e.categoryId, target: e.target }))
      const hasIncomeEntry = baseline.categories.some((c) => c.categoryId === 'income')
      const updatedCats: BaselineCategory[] = baseline.categories
        .filter((c) => !orphanedIds.has(c.categoryId))
        .map((c) =>
          c.categoryId === 'income'
            ? { ...c, bySub: true, subTargets: [...(c.subTargets ?? []), ...newSubTargets] }
            : c
        )
      if (!hasIncomeEntry) {
        updatedCats.push({
          categoryId: 'income',
          target: orphanedLines.reduce((s, e) => s + e.target, 0),
          bySub: true,
          subTargets: newSubTargets,
        })
      }
      newBaseline = { ...baseline, categories: updatedCats }
    }
  }

  // Remap budget overrides (monthId → categoryId → amount).
  const overrides = raw.budgetOverrides as Record<string, Record<string, number>> | undefined
  let newOverrides = overrides
  if (overrides) {
    newOverrides = {}
    for (const [monthId, monthMap] of Object.entries(overrides)) {
      const newMonth: Record<string, number> = {}
      for (const [catId, amount] of Object.entries(monthMap)) {
        if (orphanedIds.has(catId)) {
          newMonth['income'] = (newMonth['income'] ?? 0) + amount
        } else {
          newMonth[catId] = amount
        }
      }
      newOverrides[monthId] = newMonth
    }
  }

  // Remap actuals entries.
  const actuals = raw.actuals as Record<string, MonthlyActuals> | undefined
  let newActuals = actuals
  if (actuals) {
    newActuals = {}
    for (const [monthId, monthActuals] of Object.entries(actuals)) {
      newActuals[monthId] = {
        ...monthActuals,
        entries: monthActuals.entries.map((e) =>
          orphanedIds.has(e.categoryId)
            ? { ...e, categoryId: 'income', subcategoryId: e.categoryId, subcategoryName: e.categoryName }
            : e
        ),
      }
    }
  }

  // Remap planGrid categoryIds.
  const planGrid = raw.planGrid as PlanGridConfig | undefined
  let newPlanGrid = planGrid
  if (planGrid?.categoryIds) {
    const hasIncome = planGrid.categoryIds.includes('income')
    const ids = planGrid.categoryIds.reduce<string[]>((acc, id) => {
      if (orphanedIds.has(id)) {
        if (!hasIncome && !acc.includes('income')) acc.push('income')
      } else {
        acc.push(id)
      }
      return acc
    }, [])
    newPlanGrid = { ...planGrid, categoryIds: ids }
  }

  // Remap transaction overrides.
  const txOverrides = raw.transactionOverrides as Record<string, TxOverride> | undefined
  let newTxOverrides = txOverrides
  if (txOverrides) {
    newTxOverrides = {}
    for (const [key, override] of Object.entries(txOverrides)) {
      newTxOverrides[key] = orphanedIds.has(override.categoryId)
        ? { ...override, categoryId: 'income', subcategoryId: override.categoryId }
        : override
    }
  }

  return {
    ...raw,
    settings,
    budgetBaseline: newBaseline,
    budgetOverrides: newOverrides,
    actuals: newActuals,
    planGrid: newPlanGrid,
    transactionOverrides: newTxOverrides,
  }
}

// v10 → v11: the rolling baseline is the single source of truth for open
// (current + future) months. Legacy per-month budgets were only ever kept as a
// fallback for closed-month history, but budgetedAmount reads monthlyBudgets
// *before* the baseline — so a stale entry on a future month silently won and
// inflated that month's net without showing in any plan-grid cell (e.g. an old
// July vacation-pay row). Drop legacy monthly budgets from the current month
// onward; past/closed months keep their plan untouched.
function migrateV10(raw: Record<string, unknown>): Record<string, unknown> {
  const monthly = raw.monthlyBudgets as Record<string, MonthlyBudget> | undefined
  if (!monthly) return raw

  const settings = (raw.settings ?? {}) as AppSettings
  const today = new Date()
  const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  const currentMonthId = getMonthIdForDate(iso, settings.monthStartDay, settings.monthStartBusinessDay)

  // monthId is 'YYYY-MM', so lexical comparison orders months correctly.
  const cleaned: Record<string, MonthlyBudget> = {}
  for (const [monthId, budget] of Object.entries(monthly)) {
    if (monthId < currentMonthId) cleaned[monthId] = budget
  }
  return { ...raw, monthlyBudgets: cleaned }
}

// v11 → v12: add budgetHistory — the frozen per-month plan for elapsed periods.
// Starts empty; freezeElapsedBudgets (run on hydration) backfills past months from
// their current effective budget on first load.
function migrateV11(raw: Record<string, unknown>): Record<string, unknown> {
  return { ...raw, budgetHistory: (raw.budgetHistory as Record<string, Record<string, number>>) ?? {} }
}

function migrateV12(raw: Record<string, unknown>): Record<string, unknown> {
  return { ...raw, wealthForecasts: (raw.wealthForecasts as Record<string, unknown>) ?? {} }
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
  // Use the incoming overrides so anchors reflect the same data as the entries.
  const { anchors } = getSalaryAnchors({
    allTransactions: state.allTransactions,
    settings,
    transactionOverrides: overrides,
  })
  const entries = buildMonthEntries(
    state.allTransactions, monthId, settings.categories, settings.zlantarCategoryRules,
    overrides, reconciled, settings.monthStartDay, settings.monthStartBusinessDay, anchors
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
  const { anchors } = getSalaryAnchors({
    allTransactions: state.allTransactions,
    settings: newSettings,
    transactionOverrides: state.transactionOverrides,
  })

  // Months that will have transactions under the new period settings
  const newMonthIds = new Set<string>()
  for (const tx of state.allTransactions) {
    if (!tx.date || tx.transaction_type === 'transfer') continue
    newMonthIds.add(getMonthIdForDate(tx.date, newSettings.monthStartDay, newSettings.monthStartBusinessDay, anchors))
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
      state.transactionOverrides, reconciled, newSettings.monthStartDay, newSettings.monthStartBusinessDay, anchors
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
  salaryAnchoredMonths: false,
  salaryDetectionWindowDays: 6,
  salaryMinAmount: 5000,
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

  // Rolling budget baseline ("normalmånad") + per-month overrides
  upsertBaselineCategory: (cat: BaselineCategory) => void
  setMonthOverride: (monthId: string, categoryId: string, amount: number | null) => void
  // Freeze the plan of every elapsed month into budgetHistory (run on hydration).
  freezeElapsedBudgets: () => void
  // Plan grid layout (visible rows/columns). null resets to the rolling default.
  setPlanGrid: (config: PlanGridConfig | null) => void

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

  // Wealth forecast snapshots (Rapport: this month's outlook vs last month's)
  captureWealthForecast: (snapshot: WealthForecastSnapshot) => void

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
      budgetBaseline: { categories: [] },
      budgetOverrides: {},
      budgetHistory: {},
      planGrid: undefined,
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
      wealthForecasts: {},

      updateSettings: (s) =>
        set((state) => {
          const newSettings = { ...state.settings, ...s }
          const periodChanged =
            (s.monthStartDay !== undefined && s.monthStartDay !== state.settings.monthStartDay) ||
            (s.monthStartBusinessDay !== undefined && s.monthStartBusinessDay !== state.settings.monthStartBusinessDay) ||
            (s.salaryAnchoredMonths !== undefined && s.salaryAnchoredMonths !== state.settings.salaryAnchoredMonths) ||
            (s.salaryDetectionWindowDays !== undefined && s.salaryDetectionWindowDays !== state.settings.salaryDetectionWindowDays) ||
            (s.salaryMinAmount !== undefined && s.salaryMinAmount !== state.settings.salaryMinAmount)
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

      upsertBaselineCategory: (cat) =>
        set((state) => {
          const others = state.budgetBaseline.categories.filter((c) => c.categoryId !== cat.categoryId)
          return { budgetBaseline: { categories: [...others, cat], updatedAt: new Date().toISOString() } }
        }),

      setMonthOverride: (monthId, categoryId, amount) =>
        set((state) => {
          const month = { ...(state.budgetOverrides[monthId] ?? {}) }
          if (amount === null) delete month[categoryId]
          else month[categoryId] = amount
          const next = { ...state.budgetOverrides }
          if (Object.keys(month).length === 0) delete next[monthId]
          else next[monthId] = month
          // Editing an already-elapsed month is a deliberate adjustment to its plan —
          // re-freeze it so the latest value is what history shows (and survives a
          // later baseline edit). Current/future months stay live until they elapse.
          if (monthId < currentMonthId(state)) {
            const snap = snapshotMonthBudget({ ...state, budgetOverrides: next }, monthId)
            return { budgetOverrides: next, budgetHistory: { ...state.budgetHistory, [monthId]: snap } }
          }
          return { budgetOverrides: next }
        }),

      freezeElapsedBudgets: () =>
        set((state) => {
          const frozen = computeFrozenElapsed(state)
          return frozen ? { budgetHistory: frozen } : {}
        }),

      setPlanGrid: (config) => set(() => ({ planGrid: config ?? undefined })),

      upsertActuals: (actuals) =>
        set((state) => {
          const existing = state.actuals[actuals.id]
          let nextActuals: Record<string, MonthlyActuals>
          if (!existing || actuals.accountBalances.length === 0) {
            nextActuals = { ...state.actuals, [actuals.id]: actuals }
          } else {
            // Merge accountBalances: new values win for accounts present in the new import,
            // but preserve balances for accounts that belong to a different partner's import
            // and are absent from this one — so re-importing one partner's data never wipes
            // the other partner's account balances from the snapshot.
            const newIds = new Set(actuals.accountBalances.map((ab) => ab.accountId))
            const mergedBalances = [
              ...actuals.accountBalances,
              ...existing.accountBalances.filter((ab) => !newIds.has(ab.accountId)),
            ]
            nextActuals = { ...state.actuals, [actuals.id]: { ...actuals, accountBalances: mergedBalances } }
          }
          // A freshly imported month that has already elapsed gets its plan frozen now.
          const frozen = computeFrozenElapsed({ ...state, actuals: nextActuals })
          return frozen ? { actuals: nextActuals, budgetHistory: frozen } : { actuals: nextActuals }
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

          // Account balances carried by this upload (empty for a tx-only import).
          const incomingBalances = buildAccountBalances(imp.data)

          // Carry forward balances for accounts not present in this upload so a
          // partial data.json (e.g. only one partner's banks) never drops the
          // other accounts' latest balance from the running snapshot.
          const prevSnapshot = state.importSnapshots.length > 0
            ? state.importSnapshots.reduce((a, b) => (a.importedAt > b.importedAt ? a : b))
            : null
          const mergedBalances = mergeAccountBalances(
            prevSnapshot?.accountBalances ?? [],
            incomingBalances
          )

          // Record a new snapshot only when this upload actually changes the
          // balances — re-uploading an identical data.json doesn't pile up dupes,
          // and a tx-only upload (no balances at all) records nothing.
          const isDuplicate =
            prevSnapshot != null && accountBalancesEqual(prevSnapshot.accountBalances, mergedBalances)
          const snapshots =
            mergedBalances.length === 0 || isDuplicate
              ? state.importSnapshots
              : [
                  ...state.importSnapshots,
                  { id: imp.importedAt, importedAt: imp.importedAt, accountBalances: mergedBalances } satisfies ImportSnapshot,
                ]

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
          const { anchors } = getSalaryAnchors({ allTransactions: state.allTransactions, settings: state.settings, transactionOverrides })
          const monthId = getMonthIdForDate(tx.date, state.settings.monthStartDay, state.settings.monthStartBusinessDay, anchors)
          return { transactionOverrides, actuals: recomputeMonth(state, monthId, transactionOverrides) }
        }),

      clearTransactionOverride: (txId) =>
        set((state) => {
          const { [txId]: _removed, ...transactionOverrides } = state.transactionOverrides
          const tx = state.allTransactions.find((t) => txKey(t) === txId)
          if (!tx?.date) return { transactionOverrides }
          const { anchors } = getSalaryAnchors({ allTransactions: state.allTransactions, settings: state.settings, transactionOverrides })
          const monthId = getMonthIdForDate(tx.date, state.settings.monthStartDay, state.settings.monthStartBusinessDay, anchors)
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

      // Store the current period's forecast, overwriting only that period — prior
      // periods stay frozen so each becomes a stable "last month" to compare against.
      captureWealthForecast: (snapshot) =>
        set((state) => ({
          wealthForecasts: { ...state.wealthForecasts, [snapshot.takenForPeriod]: snapshot },
        })),

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
      version: 13,
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
        if (version < 9) state = migrateV8(state)
        if (version < 10) state = migrateV9(state)
        if (version < 11) state = migrateV10(state)
        if (version < 12) state = migrateV11(state)
        if (version < 13) state = migrateV12(state)
        return state
      },
      // On load, lock in the plan for any month that has already elapsed so later
      // baseline edits can't rewrite history. Idempotent — only adds missing months.
      onRehydrateStorage: () => (state) => {
        state?.freezeElapsedBudgets()
      },
    }
  )
)
