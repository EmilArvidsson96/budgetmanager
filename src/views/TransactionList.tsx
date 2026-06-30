import { useEffect, useMemo, useRef, useState } from 'react'
import { Search, X, SlidersHorizontal, ArrowDownUp, Pencil, RotateCcw, ArrowLeftRight } from 'lucide-react'
import { useAppStore } from '@/store'
import { Layout, PageHeader } from '@/components/layout/Layout'
import { formatCurrency } from '@/utils/budgetHelpers'
import { txKey } from '@/utils/transferReconciliation'
import { DEFAULT_ZLANTAR_RULES } from '@/store/defaultCategories'
import { Select } from '@/components/ui/Select'
import { Button } from '@/components/ui/Button'
import type { CategoryDef, ZlantarCategoryRule, ZlantarTransaction, TxOverride } from '@/types'

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
  return dateStr.slice(0, 7)
}

// ─── CategoryPicker (inline re-categorization) ────────────────────────────────

type CategoryOption = { label: string; catId: string; subId?: string; level3Id?: string }

function CategoryPicker({
  categories, currentCatId, currentSubId, currentLevel3Id, canReset, onPick, onReset, onCancel,
}: {
  categories: CategoryDef[]
  currentCatId: string
  currentSubId?: string
  currentLevel3Id?: string
  canReset: boolean
  onPick: (catId: string, subId?: string, level3Id?: string) => void
  onReset: () => void
  onCancel: () => void
}) {
  const [catId, setCatId] = useState(currentCatId)
  const [subId, setSubId] = useState(currentSubId ?? '')
  const [level3Id, setLevel3Id] = useState(currentLevel3Id ?? '')
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const options = useMemo<CategoryOption[]>(() => {
    const result: CategoryOption[] = []
    for (const cat of categories) {
      result.push({ label: cat.name, catId: cat.id })
      for (const sub of cat.subcategories) {
        result.push({ label: `${cat.name} / ${sub.name}`, catId: cat.id, subId: sub.id })
        for (const l3 of (cat.level3 ?? []).filter((l) => l.parentSubId === sub.id)) {
          result.push({ label: `${cat.name} / ${sub.name} / ${l3.name}`, catId: cat.id, subId: sub.id, level3Id: l3.id })
        }
      }
    }
    return result
  }, [categories])

  const selectedCat = categories.find((c) => c.id === catId)
  const selectedSub = selectedCat?.subcategories.find((s) => s.id === subId)
  const selectedL3 = (selectedCat?.level3 ?? []).find((l) => l.id === level3Id)
  const currentLabel = [selectedCat?.name, selectedSub?.name, selectedL3?.name].filter(Boolean).join(' / ')

  const filtered = query ? options.filter((o) => o.label.toLowerCase().includes(query.toLowerCase())) : options

  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
        setQuery('')
      }
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [])

  function pick(opt: CategoryOption) {
    setCatId(opt.catId)
    setSubId(opt.subId ?? '')
    setLevel3Id(opt.level3Id ?? '')
    setOpen(false)
    setQuery('')
  }

  return (
    <div className="col-span-full px-4 pb-3 pt-1 flex flex-wrap items-center gap-2 bg-warm-50 border-b border-warm-200">
      <div ref={containerRef} className="relative">
        <input
          className="border border-gray-200 rounded-md px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 w-64"
          value={open ? query : currentLabel}
          placeholder="Sök kategori…"
          onFocus={() => { setOpen(true); setQuery('') }}
          onChange={(e) => { setQuery(e.target.value); setOpen(true) }}
        />
        {open && filtered.length > 0 && (
          <div className="absolute z-50 top-full mt-1 left-0 w-80 max-h-64 overflow-y-auto bg-white border border-gray-200 rounded-lg shadow-xl">
            {filtered.map((opt, i) => (
              <button
                key={i}
                className="w-full text-left px-3 py-1.5 text-sm hover:bg-brand-50 hover:text-brand-700 transition-colors"
                onMouseDown={() => pick(opt)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        )}
      </div>
      <Button size="sm" onClick={() => onPick(catId, subId || undefined, level3Id || undefined)}>
        Spara
      </Button>
      <Button size="sm" variant="secondary" onClick={() => onPick('transfer')}>
        <ArrowLeftRight className="w-3.5 h-3.5" /> Överföring
      </Button>
      {canReset && (
        <Button size="sm" variant="secondary" onClick={onReset}>
          <RotateCcw className="w-3.5 h-3.5" /> Återställ
        </Button>
      )}
      <button onClick={onCancel} className="text-xs text-gray-400 hover:text-gray-600 ml-1 transition-colors">
        Avbryt
      </button>
    </div>
  )
}

// ─── Transaction row ──────────────────────────────────────────────────────────

function TxRow({ item, categories }: { item: ResolvedTx; categories: CategoryDef[] }) {
  const store = useAppStore()
  const [editing, setEditing] = useState(false)
  const { tx, catId, subId } = item
  const key = txKey(tx)
  const override = store.transactionOverrides[key]
  const cat = categories.find((c) => c.id === catId)
  const sub = cat?.subcategories.find((s) => s.id === subId)
  const amtColor = AMOUNT_COLOR[tx.transaction_type] ?? 'text-gray-700'

  return (
    <>
      {/* Main row */}
      <div
        className={`grid grid-cols-[6rem_1fr_8rem_9rem_6rem_2rem] gap-x-4 px-4 py-2.5 items-center transition-colors
          ${editing ? 'bg-warm-50' : 'hover:bg-gray-50'}`}
      >
        {/* Date */}
        <span className="text-xs text-gray-400 tabular-nums whitespace-nowrap">
          {formatDate(tx.date)}
        </span>

        {/* Description */}
        <span className="text-sm text-gray-800 truncate flex items-center gap-1.5 min-w-0" title={tx.description}>
          <span className="truncate">{tx.description || <span className="text-gray-400 italic">–</span>}</span>
          {override && <span title="Omkategoriserad" className="w-1.5 h-1.5 rounded-full bg-brand-500 shrink-0" />}
        </span>

        {/* Account */}
        <span className="text-xs text-gray-400 truncate text-right" title={tx.account_name}>
          {tx.account_name}
        </span>

        {/* Category */}
        <span className="text-xs text-gray-500 truncate">
          {cat ? (
            <>
              {cat.name}
              {sub && <span className="text-gray-300"> / {sub.name}</span>}
            </>
          ) : (
            <span className="italic text-gray-300">–</span>
          )}
        </span>

        {/* Amount */}
        <span className={`text-sm font-medium tabular-nums text-right ${amtColor}`}>
          {formatCurrency(tx.amount, true)}
        </span>

        {/* Edit button */}
        <button
          onClick={() => setEditing((v) => !v)}
          title="Ändra kategori"
          className={`flex items-center justify-center w-6 h-6 rounded transition-colors
            ${editing ? 'text-brand-600 bg-brand-50' : 'text-gray-300 hover:text-brand-500 hover:bg-gray-100'}`}
        >
          <Pencil className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Inline picker */}
      {editing && (
        <div className="grid grid-cols-1 divide-y-0">
          <CategoryPicker
            categories={categories}
            currentCatId={catId}
            currentSubId={subId}
            currentLevel3Id={override?.level3Id}
            canReset={!!override}
            onPick={(c, s, l3) => {
              store.setTransactionOverride(key, { categoryId: c, subcategoryId: s, level3Id: l3 })
              setEditing(false)
            }}
            onReset={() => { store.clearTransactionOverride(key); setEditing(false) }}
            onCancel={() => setEditing(false)}
          />
        </div>
      )}
    </>
  )
}

// ─── Main view ────────────────────────────────────────────────────────────────

export function TransactionListView() {
  const { settings, allTransactions, transactionOverrides } = useAppStore()
  const { categories, zlantarCategoryRules, accounts } = settings

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

  const ruleMap = useMemo(
    () => buildRuleLookup(zlantarCategoryRules ?? DEFAULT_ZLANTAR_RULES),
    [zlantarCategoryRules]
  )
  const catIds = useMemo(() => new Set(categories.map((c) => c.id)), [categories])

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

  const categoryOptions = useMemo(
    () => categories.map((c) => ({ value: c.id, label: c.name })).sort((a, b) => a.label.localeCompare(b.label, 'sv')),
    [categories]
  )

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

  const summary = useMemo(() => {
    const income = resolved.filter((r) => r.tx.transaction_type === 'income').reduce((s, r) => s + r.tx.amount, 0)
    const expense = resolved.filter((r) => r.tx.transaction_type === 'expense').reduce((s, r) => s + r.tx.amount, 0)
    return { count: resolved.length, income, expense, net: income + expense }
  }, [resolved])

  const activeFilters = [search, accountFilter, txTypeFilter, categoryFilter, minAmt, maxAmt, dateFrom, dateTo].filter(Boolean).length

  function clearAll() {
    setSearch(''); setAccountFilter(''); setTxTypeFilter(''); setCategoryFilter('')
    setMinAmt(''); setMaxAmt(''); setDateFrom(''); setDateTo('')
  }

  function toggleSort(field: SortField) {
    if (sortField === field) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortField(field); setSortDir('desc') }
  }

  function SortIcon({ field }: { field: SortField }) {
    if (sortField !== field) return <ArrowDownUp className="w-3 h-3 text-gray-300 ml-1" />
    return <ArrowDownUp className={`w-3 h-3 ml-1 text-brand-500 ${sortDir === 'asc' ? 'rotate-180' : ''} transition-transform`} />
  }

  // Group into month-header + tx rows
  const rows = useMemo(() => {
    type Row = { type: 'month'; label: string; total: number } | { type: 'tx'; item: ResolvedTx }
    const out: Row[] = []
    let currentMonth = ''
    let monthItems: ResolvedTx[] = []

    function flush() {
      if (!currentMonth || monthItems.length === 0) return
      out.push({ type: 'month', label: monthLabel(monthItems[0].tx.date), total: monthItems.reduce((s, r) => s + r.tx.amount, 0) })
      for (const item of monthItems) out.push({ type: 'tx', item })
    }

    for (const item of resolved) {
      const mk = monthKey(item.tx.date)
      if (mk !== currentMonth) { flush(); currentMonth = mk; monthItems = [item] }
      else monthItems.push(item)
    }
    flush()
    return out
  }, [resolved])

  return (
    <Layout>
      <PageHeader title="Transaktioner" subtitle={`${summary.count} transaktioner`} />

      {/* ── Filter panel ── */}
      <div className="bg-white border border-gray-200 rounded-2xl p-4 mb-6 space-y-3">
        <div className="flex flex-wrap gap-2 items-center">
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
          <Select value={accountFilter} onChange={(e) => setAccountFilter(e.target.value)} options={accountOptions} placeholder="Alla konton" className="w-48" />
          <Select value={txTypeFilter} onChange={(e) => setTxTypeFilter(e.target.value)} options={Object.entries(TX_TYPE_LABELS).map(([value, label]) => ({ value, label }))} placeholder="Alla typer" className="w-40" />
          <button
            onClick={() => setShowAdvanced((v) => !v)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors
              ${showAdvanced ? 'bg-brand-50 border-brand-200 text-brand-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}
          >
            <SlidersHorizontal className="w-4 h-4" />
            Mer filter
            {activeFilters > 0 && !showAdvanced && (
              <span className="ml-1 bg-brand-500 text-white text-[10px] font-semibold rounded-full px-1.5 py-0.5 leading-none">{activeFilters}</span>
            )}
          </button>
          {activeFilters > 0 && (
            <button onClick={clearAll} className="flex items-center gap-1 text-sm text-gray-400 hover:text-gray-700 transition-colors">
              <X className="w-3.5 h-3.5" /> Rensa
            </button>
          )}
        </div>

        {showAdvanced && (
          <div className="flex flex-wrap gap-2 items-center pt-1 border-t border-gray-100">
            <div className="flex items-center gap-1.5 text-sm text-gray-500">
              <span className="shrink-0">Från</span>
              <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
            </div>
            <div className="flex items-center gap-1.5 text-sm text-gray-500">
              <span className="shrink-0">Till</span>
              <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
            </div>
            <div className="flex items-center gap-1.5 text-sm text-gray-500">
              <span className="shrink-0">Belopp</span>
              <input type="number" value={minAmt} onChange={(e) => setMinAmt(e.target.value)} placeholder="Min" min="0" className="w-24 border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
              <span className="text-gray-400">–</span>
              <input type="number" value={maxAmt} onChange={(e) => setMaxAmt(e.target.value)} placeholder="Max" min="0" className="w-24 border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
              <span className="text-gray-400 text-xs">kr (abs)</span>
            </div>
            <Select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} options={categoryOptions} placeholder="Alla kategorier" className="w-48" />
          </div>
        )}
      </div>

      {/* ── Summary strip ── */}
      {resolved.length > 0 && (
        <div className="flex gap-6 text-sm text-gray-500 mb-4 px-1">
          <span><span className="font-medium text-gray-700">{summary.count}</span> transaktioner</span>
          {summary.income !== 0 && <span>In: <span className="font-medium text-emerald-600">{formatCurrency(summary.income)}</span></span>}
          {summary.expense !== 0 && <span>Ut: <span className="font-medium text-red-600">{formatCurrency(Math.abs(summary.expense))}</span></span>}
          {summary.income !== 0 && summary.expense !== 0 && (
            <span>Netto: <span className={`font-medium ${summary.net >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{formatCurrency(summary.net)}</span></span>
          )}
        </div>
      )}

      {/* ── Table ── */}
      {resolved.length === 0 ? (
        <div className="text-center py-20 text-gray-400 text-sm">
          {allTransactions.length === 0 ? 'Inga transaktioner importerade ännu.' : 'Inga transaktioner matchar filtret.'}
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
          {/* Column headers — 6 cols matching TxRow */}
          <div className="grid grid-cols-[6rem_1fr_8rem_9rem_6rem_2rem] gap-x-4 px-4 py-2.5 border-b border-gray-100 bg-gray-50 text-xs font-medium text-gray-500 uppercase tracking-wide">
            <button onClick={() => toggleSort('date')} className="flex items-center text-left hover:text-gray-700 transition-colors whitespace-nowrap">
              Datum <SortIcon field="date" />
            </button>
            <button onClick={() => toggleSort('description')} className="flex items-center text-left hover:text-gray-700 transition-colors">
              Beskrivning <SortIcon field="description" />
            </button>
            <button onClick={() => toggleSort('account')} className="flex items-center justify-end hover:text-gray-700 transition-colors whitespace-nowrap">
              Konto <SortIcon field="account" />
            </button>
            <span>Kategori</span>
            <button onClick={() => toggleSort('amount')} className="flex items-center justify-end hover:text-gray-700 transition-colors whitespace-nowrap">
              Belopp <SortIcon field="amount" />
            </button>
            <span />
          </div>

          {/* Rows */}
          <div className="divide-y divide-gray-50">
            {rows.map((row, i) => {
              if (row.type === 'month') {
                return (
                  <div key={`month-${i}`} className="grid grid-cols-[6rem_1fr_8rem_9rem_6rem_2rem] gap-x-4 px-4 py-2 bg-warm-50 border-y border-warm-200">
                    <span className="text-xs font-semibold text-gray-600 col-span-5">{row.label}</span>
                    <span className={`text-xs font-semibold text-right ${row.total >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                      {formatCurrency(row.total, true)}
                    </span>
                  </div>
                )
              }
              return <TxRow key={txKey(row.item.tx)} item={row.item} categories={categories} />
            })}
          </div>
        </div>
      )}
    </Layout>
  )
}
