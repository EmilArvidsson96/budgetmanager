// ─── Zlantar import types (matches actual export schema) ─────────────────────

export interface ZlantarRawAccount {
  name: string
  account_number: string
  balance: number
  type: string           // 'Loan' | 'Transactional' | 'Savings' | 'Credit'
  account_index: number
}

export interface ZlantarBank {
  name: string
  accounts: ZlantarRawAccount[]
}

export interface ZlantarAgreement {
  agreement_type: string   // 'media' | 'leisure' | 'transport' | 'finance' | 'household' | 'insurance'
  agreement_subtype: string
  amount: number
  frequency: string        // 'monthly' | 'quarterly' | 'every_other_month' | 'yearly'
  companies: string[]
  start_date?: string
  end_date?: string
  notes?: string
}

export interface ZlantarTransaction {
  index: number
  date: string
  amount: number
  description?: string
  transaction_type: string  // 'expense' | 'income' | 'savings' | 'transfer'
  category?: string         // 'food' | 'household' | 'transport' | 'shopping' | 'leisure' | 'other' | 'salary' | 'interest' | 'refund' | 'sale' | 'stocks' | ''
  subcategory?: string
  account_index: number
  bank_name: string
  account_number: string
  account_name: string
  tags?: string[]
  notes?: string
}

export interface ZlantarUser {
  first_name?: string
  [key: string]: unknown
}

export interface ZlantarData {
  banks?: ZlantarBank[]
  agreements?: ZlantarAgreement[]
  user?: ZlantarUser
  budget?: unknown[]
  residenceValuation?: unknown[]
  receipts?: unknown[]
  [key: string]: unknown
}

export interface ZlantarImport {
  data: ZlantarData
  transactions: ZlantarTransaction[]
  importedAt: string
  yearMonth?: string     // 'YYYY-MM' inferred from transaction dates
}

// ─── App data model ──────────────────────────────────────────────────────────

export interface CategoryDef {
  id: string
  name: string           // Swedish display name
  type: 'income' | 'expense' | 'transfer' | 'savings'
  subcategories: SubcategoryDef[]
  level3?: Level3Def[]   // optional third level — reporting/tagging only, not budgeted
  color?: string
  icon?: string
}

export interface SubcategoryDef {
  id: string
  name: string
  parentId: string
}

// Third-level category (e.g. under Matvaror). Reporting/tagging only — never part
// of the budget model. May be auto-derived from grocery receipts.
export interface Level3Def {
  id: string
  name: string
  parentSubId: string    // id of the SubcategoryDef this belongs to
}

export interface Account {
  id: string
  name: string
  type: AccountType
  bankName?: string
  currency: string
  interestRate?: number
  loanBalance?: number
  loanOriginalAmount?: number
  includeInLiquidity: boolean
  // Free-text owner label (e.g. "Mig", "Sambo", partner's name). Required for
  // the transfer-reconciliation logic to know which transactions can cancel
  // each other out.
  owner?: string

  // ─── Forward-projection assumptions (used by the Plan view) ───────────────
  // Expected annual return/appreciation as a fraction (0.07 = 7 %). Applies to
  // asset accounts (isk/investment/savings/property) for net-worth growth.
  expectedReturn?: number
  // Recurring monthly deposit into this asset account (SEK).
  monthlyContribution?: number
  // Recurring monthly amortization on a loan (SEK toward principal).
  monthlyPayment?: number
  // When true, the contribution/payment is already captured in a budget category
  // and should not be deducted from liquidity a second time in the projection.
  contributionIsBudgeted?: boolean
  // Current value for assets not present in any Zlantar import (e.g. a property)
  // or a manual override of the imported balance.
  manualValue?: number
  // Whether this account counts toward net worth. Defaults to true when unset.
  includeInNetWorth?: boolean
  // For liability accounts: ID of the asset account this loan is secured against.
  // When set the loan is netted into that asset in the wealth chart instead of
  // appearing as a separate negative bar. Multiple loans can share the same asset.
  linkedAssetId?: string
}

export type AccountType =
  | 'checking'
  | 'savings'
  | 'credit'
  | 'loan'
  | 'isk'
  | 'investment'
  | 'property'
  | 'other'

