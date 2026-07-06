import type {
  ZlantarData,
  ZlantarRawAccount,
  ZlantarTransaction,
  ZlantarImport,
  ImportSnapshot,
  MonthlyActuals,
  ActualEntry,
  AccountBalance,
  AccountType,
  Account,
  RecurringItem,
  CategoryDef,
  ZlantarCategoryRule,
  TxOverride,
} from '@/types'
import { AGREEMENT_CATEGORY_MAP, DEFAULT_ZLANTAR_RULES } from '@/store/defaultCategories'
import { getMonthIdForDate, bucketKindForCategory, type SalaryPeriodConfig } from '@/utils/periodUtils'
import { txKey as makeTxKey } from '@/utils/transferReconciliation'

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

export function extractOwner(data: ZlantarData): string | undefined {
  const v = data.user?.first_name
  return typeof v === 'string' && v.trim() ? v.trim() : undefined
}

// The ONE id scheme for accounts coming out of a Zlantar export. Without an
// account number the fallback must include the owner: two owners can each have
// a "Sparkonto", and a name-only id would make their balances overwrite each
// other on every import. deriveAccounts and buildAccountBalances both use this
// so a balance always finds its account.
export function zlantarAccountId(acc: ZlantarRawAccount, owner: string | undefined): string {
  return acc.account_number || [acc.name, owner].filter(Boolean).join('_')
}

