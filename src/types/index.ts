// ─── Zlantar import types ────────────────────────────────────────────────────

export interface ZlantarAccount {
  id: string
  name: string
  type: string           // 'checking' | 'savings' | 'credit' | 'loan' | 'isk' | 'investment' | ...
  bankName?: string
  balance?: number
  currency?: string
  interestRate?: number
  loanAmount?: number
  loanOriginalAmount?: number
  accountNumber?: string
}

export interface ZlantarAgreement {
  id: string
  name: string
  amount: number
  currency?: string
  category?: string
  subcategory?: string
  accountId?: string
  nextDate?: string
  intervalDays?: number
  active?: boolean
}

export interface ZlantarBudget {
  id?: string
  category: string
  subcategory?: string
  amount: number
  period?: string
}

export interface ZlantarTransaction {
  id: string
  date: string
  amount: number
  currency?: string
  description?: string
  name?: string
  category?: string
  subcategory?: string
  accountId?: string
  accountName?: string
  type?: string          // 'expense' | 'income' | 'transfer' | 'loan_payment' | ...
  note?: string
  tags?: string[]
}

export interface ZlantarData {
  accounts?: ZlantarAccount[]
  agreements?: ZlantarAgreement[]
  budgets?: ZlantarBudget[]
  user?: Record<string, unknown>
  properties?: unknown[]
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
  notes?: string
}

// ─── App settings ─────────────────────────────────────────────────────────────

export interface AppSettings {
  currency: string
  defaultView: 'monthly' | 'yearly' | 'liquidity'
  fiscalYearStart: number   // month 1-12
  categories: CategoryDef[]
  accounts: Account[]
  recurringItems: RecurringItem[]
}

// ─── Complete app state ───────────────────────────────────────────────────────

export interface AppState {
  settings: AppSettings
  monthlyBudgets: Record<string, MonthlyBudget>    // key: 'YYYY-MM'
  yearlyBudgets: Record<string, YearlyBudget>       // key: 'YYYY'
  actuals: Record<string, MonthlyActuals>           // key: 'YYYY-MM'
  liquidityPlans: Record<string, LiquidityPlan>    // key: 'YYYY'
  lastZlantarImport?: ZlantarImport
}
