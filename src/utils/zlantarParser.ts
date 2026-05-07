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
  ZlantarCategoryRule,
} from '@/types'
import { AGREEMENT_CATEGORY_MAP, DEFAULT_ZLANTAR_RULES } from '@/store/defaultCategories'

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

// ─── Rule lookup helpers ──────────────────────────────────────────────────────

type RuleTarget = { appCategoryId: string; appSubcategoryId?: string }

function buildRuleLookup(rules: ZlantarCategoryRule[]): Map<string, RuleTarget> {
  const map = new Map<string, RuleTarget>()
  for (const r of rules) {
    // More-specific rules (with zlantarSubcategory) stored under a compound key;
    // category-only rules stored under just the category.
    const key = r.zlantarSubcategory
      ? `${r.zlantarCategory}|||${r.zlantarSubcategory}`
      : r.zlantarCategory
    map.set(key, { appCategoryId: r.appCategoryId, appSubcategoryId: r.appSubcategoryId })
  }
  return map
}

function resolveCategory(
  rawCat: string,
  rawSub: string,
  catIds: Set<string>,
  ruleMap: Map<string, RuleTarget>
): { catId: string; subId: string } {
  if (!rawCat) return { catId: 'other', subId: '' }

  // Exact match: category + subcategory
  const exactMatch = rawSub ? ruleMap.get(`${rawCat}|||${rawSub}`) : undefined
  if (exactMatch) {
    return {
      catId: exactMatch.appCategoryId,
      subId: exactMatch.appSubcategoryId ?? rawSub,
    }
  }

  // Category-only rule match
  const catMatch = ruleMap.get(rawCat)
  if (catMatch) {
    return {
      catId: catMatch.appCategoryId,
      // If rule specifies a subcategory, use it; otherwise preserve the original
      subId: catMatch.appSubcategoryId !== undefined ? catMatch.appSubcategoryId : rawSub,
    }
  }

  // No rule — use as-is if catId is a known app category, else fall back
  if (catIds.has(rawCat)) return { catId: rawCat, subId: rawSub }
  return { catId: 'other', subId: rawSub }
}

// ─── Build monthly actuals grouped by YYYY-MM ────────────────────────────────

export function buildMonthlyActuals(
  imp: ZlantarImport,
  categories: CategoryDef[],
  rules: ZlantarCategoryRule[] = DEFAULT_ZLANTAR_RULES
): Record<string, MonthlyActuals> {
  const { transactions, data } = imp

  const catIds = new Set(categories.map((c) => c.id))
  const ruleMap = buildRuleLookup(rules)

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
      const { catId, subId } = resolveCategory(
        tx.category ?? '',
        tx.subcategory ?? '',
        catIds,
        ruleMap
      )
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
  categories: CategoryDef[],
  rules: ZlantarCategoryRule[] = DEFAULT_ZLANTAR_RULES
): UnknownCategory[] {
  const catIds = new Set(categories.map((c) => c.id))
  const ruleMap = buildRuleLookup(rules)
  const result: Record<string, UnknownCategory> = {}

  for (const tx of transactions) {
    if (!tx.category || tx.transaction_type === 'transfer') continue
    const rawCat = tx.category
    const rawSub = tx.subcategory ?? ''
    // A category is "unknown" only if neither a rule nor a direct ID match handles it
    const coveredByRule = ruleMap.has(`${rawCat}|||${rawSub}`) || ruleMap.has(rawCat)
    if (!catIds.has(rawCat) && !coveredByRule) {
      const key = `${rawCat}|||${rawSub}`
      if (!result[key]) {
        result[key] = { rawCategory: rawCat, rawSubcategory: tx.subcategory, count: 0, totalAmount: 0 }
      }
      result[key].count++
      result[key].totalAmount += tx.amount
    }
  }

  return Object.values(result).sort((a, b) => b.count - a.count)
}

// ─── Get individual transactions for a category/month ────────────────────────

export function getTransactionsForCategory(
  transactions: ZlantarTransaction[],
  monthId: string,
  catId: string,
  subId: string | undefined,
  categories: CategoryDef[],
  rules: ZlantarCategoryRule[] = DEFAULT_ZLANTAR_RULES
): ZlantarTransaction[] {
  const catIds = new Set(categories.map((c) => c.id))
  const ruleMap = buildRuleLookup(rules)

  return transactions.filter((tx) => {
    if (!tx.date || tx.date.slice(0, 7) !== monthId) return false
    if (tx.transaction_type === 'transfer') return false
    const { catId: resolvedCat, subId: resolvedSub } = resolveCategory(
      tx.category ?? '',
      tx.subcategory ?? '',
      catIds,
      ruleMap
    )
    if (resolvedCat !== catId) return false
    if (subId !== undefined && resolvedSub !== subId) return false
    return true
  })
}

// ─── Compute starting balance from most recent import ────────────────────────

export interface ComputedStartingBalance {
  balance: number
  importedAt: string   // ISO timestamp of the import snapshot
}

export function computeStartingBalance(
  actuals: Record<string, MonthlyActuals>,
  liquidityAccounts: Account[]
): ComputedStartingBalance | null {
  const entries = Object.values(actuals)
  if (entries.length === 0) return null

  // Find the most recently imported actuals record
  const latest = entries.reduce((a, b) => (a.importedAt > b.importedAt ? a : b))

  const liquidityIds = new Set(liquidityAccounts.filter((a) => a.includeInLiquidity).map((a) => a.id))
  const balance = latest.accountBalances
    .filter((ab) => liquidityIds.has(ab.accountId))
    .reduce((sum, ab) => sum + ab.balance, 0)

  return { balance, importedAt: latest.importedAt }
}