export function deriveAccounts(data: ZlantarData): Account[] {
  const owner = extractOwner(data)
  const result: Account[] = []
  for (const bank of data.banks ?? []) {
    for (const acc of bank.accounts ?? []) {
      const id = zlantarAccountId(acc, owner)
      if (!id) continue
      result.push({
        id,
        name: acc.name,
        type: normalizeAccountType(acc.type),
        bankName: formatBankName(bank.name),
        currency: 'SEK',
        loanBalance: acc.balance < 0 ? Math.abs(acc.balance) : undefined,
        includeInLiquidity: acc.type !== 'Loan',
        owner,
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
  ruleMap: Map<string, RuleTarget>,
  override?: TxOverride
): { catId: string; subId: string } {
  // A user override always wins — this is how re-categorization takes effect.
  if (override) return { catId: override.categoryId, subId: override.subcategoryId ?? '' }

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

// Resolve a single transaction's app category/subcategory, applying overrides,
// rules and direct-id matching (same precedence as the aggregation path).
// Exported so salary detection can classify income without duplicating the rules.
export function resolveTxCategory(
  tx: ZlantarTransaction,
  categories: CategoryDef[],
  rules: ZlantarCategoryRule[] = DEFAULT_ZLANTAR_RULES,
  overrides: Record<string, TxOverride> = {}
): { catId: string; subId: string } {
  const catIds = new Set(categories.map((c) => c.id))
  const ruleMap = buildRuleLookup(rules)
  return resolveCategory(
    tx.category ?? '',
    tx.subcategory ?? '',
    catIds,
    ruleMap,
    overrides[makeTxKey(tx)]
  )
}

// ─── Build monthly actuals grouped by YYYY-MM ────────────────────────────────

// Aggregate one month's transactions into ActualEntry[]. Shared by the import
// build and the per-month recompute that runs after re-categorization, so totals
// and drill-down can never diverge. Transfers and reconciled-out keys are excluded;
// per-transaction overrides (keyed by txKey) take precedence over rule mapping.
export function buildMonthEntries(
  transactions: ZlantarTransaction[],
  monthId: string,
  categories: CategoryDef[],
  rules: ZlantarCategoryRule[] = DEFAULT_ZLANTAR_RULES,
  overrides: Record<string, TxOverride> = {},
  excludeKeys?: Set<string>,
  monthStartDay = 1,
  monthStartBusinessDay = false,
  config?: SalaryPeriodConfig
): ActualEntry[] {
  const catIds = new Set(categories.map((c) => c.id))
  const ruleMap = buildRuleLookup(rules)
  const aggMap: Record<string, ActualEntry> = {}

  for (const tx of transactions) {
    if (!tx.date) continue
    if (tx.transaction_type === 'transfer') continue
    if (excludeKeys && excludeKeys.has(makeTxKey(tx))) continue

    // Resolve first so the period boundary can depend on whether this is listed
    // income (income-cut boundary) vs. everything else (salary-date boundary).
    const { catId, subId } = resolveCategory(
      tx.category ?? '',
      tx.subcategory ?? '',
      catIds,
      ruleMap,
      overrides[makeTxKey(tx)]
    )
    const catDef = categories.find((c) => c.id === catId)
    if (catDef?.type === 'transfer') continue

    const kind = bucketKindForCategory(catId, subId, tx.category ?? '')
    if (getMonthIdForDate(tx.date, monthStartDay, monthStartBusinessDay, config, kind) !== monthId) continue

    const key = `${catId}|||${subId}`

    if (!aggMap[key]) {
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

  return Object.values(aggMap)
}

export function buildMonthlyActuals(
  imp: ZlantarImport,
  categories: CategoryDef[],
  rules: ZlantarCategoryRule[] = DEFAULT_ZLANTAR_RULES,
  monthStartDay = 1,
  monthStartBusinessDay = false,
  excludeKeys?: Set<string>,
  overrides: Record<string, TxOverride> = {},
  config?: SalaryPeriodConfig
): Record<string, MonthlyActuals> {
  const { transactions, data } = imp
  const catIds = new Set(categories.map((c) => c.id))
  const ruleMap = buildRuleLookup(rules)

  // Collect the months present (transfers + reconciled keys excluded). Bucket with
  // the SAME per-tx kind as buildMonthEntries so no boundary tx is orphaned.
  const months = new Set<string>()
  for (const tx of transactions) {
    if (!tx.date || tx.transaction_type === 'transfer') continue
    if (excludeKeys && excludeKeys.has(makeTxKey(tx))) continue
    const { catId, subId } = resolveCategory(tx.category ?? '', tx.subcategory ?? '', catIds, ruleMap, overrides[makeTxKey(tx)])
    const kind = bucketKindForCategory(catId, subId, tx.category ?? '')
    months.add(getMonthIdForDate(tx.date, monthStartDay, monthStartBusinessDay, config, kind))
  }

  const accountBalances = buildAccountBalances(data)
  const result: Record<string, MonthlyActuals> = {}

  for (const ym of months) {
    const [yearStr, monthStr] = ym.split('-')
    result[ym] = {
      id: ym,
      year: parseInt(yearStr),
      month: parseInt(monthStr),
      entries: buildMonthEntries(transactions, ym, categories, rules, overrides, excludeKeys, monthStartDay, monthStartBusinessDay, config),
      accountBalances,
      importedAt: imp.importedAt,
    }
  }

  return result
}

// ─── Account balance snapshot ─────────────────────────────────────────────────

export function buildAccountBalances(data: ZlantarData): AccountBalance[] {
  const owner = extractOwner(data)
  const result: AccountBalance[] = []
  for (const bank of data.banks ?? []) {
    for (const acc of bank.accounts ?? []) {
      const accountId = zlantarAccountId(acc, owner)
      if (!accountId) continue
      result.push({
        accountId,
        accountName: acc.name,
        accountType: normalizeAccountType(acc.type),
        balance: acc.balance,
        currency: 'SEK',
        owner,
      })
    }
  }
  return result
}

// Merge a new set of account balances over a previous snapshot: balances present
// in `next` win, but balances for accounts absent from `next` are carried forward
// from `prev`. This keeps a partial data.json upload (e.g. only one partner's
// banks) from wiping the other accounts' latest known balance from the snapshot.
export function mergeAccountBalances(
  prev: AccountBalance[],
  next: AccountBalance[]
): AccountBalance[] {
  if (next.length === 0) return prev
  const nextIds = new Set(next.map((ab) => ab.accountId))
  const nextNames = new Set(next.map((ab) => ab.accountName))
  return [
    ...next,
    ...prev.filter(
      (ab) =>
        !nextIds.has(ab.accountId) &&
        // Legacy entries were keyed by bare account name (no owner). When the
        // same-named account now arrives under an owner-qualified id, the old
        // entry is a stale duplicate — carrying it forward would double-count.
        !(ab.accountId === ab.accountName && nextNames.has(ab.accountName))
    ),
  ]
}

// ─── Removed-account detection ────────────────────────────────────────────────
//
// A Zlantar export always contains ALL of that owner's current accounts, so an
// account that used to show up in imports but is absent from a new data.json has
// most likely been closed/removed at the bank. The carry-forward merge above
// would otherwise keep its last balance alive forever with no signal.

export interface RemovedAccountCandidate {
  account: Account
  lastKnownBalance: number | null
}

export function findRemovedAccountCandidates(
  data: ZlantarData,
  accounts: Account[],
  latestSnapshot: ImportSnapshot | null
): RemovedAccountCandidate[] {
  const banks = data.banks ?? []
  // A tx-only upload (no banks) says nothing about which accounts still exist.
  if (banks.length === 0 || !latestSnapshot) return []

  const incomingIds = new Set(buildAccountBalances(data).map((ab) => ab.accountId))
  const owner = extractOwner(data)?.toLowerCase()
  const incomingBanks = new Set(banks.map((b) => formatBankName(b.name).toLowerCase()))
  const trackedBalances = new Map(latestSnapshot.accountBalances.map((ab) => [ab.accountId, ab.balance]))

  return accounts
    .filter((a) => {
      if (a.closedAt) return false
      if (incomingIds.has(a.id)) return false
      // Only accounts that imports have actually tracked — manually added ones
      // (e.g. a property) are never in an export and would be flagged forever.
      if (!trackedBalances.has(a.id)) return false
      // Scope to what this upload covers: the exporting owner's accounts when
      // the export names one, otherwise accounts at the banks it contains.
      if (owner) return a.owner?.trim().toLowerCase() === owner
      return a.bankName != null && incomingBanks.has(a.bankName.toLowerCase())
    })
    .map((a) => ({ account: a, lastKnownBalance: trackedBalances.get(a.id) ?? null }))
}

// True when two balance sets describe the same accounts with the same balances.
// Used to skip recording a snapshot when an upload carries no new balance info.
export function accountBalancesEqual(a: AccountBalance[], b: AccountBalance[]): boolean {
  if (a.length !== b.length) return false
  const m = new Map(a.map((x) => [x.accountId, x.balance]))
  for (const y of b) {
    const x = m.get(y.accountId)
    if (x === undefined || Math.abs(x - y.balance) > 0.005) return false
  }
  return true
}

// Per-account comparison of incoming balances against the previous snapshot, for
// surfacing "what changed" in the import preview. `oldBalance` is null for an
// account not seen in the previous snapshot (a brand-new account).
export interface AccountBalanceChange {
  accountId: string
  accountName: string
  accountType: AccountType
  oldBalance: number | null
  newBalance: number
  delta: number
  changed: boolean
}

export function diffAccountBalances(
  prev: AccountBalance[],
  next: AccountBalance[]
): AccountBalanceChange[] {
  const prevMap = new Map(prev.map((ab) => [ab.accountId, ab.balance]))
  return next.map((ab) => {
    const old = prevMap.get(ab.accountId)
    const oldBalance = old === undefined ? null : old
    const changed = oldBalance === null || Math.abs(oldBalance - ab.balance) > 0.005
    return {
      accountId: ab.accountId,
      accountName: ab.accountName,
      accountType: ab.accountType,
      oldBalance,
      newBalance: ab.balance,
      delta: ab.balance - (oldBalance ?? 0),
      changed,
    }
  })
}

// ─── Compare two MonthlyActuals records for equivalent transaction data ─────
// Ignores accountBalances (snapshot metadata) and importedAt (timestamp).

export function actualsEquivalent(a: MonthlyActuals, b: MonthlyActuals): boolean {
  if (a.entries.length !== b.entries.length) return false
  const key = (e: ActualEntry) => `${e.categoryId}|${e.subcategoryId ?? ''}`
  const map = new Map(a.entries.map((e) => [key(e), e]))
  for (const e of b.entries) {
    const m = map.get(key(e))
    if (!m) return false
    if (Math.abs(m.totalAmount - e.totalAmount) > 0.005) return false
    if (m.transactionCount !== e.transactionCount) return false
  }
  return true
}

// ─── Report categories that came in but aren't mapped ────────────────────────

export interface UnknownCategory {
  rawCategory: string
  rawSubcategory?: string
  count: number
  totalAmount: number
  suggestedName: string                       // proposed Swedish name for a new category
  suggestedType: CategoryDef['type']
}

// Curated Swedish names for known raw Zlantar values that have no app category.
// Keeps suggestions proper Swedish (no Swenglish) instead of echoing the raw id.
const RAW_CATEGORY_SUGGESTIONS: Record<string, { name: string; type: CategoryDef['type'] }> = {
  subsidy:  { name: 'Bidrag & stöd',      type: 'income' },
  account:  { name: 'Kontosparande',      type: 'savings' },
  salary:   { name: 'Lön',                type: 'income' },
  interest: { name: 'Räntor & utdelning', type: 'income' },
  refund:   { name: 'Återbetalningar',    type: 'income' },
  sale:     { name: 'Försäljning',        type: 'income' },
}

function prettifyRaw(raw: string): string {
  const cleaned = raw.replace(/[_\-/]+/g, ' ').trim()
  if (!cleaned) return 'Ny kategori'
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1)
}

export function suggestCategoryName(rawCat: string): { name: string; type: CategoryDef['type'] } {
  return RAW_CATEGORY_SUGGESTIONS[rawCat] ?? { name: prettifyRaw(rawCat), type: 'expense' }
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
        const suggestion = suggestCategoryName(rawCat)
        result[key] = {
          rawCategory: rawCat,
          rawSubcategory: tx.subcategory,
          count: 0,
          totalAmount: 0,
          suggestedName: suggestion.name,
          suggestedType: suggestion.type,
        }
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
  rules: ZlantarCategoryRule[] = DEFAULT_ZLANTAR_RULES,
  monthStartDay = 1,
  monthStartBusinessDay = false,
  excludeKeys?: Set<string>,
  overrides: Record<string, TxOverride> = {},
  config?: SalaryPeriodConfig
): ZlantarTransaction[] {
  const catIds = new Set(categories.map((c) => c.id))
  const ruleMap = buildRuleLookup(rules)

  return transactions.filter((tx) => {
    if (!tx.date) return false
    if (tx.transaction_type === 'transfer') return false
    if (excludeKeys && excludeKeys.has(makeTxKey(tx))) return false
    const { catId: resolvedCat, subId: resolvedSub } = resolveCategory(
      tx.category ?? '',
      tx.subcategory ?? '',
      catIds,
      ruleMap,
      overrides[makeTxKey(tx)]
    )
    if (resolvedCat !== catId) return false
    if (subId !== undefined && resolvedSub !== subId) return false
    const kind = bucketKindForCategory(resolvedCat, resolvedSub, tx.category ?? '')
    if (getMonthIdForDate(tx.date, monthStartDay, monthStartBusinessDay, config, kind) !== monthId) return false
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
