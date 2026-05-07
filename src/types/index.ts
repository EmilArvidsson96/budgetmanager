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

export interface ZlantarData {
  banks?: ZlantarBank[]
  agreements?: ZlantarAgreement[]
  user?: Record<string, unknown>
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
  color?: string
  icon?: string
}

export interface SubcategoryDef {
  id: string
  name: string
  parentId: string
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
}

export type AccountType =
  | 'checking'
  | 'savings'
  | 'credit'
  | 'loan'
  | 'isk'
  | 'investment'
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
  categories: CategoryDef[]
  accounts: Account[]
  recurringItems: RecurringItem[]
  zlantarCategoryRules: ZlantarCategoryRule[]
  anthropicApiKey?: string
}

// ─── Complete app state ───────────────────────────────────────────────────────

export interface AppState {
  settings: AppSettings
  monthlyBudgets: Record<string, MonthlyBudget>    // key: 'YYYY-MM'
  yearlyBudgets: Record<string, YearlyBudget>       // key: 'YYYY'
  actuals: Record<string, MonthlyActuals>           // key: 'YYYY-MM'
  liquidityPlans: Record<string, LiquidityPlan>    // key: 'YYYY'
  groceryReceipts: GroceryReceipt[]
  allTransactions: ZlantarTransaction[]
  lastZlantarImport?: ZlantarImport
}