export interface RecurringItem {
  id: string
  name: string
  amount: number
  categoryId: string
  subcategoryId?: string
  accountId?: string
  type: 'expense' | 'income'
  dayOfMonth?: number
  notes?: string
}

// ─── Budget model ─────────────────────────────────────────────────────────────

export interface CategoryBudget {
  categoryId: string
  amount: number
  subcategories: SubcategoryBudget[]
  notes?: string
}

export interface SubcategoryBudget {
  subcategoryId: string
  amount: number
  notes?: string
}

export interface MonthlyBudget {
  id: string             // 'YYYY-MM'
  year: number
  month: number          // 1-12
  categories: CategoryBudget[]
  notes?: string
  isDetailed: boolean    // false = use yearly allocation
  lockedActuals?: boolean
}

export interface YearlyBudget {
  id: string             // 'YYYY'
  year: number
  categories: YearlyCategoryBudget[]
  notes?: string
}

export interface YearlyCategoryBudget {
  categoryId: string
  annualAmount: number
  monthlyAllocation: 'equal' | 'custom'
  customMonthAmounts?: Record<number, number>  // month 1-12
  subcategories: YearlySubcategoryBudget[]
}

export interface YearlySubcategoryBudget {
  subcategoryId: string
  annualAmount: number
}

// ─── Rolling budget baseline ("normalmånad") ──────────────────────────────────
//
// A single standing plan that represents a normal month. It drives the forward
// projection (Plan) and the month-vs-plan follow-up (Flöde). Per-month deviations
// (julklappar, semester, …) live in budgetOverrides, keyed monthId → categoryId.
// Replaces the old monthly+yearly budget tables as the editable source of truth.

export interface BaselineSubTarget {
  subcategoryId: string
  target: number          // signed monthly target
}

export interface BaselineCategory {
  categoryId: string
  target: number          // signed monthly target (income +, expense/savings −)
  bySub?: boolean         // when true, target is built from — and equals the sum of — subTargets
  subTargets?: BaselineSubTarget[]
}

export interface BudgetBaseline {
  categories: BaselineCategory[]
  updatedAt?: string
}

// Plan grid — the adjustable "coming months" table in Plan. When unset the grid
// shows a rolling default (current period month + next 11) and all income/expense
// categories. Once the user adds/removes a row or column, the explicit selection
// is stored here. This only governs which rows/columns are visible; the cell
// values themselves are ordinary budgetOverrides.
export interface PlanGridConfig {
  months: string[]        // explicit monthIds shown, ascending
  categoryIds: string[]   // explicit category rows shown, in order
}

// ─── Actuals (from Zlantar import) ───────────────────────────────────────────

export interface ActualEntry {
  categoryId: string
  categoryName: string
  subcategoryId?: string
  subcategoryName?: string
  totalAmount: number
  transactionCount: number
}

export interface MonthlyActuals {
  id: string             // 'YYYY-MM'
  year: number
  month: number
  entries: ActualEntry[]
  accountBalances: AccountBalance[]
  importedAt: string
}

export interface AccountBalance {
  accountId: string
  accountName: string
  accountType: AccountType
  balance: number
  currency: string
}

export interface ImportSnapshot {
  id: string             // = importedAt ISO string
  importedAt: string     // ISO timestamp
  accountBalances: AccountBalance[]
}

// ─── Liquidity ────────────────────────────────────────────────────────────────

export interface LiquidityEntry {
  id: string
  date: string           // 'YYYY-MM-DD'
  description: string
  amount: number
  type: 'income' | 'expense' | 'transfer' | 'loan_payment'
  categoryId?: string
  accountId?: string
  isRecurring?: boolean
  isConfirmed?: boolean
  // Whether this entry is counted in the liquidity projection. Defaults to
  // true when unset — set to false to keep a planned one-time cost on record
  // without it affecting the projected balance.
  includeInProjection?: boolean
}

export interface LiquidityPlan {
  id: string             // 'YYYY'
  year: number
  entries: LiquidityEntry[]
  startingBalances: AccountBalance[]
  startingBalanceMode: 'computed' | 'manual'
  manualStartingBalance?: number
  notes?: string
}

