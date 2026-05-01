import type {
  ZlantarData,
  ZlantarTransaction,
  ZlantarImport,
  MonthlyActuals,
  ActualEntry,
  AccountBalance,
  AccountType,
  Account,
  CategoryDef,
} from '@/types'

// ─── Parse raw JSON files ─────────────────────────────────────────────────────

export function parseZlantarFiles(
  dataJson: unknown,
  transactionsJson: unknown
): ZlantarImport {
  const data = (dataJson ?? {}) as ZlantarData
  const raw = transactionsJson

  // transactions.json may be wrapped in an object or be a bare array
  let txList: ZlantarTransaction[] = []
  if (Array.isArray(raw)) {
    txList = raw as ZlantarTransaction[]
  } else if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>
    const key = Object.keys(obj).find((k) =>
      Array.isArray(obj[k]) && (obj[k] as unknown[]).length > 0
    )
    if (key) txList = obj[key] as ZlantarTransaction[]
  }

  const dates = txList
    .map((t) => t.date)
    .filter(Boolean)
    .sort()

  const yearMonth =
    dates.length > 0
      ? dates[0].slice(0, 7)
      : undefined

  return {
    data,
    transactions: txList,
    importedAt: new Date().toISOString(),
    yearMonth,
  }
}

// ─── Derive accounts from data.json ──────────────────────────────────────────

export function deriveAccounts(data: ZlantarData): Account[] {
  const rawAccounts = data.accounts ?? []
  return rawAccounts.map((a) => ({
    id: a.id,
    name: a.name,
    type: normalizeAccountType(a.type),
    bankName: a.bankName,
    currency: a.currency ?? 'SEK',
    interestRate: a.interestRate,
    loanBalance: a.loanAmount,
    loanOriginalAmount: a.loanOriginalAmount,
    includeInLiquidity: true,
  }))
}

function normalizeAccountType(raw?: string): AccountType {
  const s = (raw ?? '').toLowerCase()
  if (s.includes('loan') || s.includes('lån') || s.includes('kredit_lan')) return 'loan'
  if (s.includes('credit') || s.includes('kreditkort')) return 'credit'
  if (s.includes('saving') || s.includes('spar')) return 'savings'
  if (s.includes('isk')) return 'isk'
  if (s.includes('invest') || s.includes('depot') || s.includes('fond')) return 'investment'
  if (s.includes('check') || s.includes('privat') || s.includes('lön')) return 'checking'
  return 'other'
}

// ─── Build monthly actuals per YYYY-MM ───────────────────────────────────────

export function buildMonthlyActuals(
  imp: ZlantarImport,
  categories: CategoryDef[]
): Record<string, MonthlyActuals> {
  const { transactions, data } = imp

  // Group transactions by YYYY-MM
  const byMonth: Record<string, ZlantarTransaction[]> = {}
  for (const tx of transactions) {
    if (!tx.date) continue
    const key = tx.date.slice(0, 7)
    if (!byMonth[key]) byMonth[key] = []
    byMonth[key].push(tx)
  }

  const accountBalances = buildAccountBalances(data)
  const catMap = buildCategoryMap(categories)

  const result: Record<string, MonthlyActuals> = {}

  for (const [ym, txs] of Object.entries(byMonth)) {
    const [yearStr, monthStr] = ym.split('-')
    const year = parseInt(yearStr)
    const month = parseInt(monthStr)

    // Aggregate by category + subcategory
    const aggMap: Record<string, ActualEntry> = {}

    for (const tx of txs) {
      const key = `${tx.category ?? 'ovrigt'}|||${tx.subcategory ?? ''}`
      if (!aggMap[key]) {
        const { catId, catName, subId, subName } = resolveCategoryIds(
          tx.category,
          tx.subcategory,
          catMap
        )
        aggMap[key] = {
          categoryId: catId,
          categoryName: catName,
          subcategoryId: subId || undefined,
          subcategoryName: subName || undefined,
          totalAmount: 0,
          transactionCount: 0,
        }
      }
      aggMap[key].totalAmount += tx.amount ?? 0
      aggMap[key].transactionCount += 1
    }

    result[ym] = {
      id: ym,
      year,
      month,
      entries: Object.values(aggMap),
      accountBalances,
      importedAt: imp.importedAt,
    }
  }

  return result
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildAccountBalances(data: ZlantarData): AccountBalance[] {
  return (data.accounts ?? []).map((a) => ({
    accountId: a.id,
    accountName: a.name,
    accountType: normalizeAccountType(a.type),
    balance: a.balance ?? 0,
    currency: a.currency ?? 'SEK',
  }))
}

type CatMap = Map<string, { id: string; name: string; subMap: Map<string, { id: string; name: string }> }>

function buildCategoryMap(categories: CategoryDef[]): CatMap {
  const map: CatMap = new Map()
  for (const cat of categories) {
    const subMap = new Map<string, { id: string; name: string }>()
    for (const sub of cat.subcategories) {
      subMap.set(normalizeKey(sub.name), { id: sub.id, name: sub.name })
    }
    map.set(normalizeKey(cat.name), { id: cat.id, name: cat.name, subMap })
  }
  return map
}

function normalizeKey(s: string): string {
  return s.toLowerCase().replace(/[åä]/g, 'a').replace(/ö/g, 'o').replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
}

function resolveCategoryIds(
  rawCat?: string,
  rawSub?: string,
  catMap?: CatMap
): { catId: string; catName: string; subId: string; subName: string } {
  if (!catMap || !rawCat) {
    return { catId: 'ovrigt', catName: rawCat ?? 'Övrigt', subId: rawSub ?? '', subName: rawSub ?? '' }
  }

  const catKey = normalizeKey(rawCat)
  let match = catMap.get(catKey)

  if (!match) {
    // fuzzy: find first key that contains or is contained in catKey
    for (const [k, v] of catMap.entries()) {
      if (catKey.includes(k) || k.includes(catKey)) {
        match = v
        break
      }
    }
  }

  if (!match) {
    return { catId: normalizeKey(rawCat), catName: rawCat, subId: rawSub ?? '', subName: rawSub ?? '' }
  }

  const subKey = rawSub ? normalizeKey(rawSub) : ''
  let subMatch = subKey ? match.subMap.get(subKey) : undefined
  if (!subMatch && subKey) {
    for (const [k, v] of match.subMap.entries()) {
      if (subKey.includes(k) || k.includes(subKey)) {
        subMatch = v
        break
      }
    }
  }

  return {
    catId: match.id,
    catName: match.name,
    subId: subMatch?.id ?? subKey,
    subName: subMatch?.name ?? rawSub ?? '',
  }
}

// ─── Discover unknown categories from import ─────────────────────────────────

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
  const catMap = buildCategoryMap(categories)
  const knownIds = new Set(categories.map((c) => c.id))
  const result: Record<string, UnknownCategory> = {}

  for (const tx of transactions) {
    if (!tx.category) continue
    const { catId } = resolveCategoryIds(tx.category, tx.subcategory, catMap)
    if (!knownIds.has(catId)) {
      const key = `${tx.category}|||${tx.subcategory ?? ''}`
      if (!result[key]) {
        result[key] = {
          rawCategory: tx.category,
          rawSubcategory: tx.subcategory,
          count: 0,
          totalAmount: 0,
        }
      }
      result[key].count++
      result[key].totalAmount += tx.amount ?? 0
    }
  }

  return Object.values(result).sort((a, b) => b.count - a.count)
}
