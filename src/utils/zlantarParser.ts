import type {
  ZlantarData,
  ZlantarTransaction,
  ZlantarImport,
  MonthlyActuals,
  ActualEntry,
  AccountBalance,
  AccountType,
  Account,
  RecurringItem,
  CategoryDef,
} from '@/types'
import { AGREEMENT_CATEGORY_MAP } from '@/store/defaultCategories'

// ─── Parse raw JSON files ─────────────────────────────────────────────────────

export function parseZlantarFiles(
  dataJson: unknown,
  transactionsJson: unknown
): ZlantarImport {
  const data = (dataJson ?? {}) as ZlantarData

  // transactions.json is a bare array
  let txList: ZlantarTransaction[] = []
  if (Array.isArray(transactionsJson)) {
    txList = transactionsJson as ZlantarTransaction[]
  } else if (transactionsJson && typeof transactionsJson === 'object') {
    const obj = transactionsJson as Record<string, unknown>
    const key = Object.keys(obj).find((k) => Array.isArray(obj[k]))
    if (key) txList = obj[key] as ZlantarTransaction[]
  }

  const dates = txList.map((t) => t.date).filter(Boolean).sort()

  return {
    data,
    transactions: txList,
    importedAt: new Date().toISOString(),
    yearMonth: dates.length > 0 ? dates[0].slice(0, 7) : undefined,
  }
}

// ─── Derive accounts from data.json banks array ───────────────────────────────

export function deriveAccounts(data: ZlantarData): Account[] {
  const result: Account[] = []
  for (const bank of data.banks ?? []) {
    for (const acc of bank.accounts ?? []) {
      result.push({
        id: `${bank.name}_${acc.account_index}`,
        name: acc.name,
        type: normalizeAccountType(acc.type),
        bankName: formatBankName(bank.name),
        currency: 'SEK',
        loanBalance: acc.balance < 0 ? Math.abs(acc.balance) : undefined,
        includeInLiquidity: acc.type !== 'Loan',
      })
    }
  }
  return result
}

function formatBankName(raw: string): string {
  const MAP: Record<string, string> = {
    lansforsakringar: 'Länsförsäkringar',
    sj: 'SJ',
    ziklo: 'Ziklo / Carpay',
    swedbank: 'Swedbank',
    nordea: 'Nordea',
    seb: 'SEB',
    handelsbanken: 'Handelsbanken',
    icabanken: 'ICA Banken',
  }
  return MAP[raw.toLowerCase()] ?? raw
}

function normalizeAccountType(raw: string): AccountType {
  switch (raw) {
    case 'Loan':          return 'loan'
    case 'Credit':        return 'credit'
    case 'Savings':       return 'savings'
    case 'Transactional': return 'checking'
    default:              return 'other'
  }
}

// ─── Derive recurring items from Zlantar agreements ──────────────────────────

export function deriveRecurringItems(data: ZlantarData): RecurringItem[] {
  const items: RecurringItem[] = []

  for (const ag of data.agreements ?? []) {
    const mapKey = `${ag.agreement_type}/${ag.agreement_subtype}`
    const catRef = AGREEMENT_CATEGORY_MAP[mapKey] ?? { categoryId: 'other', subcategoryId: 'other' }
    const company = ag.companies?.[0] ?? ag.agreement_type

    // Convert frequency to monthly amount
    let monthlyAmount = ag.amount
    switch (ag.frequency) {
      case 'quarterly':          monthlyAmount = ag.amount / 3;  break
      case 'yearly':             monthlyAmount = ag.amount / 12; break
      case 'every_other_month':  monthlyAmount = ag.amount / 2;  break
    }

    items.push({
      id: `agreement_${company.replace(/\s+/g, '_').toLowerCase()}`,
      name: company,
      amount: Math.round(monthlyAmount * 100) / 100,
      categoryId: catRef.categoryId,
      subcategoryId: catRef.subcategoryId,
      type: 'expense',
    })
  }

  return items
}

// ─── Build monthly actuals grouped by YYYY-MM ────────────────────────────────

export function buildMonthlyActuals(
  imp: ZlantarImport,
  categories: CategoryDef[]
): Record<string, MonthlyActuals> {
  const { transactions, data } = imp

  // Pre-build category lookup: catId → Set<subId>
  const catIds = new Set(categories.map((c) => c.id))

  // Group by YYYY-MM, skipping transfers (no category)
  const byMonth: Record<string, ZlantarTransaction[]> = {}
  for (const tx of transactions) {
    if (!tx.date) continue
    if (tx.transaction_type === 'transfer') continue  // internal account transfers, skip
    const key = tx.date.slice(0, 7)
    if (!byMonth[key]) byMonth[key] = []
    byMonth[key].push(tx)
  }

  const accountBalances = buildAccountBalances(data)
  const result: Record<string, MonthlyActuals> = {}

  for (const [ym, txs] of Object.entries(byMonth)) {
    const [yearStr, monthStr] = ym.split('-')

    // Aggregate by category + subcategory (direct key lookup — no fuzzy matching needed)
    const aggMap: Record<string, ActualEntry> = {}

    for (const tx of txs) {
      const catId = tx.category && catIds.has(tx.category) ? tx.category : 'other'
      const subId = tx.subcategory ?? ''
      const key = `${catId}|||${subId}`

      if (!aggMap[key]) {
        const catDef = categories.find((c) => c.id === catId)
        const subDef = catDef?.subcategories.find((s) => s.id === subId)
        aggMap[key] = {
          categoryId: catId,
          categoryName: catDef?.name ?? catId,
          subcategoryId: subId || undefined,
          subcategoryName: subDef?.name ?? (subId || undefined),
          totalAmount: 0,
          transactionCount: 0,
        }
      }
      aggMap[key].totalAmount += tx.amount
      aggMap[key].transactionCount += 1
    }

    result[ym] = {
      id: ym,
      year: parseInt(yearStr),
      month: parseInt(monthStr),
      entries: Object.values(aggMap),
      accountBalances,
      importedAt: imp.importedAt,
    }
  }

  return result
}

// ─── Account balance snapshot ─────────────────────────────────────────────────

function buildAccountBalances(data: ZlantarData): AccountBalance[] {
  const result: AccountBalance[] = []
  for (const bank of data.banks ?? []) {
    for (const acc of bank.accounts ?? []) {
      result.push({
        accountId: `${bank.name}_${acc.account_index}`,
        accountName: acc.name,
        accountType: normalizeAccountType(acc.type),
        balance: acc.balance,
        currency: 'SEK',
      })
    }
  }
  return result
}

// ─── Report categories that came in but aren't mapped ────────────────────────

export interface UnknownCategory {
  rawCategory: string
  rawSubcategory?: string
  count: number
  totalAmount: number
}

export function findUnknownCategories(
  transactions: ZlantarTransaction[],
  categories: CategoryDef[]
): UnknownCategory[] {
  const catIds = new Set(categories.map((c) => c.id))
  const result: Record<string, UnknownCategory> = {}

  for (const tx of transactions) {
    if (!tx.category || tx.transaction_type === 'transfer') continue
    if (!catIds.has(tx.category)) {
      const key = `${tx.category}|||${tx.subcategory ?? ''}`
      if (!result[key]) {
        result[key] = { rawCategory: tx.category, rawSubcategory: tx.subcategory, count: 0, totalAmount: 0 }
      }
      result[key].count++
      result[key].totalAmount += tx.amount
    }
  }

  return Object.values(result).sort((a, b) => b.count - a.count)
}