// ─── Wealth forecast snapshots (Rapport: vs förra månaden) ───────────────────

// One point on a saved net-worth projection curve.
export interface WealthForecastPoint {
  monthId: string        // 'YYYY-MM'
  netWorth: number
}

// A snapshot of the forward net-worth projection as it looked when taken. Saved
// once per period (keyed by the period it was taken in), so the monthly Rapport
// can show how this month's 2-year outlook compares to last month's. Only the
// net-worth curve is stored — small, and enough to compare horizons over time.
export interface WealthForecastSnapshot {
  takenForPeriod: string           // monthId this snapshot represents ("now" when taken)
  takenAt: string                  // ISO timestamp
  horizon: number                  // months projected forward
  points: WealthForecastPoint[]    // ascending; points[0] === takenForPeriod (baseline)
}

// ─── Monthly close / reconciliation ritual ───────────────────────────────────

// A record that a month has been reviewed and "closed". Stores a snapshot of the
// outcome totals at close time, so the historical result survives later edits to
// transactions or budgets.
export interface MonthClose {
  monthId: string        // 'YYYY-MM'
  closedAt: string       // ISO timestamp
  note?: string
  income: number         // snapshot of actual totals at close
  expense: number
  savings: number
  net: number
}

// ─── Transfer reconciliation (between owners) ────────────────────────────────

export interface TransferMatch {
  id: string
  txAKey: string          // sender leg (negative amount)
  txBKey: string          // receiver leg (positive amount)
  dateA: string
  dateB: string
  amount: number          // absolute amount in SEK
  ownerA: string
  ownerB: string
  accountAName: string
  accountBName: string
  descriptionA?: string
  descriptionB?: string
  daysDiff: number
  keywordHit: boolean
}

export interface ReconciliationRecord {
  id: string              // = importedAt
  importedAt: string
  matches: TransferMatch[]
}

// ─── Zlantar category mapping ─────────────────────────────────────────────────

export interface ZlantarCategoryRule {
  id: string
  zlantarCategory: string      // Zlantar category value, e.g. 'salary', 'food'
  zlantarSubcategory?: string  // optional: only match this specific subcategory
  appCategoryId: string        // target app category
  appSubcategoryId?: string    // target app subcategory (if omitted, keeps Zlantar's)
}

// ─── Grocery receipt parsing ──────────────────────────────────────────────────

export type GroceryCategory =
  | 'frukt_gront'
  | 'mejeri_agg'
  | 'kott_chark'
  | 'fisk'
  | 'brod_bageri'
  | 'torrvaror'
  | 'frys'
  | 'dryck'
  | 'godis_snacks'
  | 'hushall'
  | 'hygien'
  | 'ovrigt'

export const GROCERY_CATEGORY_LABELS: Record<GroceryCategory, string> = {
  frukt_gront:  'Frukt & grönt',
  mejeri_agg:   'Mejeri & ägg',
  kott_chark:   'Kött & chark',
  fisk:         'Fisk & skaldjur',
  brod_bageri:  'Bröd & bageri',
  torrvaror:    'Torrvaror & skafferi',
  frys:         'Frysvaror',
  dryck:        'Dryck',
  godis_snacks: 'Godis & snacks',
  hushall:      'Hushåll & städ',
  hygien:       'Hygien & skönhet',
  ovrigt:       'Övrigt',
}

export interface GroceryReceiptItem {
  name: string
  amount: number        // negative (cost in SEK)
  category: GroceryCategory
}

export interface MatchedTransaction {
  date: string
  description: string
  amount: number
  transactionId?: string   // txKey of the linked transaction (see transferReconciliation.txKey)
}

export interface GroceryReceipt {
  id: string
  fileName: string
  date: string          // 'YYYY-MM-DD'
  merchant: string
  total: number         // negative
  items: GroceryReceiptItem[]
  parsedAt: string
  matchedTransaction?: MatchedTransaction
}

// ─── App settings ─────────────────────────────────────────────────────────────

