import { useMemo, useState } from 'react'
import { Search, X, SlidersHorizontal, ArrowDownUp } from 'lucide-react'
import { useAppStore } from '@/store'
import { Layout, PageHeader } from '@/components/layout/Layout'
import { formatCurrency } from '@/utils/budgetHelpers'
import { txKey } from '@/utils/transferReconciliation'
import { DEFAULT_ZLANTAR_RULES } from '@/store/defaultCategories'
import { Select } from '@/components/ui/Select'
import type { ZlantarCategoryRule, TxOverride, ZlantarTransaction } from '@/types'

// ─── Local helpers (mirrors Transactions.tsx) ─────────────────────────────────

type RuleTarget = { appCategoryId: string; appSubcategoryId?: string }

function buildRuleLookup(rules: ZlantarCategoryRule[]): Map<string, RuleTarget> {
  const map = new Map<string, RuleTarget>()
  for (const r of rules) {
    if (r.appCategoryId) {
      const key = r.zlantarSubcategory ? `${r.zlantarCategory}|||${r.zlantarSubcategory}` : r.zlantarCategory
      map.set(key, { appCategoryId: r.appCategoryId, appSubcategoryId: r.appSubcategoryId })
    }
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
  if (override) return { catId: override.categoryId, subId: override.subcategoryId ?? '' }
  if (!rawCat) return { catId: 'other', subId: '' }
  const exactMatch = rawSub ? ruleMap.get(`${rawCat}|||${rawSub}`) : undefined
  if (exactMatch) return { catId: exactMatch.appCategoryId, subId: exactMatch.appSubcategoryId ?? rawSub }
  const catMatch = ruleMap.get(rawCat)
  if (catMatch) return { catId: catMatch.appCategoryId, subId: catMatch.appSubcategoryId !== undefined ? catMatch.appSubcategoryId : rawSub }
  if (catIds.has(rawCat)) return { catId: rawCat, subId: rawSub }
  return { catId: 'other', subId: rawSub }
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface ResolvedTx {
  tx: ZlantarTransaction
  catId: string
  subId: string
}

type SortField = 'date' | 'amount' | 'description' | 'account'
type SortDir = 'asc' | 'desc'

const TX_TYPE_LABELS: Record<string, string> = {
  expense: 'Utgift',
  income: 'Inkomst',
  savings: 'Sparande',
  transfer: 'Överföring',
}

const AMOUNT_COLOR: Record<string, string> = {
  income: 'text-emerald-600',
  savings: 'text-blue-600',
  transfer: 'text-gray-500',
  expense: 'text-red-600',
}

const MONTH_LABELS = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec']

function formatDate(dateStr: string): string {
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return dateStr
  return `${d.getDate()} ${MONTH_LABELS[d.getMonth()]} ${d.getFullYear()}`
}

function monthLabel(dateStr: string): string {
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return ''
  return `${MONTH_LABELS[d.getMonth()].charAt(0).toUpperCase()}${MONTH_LABELS[d.getMonth()].slice(1)} ${d.getFullYear()}`
}

function monthKey(dateStr: string): string {
  return dateStr.slice(0, 7) // 'YYYY-MM'
}

// ─── Component ────────────────────────────────────────────────────────────────

export function TransactionListView() {
  const { settings, allTransactions, transactionOverrides } = useAppStore()
  const { categories, zlantarCategoryRules, accounts } = settings

  // ── Filter state ──────────────────────────────────────────────────────────
  const [search, setSearch] = useState('')
  const [accountFilter, setAccountFilter] = useState('')
  const [txTypeFilter, setTxTypeFilter] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [minAmt, setMinAmt] = useState('')
  const [maxAmt, setMaxAmt] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [sortField, setSortField] = useState<SortField>('date')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [showAdvanced, setShowAdvanced] = useState(false)

  // ── Derived lookups ───────────────────────────────────────────────────────
  const ruleMap = useMemo(
    () => buildRuleLookup(zlantarCategoryRules ?? DEFAULT_ZLANTAR_RULES),
    [zlantarCategoryRules]
  )
  const catIds = useMemo(() => new Set(categories.map((c) => c.id)), [categories])

  // ── Account options (from settings + any unknown in transactions) ─────────
  const accountOptions = useMemo(() => {
    const seen = new Map<string, string>()
    for (const acc of accounts) seen.set(acc.id, acc.name)
    for (const tx of allTransactions) {
      if (!seen.has(tx.account_number)) seen.set(tx.account_number, tx.account_name)
    }
    return Array.from(seen.entries())
      .sort((a, b) => a[1].localeCompare(b[1], 'sv'))
      .map(([value, label]) => ({ value, label }))
  }, [accounts, allTransactions])

  // ── Category options ──────────────────────────────────────────────────────
  const categoryOptions = useMemo(
    () =>
      categories.map((c) => ({ value: c.id, label: c.name })).sort((a, b) => a.label.localeCompare(b.label, 'sv')),
    [categories]
  )

  // ── Filtered + resolved + sorted transactions ─────────────────────────────
  const resolved = useMemo<ResolvedTx[]>(() => {
    const searchLower = search.trim().toLowerCase()
    const minNum = minAmt !== '' ? parseFloat(minAmt) : null
    const maxNum = maxAmt !== '' ? parseFloat(maxAmt) : null

    const out: ResolvedTx[] = []
    for (const tx of allTransactions) {
      if (!tx.date) continue
      if (accountFilter && tx.account_number !== accountFilter) continue
      if (txTypeFilter && tx.transaction_type !== txTypeFilter) continue
      if (dateFrom && tx.date < dateFrom) continue
      if (dateTo && tx.date > dateTo) continue
      if (searchLower) {
        const hay = `${tx.description ?? ''} ${tx.account_name ?? ''}`.toLowerCase()
        if (!hay.includes(searchLower)) continue
      }
      const abs = Math.abs(tx.amount)
      if (minNum !== null && abs < minNum) continue
      if (maxNum !== null && abs > maxNum) continue

      const key = txKey(tx)
      const { catId, subId } = resolveCategory(
        tx.category ?? '',
        tx.subcategory ?? '',
        catIds,
        ruleMap,
        transactionOverrides[key]
      )
      if (categoryFilter && catId !== categoryFilter) continue
      out.push({ tx, catId, subId })
    }

    out.sort((a, b) => {
      let cmp = 0
      if (sortField === 'date') cmp = a.tx.date.localeCompare(b.tx.date)
      else if (sortField === 'amount') cmp = Math.abs(a.tx.amount) - Math.abs(b.tx.amount)
      else if (sortField === 'description') cmp = (a.tx.description ?? '').localeCompare(b.tx.description ?? '', 'sv')
      else if (sortField === 'account') cmp = (a.tx.account_name ?? '').localeCompare(b.tx.account_name ?? '', 'sv')
      return sortDir === 'desc' ? -cmp : cmp
    })

    return out
  }, [allTransactions, transactionOverrides, search, accountFilter, txTypeFilter, categoryFilter, minAmt, maxAmt, dateFrom, dateTo, ruleMap, catIds, sortField, sortDir])

  // ── Summary stats ─────────────────────────────────────────────────────────
  const summary = useMemo(() => {
    const income = resolved.filter((r) => r.tx.transaction_type === 'income').reduce((s, r) => s + r.tx.amount, 0)
    const expense = resolved.filter((r) => r.tx.transaction_type === 'expense').reduce((s, r) => s + r.tx.amount, 0)
    return { count: resolved.length, income, expense, net: income + expense }
  }, [resolved])

  // ── Active filter count ───────────────────────────────────────────────────
  const activeFilters = [search, accountFilter, txTypeFilter, categoryFilter, minAmt, maxAmt, dateFrom, dateTo].filter(Boolean).length

  function clearAll() {
    setSearch('')
    setAccountFilter('')
    setTxTypeFilter('')
    setCategoryFilter('')
    setMinAmt('')
    setMaxAmt('')
    setDateFrom('')
    setDateTo('')
  }

  function toggleSort(field: SortField) {
    if (sortField === field) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortField(field); setSortDir('desc') }
  }

  function SortIcon({ field }: { field: SortField }) {
    if (sortField !== field) return <ArrowDownUp className="w-3 h-3 text-gray-300 ml-1" />
    return (
      <ArrowDownUp className={`w-3 h-3 ml-1 ${sortDir === 'desc' ? 'text-brand-500' : 'text-brand-500 rotate-180'} transition-transform`} />
    )
  }

  // ── Month-grouped rows ────────────────────────────────────────────────────
  const rows = useMemo(() => {
    type Row = { type: 'month'; label: string; count: number; total: number } | { type: 'tx'; item: ResolvedTx }
    const out: Row[] = []
    let currentMonth = ''
    let monthItems: ResolvedTx[] = []

    function flush() {
      if (!currentMonth || monthItems.length === 0) return
      out.push({
        type: 'month',
        label: monthLabel(monthItems[0].tx.date),
        count: monthItems.length,
        total: monthItems.reduce((s, r) => s + r.tx.amount, 0),
      })
      for (const item of monthItems) out.push({ type: 'tx', item })
    }

    for (const item of resolved) {
      const mk = monthKey(item.tx.date)
      if (mk !== currentMonth) {
        flush()
        currentMonth = mk
        monthItems = [item]
      } else {
        monthItems.push(item)
      }
    }
    flush()
    return out
  }, [resolved])

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <Layout>
      <PageHeader title="Transaktioner" subtitle={`${summary.count} transaktioner`} />

      {/* ── Filter panel ── */}
      <div className="bg-white border border-gray-200 rounded-2xl p-4 mb-6 space-y-3">
        {/* Row 1: search + quick filters */}
        <div className="flex flex-wrap gap-2 items-center">
          {/* Search */}
          <div className="relative flex-1 min-w-52">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Sök beskrivning eller konto…"
              className="w-full pl-9 pr-8 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Account */}
          <Select
            value={accountFilter}
            onChange={(e) => setAccountFilter(e.target.value)}
            options={accountOptions}
            placeholder="Alla konton"
            className="w-48"
          />

          {/* Type */}
          <Select
            value={txTypeFilter}
            onChange={(e) => setTxTypeFilter(e.target.value)}
            options={Object.entries(TX_TYPE_LABELS).map(([value, label]) => ({ value, label }))}
            placeholder="Alla typer"
            className="w-40"
          />

          {/* Toggle advanced */}
          <button
            onClick={() => setShowAdvanced((v) => !v)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors
              ${showAdvanced ? 'bg-brand-50 border-brand-200 text-brand-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}
          >
            <SlidersHorizontal className="w-4 h-4" />
            Mer filter
            {activeFilters > 0 && !showAdvanced && (
              <span className="ml-1 bg-brand-500 text-white text-[10px] font-semibold rounded-full px-1.5 py-0.5 leading-none">
                {activeFilters}
              </span>
            )}
          </button>

          {activeFilters > 0 && (
            <button onClick={clearAll} className="flex items-center gap-1 text-sm text-gray-400 hover:text-gray-700 transition-colors">
              <X className="w-3.5 h-3.5" />
              Rensa
            </button>
          )}
        </div>

        {/* Row 2: advanced filters */}
        {showAdvanced && (
          <div className="flex flex-wrap gap-2 items-center pt-1 border-t border-gray-100">
            {/* Date from */}
            <div className="flex items-center gap-1.5 text-sm text-gray-500">
              <span className="shrink-0">Från</span>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>
            {/* Date to */}
            <div className="flex items-center gap-1.5 text-sm text-gray-500">
              <span className="shrink-0">Till</span>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>

            {/* Amount range */}
            <div className="flex items-center gap-1.5 text-sm text-gray-500">
              <span className="shrink-0">Belopp</span>
              <input
                type="number"
                value={minAmt}
                onChange={(e) => setMinAmt(e.target.value)}
                placeholder="Min"
                min="0"
                className="w-24 border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
              <span className="text-gray-400">–</span>
              <input
                type="number"
                value={maxAmt}
                onChange={(e) => setMaxAmt(e.target.value)}
                placeholder="Max"
                min="0"
                className="w-24 border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
              <span className="text-gray-400 text-xs">kr (abs)</span>
            </div>

            {/* Category */}
            <Select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              options={categoryOptions}
              placeholder="Alla kategorier"
              className="w-48"
            />
          </div>
        )}
      </div>

      {/* ── Summary strip ── */}
      {resolved.length > 0 && (
        <div className="flex gap-6 text-sm text-gray-500 mb-4 px-1">
          <span>
            <span className="font-medium text-gray-700">{summary.count}</span> transaktioner
          </span>
          {summary.income !== 0 && (
            <span>
              In: <span className="font-medium text-emerald-600">{formatCurrency(summary.income)}</span>
            </span>
          )}
          {summary.expense !== 0 && (
            <span>
              Ut: <span className="font-medium text-red-600">{formatCurrency(Math.abs(summary.expense))}</span>
            </span>
          )}
          {summary.income !== 0 && summary.expense !== 0 && (
            <span>
              Netto:{' '}
              <span className={`font-medium ${summary.net >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                {formatCurrency(summary.net)}
              </span>
            </span>
          )}
        </div>
      )}

      {/* ── Table ── */}
      {resolved.length === 0 ? (
        <div className="text-center py-20 text-gray-400 text-sm">
          {allTransactions.length === 0
            ? 'Inga transaktioner importerade ännu.'
            : 'Inga transaktioner matchar filtret.'}
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
          {/* Column headers */}
          <div className="grid grid-cols-[auto_1fr_auto_auto_auto] gap-x-4 px-4 py-2.5 border-b border-gray-100 bg-gray-50 text-xs font-medium text-gray-500 uppercase tracking-wide">
            <button onClick={() => toggleSort('date')} className="flex items-center text-left hover:text-gray-700 transition-colors whitespace-nowrap">
              Datum <SortIcon field="date" />
            </button>
            <button onClick={() => toggleSort('description')} className="flex items-center text-left hover:text-gray-700 transition-colors">
              Beskrivning <SortIcon field="description" />
            </button>
            <button onClick={() => toggleSort('account')} className="flex items-center text-left hover:text-gray-700 transition-colors whitespace-nowrap">
              Konto <SortIcon field="account" />
            </button>
            <span>Kategori</span>
            <button onClick={() => toggleSort('amount')} className="flex items-center justify-end hover:text-gray-700 transition-colors whitespace-nowrap">
              Belopp <SortIcon field="amount" />
            </button>
          </div>

          {/* Rows */}
          <div className="divide-y divide-gray-50">
            {rows.map((row, i) => {
              if (row.type === 'month') {
                return (
                  <div
                    key={`month-${i}`}
                    className="grid grid-cols-[auto_1fr_auto_auto_auto] gap-x-4 px-4 py-2 bg-warm-50 border-y border-warm-200"
                  >
                    <span className="text-xs font-semibold text-gray-600 col-span-4">{row.label}</span>
                    <span className={`text-xs font-semibold text-right ${row.total >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                      {formatCurrency(row.total, true)}
                    </span>
                  </div>
                )
              }

              const { tx, catId, subId } = row.item
              const cat = categories.find((c) => c.id === catId)
              const sub = cat?.subcategories.find((s) => s.id === subId)
              const amtColor = AMOUNT_COLOR[tx.transaction_type] ?? 'text-gray-700'
              const key = txKey(tx)

              return (
                <div
                  key={key}
                  className="grid grid-cols-[auto_1fr_auto_auto_auto] gap-x-4 px-4 py-2.5 hover:bg-gray-50 transition-colors items-center"
                >
                  {/* Date */}
                  <span className="text-xs text-gray-400 tabular-nums whitespace-nowrap w-24">
                    {formatDate(tx.date)}
                  </span>

                  {/* Description */}
                  <span className="text-sm text-gray-800 truncate" title={tx.description}>
                    {tx.description || <span className="text-gray-400 italic">–</span>}
                  </span>

                  {/* Account */}
                  <span className="text-xs text-gray-400 truncate max-w-32 text-right" title={tx.account_name}>
                    {tx.account_name}
                  </span>

                  {/* Category */}
                  <span className="text-xs text-gray-400 truncate max-w-36">
                    {cat ? (
                      <>
                        {cat.name}
                        {sub && <span className="text-gray-300"> / {sub.name}</span>}
                      </>
                    ) : (
                      <span className="italic">–</span>
                    )}
                  </span>

                  {/* Amount */}
                  <span className={`text-sm font-medium tabular-nums text-right ${amtColor}`}>
                    {formatCurrency(tx.amount, true)}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </Layout>
  )
}