export interface AppSettings {
  currency: string
  defaultView: 'monthly' | 'yearly' | 'liquidity'
  fiscalYearStart: number   // month 1-12
  monthStartDay: number           // 1-28, day the period month begins
  monthStartBusinessDay: boolean  // if true, use the weekday on or before monthStartDay
  // Salary anchoring: pin each period's start to the date salary actually landed
  // that month, instead of the fixed monthStartDay. monthStartDay then acts as the
  // expected day (window centre + fallback when no salary is detected).
  salaryAnchoredMonths?: boolean        // default false; when on, periods start at detected salary
  salaryDetectionWindowDays?: number    // ± days around monthStartDay to search (default 6)
  salaryMinAmount?: number              // min positive amount to count as salary (default 5000)
  salaryAmountTolerancePct?: number     // ± band around a recurring amount, e.g. 20 (default 20)
  salaryMinRecurringMonths?: number     // months an amount must recur in to count (default 2)
  categories: CategoryDef[]
  accounts: Account[]
  recurringItems: RecurringItem[]
  zlantarCategoryRules: ZlantarCategoryRule[]
  anthropicApiKey?: string
  anthropicModel?: string
  // Used as an extra keyword when matching swish/bank-transfers between owners.
  partnerName?: string
}

// Per-transaction category override, keyed by txKey (date|amount|description|
// account_number). Takes precedence over the Zlantar rule/direct mapping.
export interface TxOverride {
  categoryId: string
  subcategoryId?: string
  level3Id?: string
}

// ─── Import conflict ─────────────────────────────────────────────────────────

// A transaction that already exists in allTransactions but looks different in a
// new import file (e.g. Zlantar retroactively changed its category). Stored so
// subsequent imports can identify which conflicts have already been seen before.
export interface TxConflict {
  txKey: string
  label: string                 // human-readable: "2025-03-15 · -450 kr · Matvaror"
  storedCategory?: string       // raw Zlantar category in allTransactions
  storedSubcategory?: string
  storedType: string
  incomingCategory?: string     // raw Zlantar category in the new file
  incomingSubcategory?: string
  incomingType: string
  firstSeenAt: string           // ISO timestamp of the first import that flagged this
}

// ─── Complete app state ───────────────────────────────────────────────────────

export interface AppState {
  settings: AppSettings
  // Rolling budget model (current source of truth, edited in Plan + Flöde).
  budgetBaseline: BudgetBaseline
  budgetOverrides: Record<string, Record<string, number>>  // monthId → categoryId → signed amount
  // Frozen per-category budget for ELAPSED months — monthId → categoryId → signed amount.
  // Once a period rolls into the past its effective plan is snapshotted here, so later
  // baseline edits never rewrite history. Captures the latest adjustment automatically;
  // no month-close ritual is required. budgetedAmount reads this after overrides/legacy
  // monthly but before the rolling baseline. See store: freezeElapsedBudgets.
  budgetHistory: Record<string, Record<string, number>>
  planGrid?: PlanGridConfig                                // visible rows/columns of the Plan grid
  // Legacy budget tables — kept for history/Excel fallback; no longer edited in the UI.
  monthlyBudgets: Record<string, MonthlyBudget>    // key: 'YYYY-MM'
  yearlyBudgets: Record<string, YearlyBudget>       // key: 'YYYY'
  actuals: Record<string, MonthlyActuals>           // key: 'YYYY-MM'
  liquidityPlans: Record<string, LiquidityPlan>    // key: 'YYYY'
  groceryReceipts: GroceryReceipt[]
  allTransactions: ZlantarTransaction[]
  transactionOverrides: Record<string, TxOverride> // key: txKey
  lastZlantarImport?: ZlantarImport
  importSnapshots: ImportSnapshot[]
  reconciliations: ReconciliationRecord[]
  importConflicts: TxConflict[]
  monthCloses: Record<string, MonthClose>          // key: 'YYYY-MM'
  // Monthly snapshots of the forward net-worth projection, so the Rapport can show
  // this month's 2-year outlook against last month's. Keyed by the period taken in.
  wealthForecasts: Record<string, WealthForecastSnapshot>   // key: takenForPeriod 'YYYY-MM'
}
