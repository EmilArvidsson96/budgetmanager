import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Search, X, Pencil, RotateCcw } from 'lucide-react'
import {
  PieChart, Pie, Cell,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import { useAppStore } from '@/store'
import { Layout, PageHeader } from '@/components/layout/Layout'
import { Card, CardHeader } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import {
  MONTH_NAMES_LONG,
  MONTH_NAMES_SHORT,
  makeMonthId,
  formatCurrency,
} from '@/utils/budgetHelpers'
import { getMonthIdForDate } from '@/utils/periodUtils'
import { DEFAULT_ZLANTAR_RULES } from '@/store/defaultCategories'
import { txKey } from '@/utils/transferReconciliation'
import { GROCERY_CATEGORY_LABELS } from '@/types'
import type {
  CategoryDef,
  ZlantarTransaction,
  ZlantarCategoryRule,
  TxOverride,
  GroceryReceipt,
  GroceryCategory,
} from '@/types'

type RuleTarget = { appCategoryId: string; appSubcategoryId?: string }

function buildRuleLookup(rules: ZlantarCategoryRule[]): Map<string, RuleTarget> {
  const map = new Map<string, RuleTarget>()
  for (const r of rules) {
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
  // A user override always wins — this is how per-transaction re-categorization takes effect.
  if (override) return { catId: override.categoryId, subId: override.subcategoryId ?? '' }

  if (!rawCat) return { catId: 'other', subId: '' }

  const exactMatch = rawSub ? ruleMap.get(`${rawCat}|||${rawSub}`) : undefined
  if (exactMatch) {
    return {
      catId: exactMatch.appCategoryId,
      subId: exactMatch.appSubcategoryId ?? rawSub,
    }
  }

  const catMatch = ruleMap.get(rawCat)
  if (catMatch) {
    return {
      catId: catMatch.appCategoryId,
      subId: catMatch.appSubcategoryId !== undefined ? catMatch.appSubcategoryId : rawSub,
    }
  }

  if (catIds.has(rawCat)) return { catId: rawCat, subId: rawSub }
  return { catId: 'other', subId: rawSub }
}

interface ResolvedTx {
  tx: ZlantarTransaction
  catId: string
  subId: string
}

interface SubGroup {
  subId: string
  subName: string
  total: number
  transactions: ResolvedTx[]
}

interface CatGroup {
  cat: CategoryDef
  total: number
  count: number
  subgroups: SubGroup[]
  uncategorized: ResolvedTx[]
}

interface DonutSlice {
  catId: string
  name: string
  value: number
  color: string
}

interface TrendDatum {
  monthId: string
  label: string
  [categoryId: string]: string | number
}

export function TransactionsView() {
  const today = new Date()
  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth() + 1)
  const [expandedCats, setExpandedCats] = useState<Set<string>>(new Set())
  const [expandedSubs, setExpandedSubs] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')
  const [view, setView] = useState<'categories' | 'transfers'>('categories')

  const { settings, allTransactions, transactionOverrides, groceryReceipts } = useAppStore()
  const { categories, zlantarCategoryRules, monthStartDay, monthStartBusinessDay } = settings

  const monthId = makeMonthId(year, month)

  const prevMonth = () => {
    if (month === 1) { setMonth(12); setYear((y) => y - 1) }
    else setMonth((m) => m - 1)
  }
  const nextMonth = () => {
    if (month === 12) { setMonth(1); setYear((y) => y + 1) }
    else setMonth((m) => m + 1)
  }

  const groups = useMemo<CatGroup[]>(() => {
    const catIds = new Set(categories.map((c) => c.id))
    const ruleMap = buildRuleLookup(zlantarCategoryRules ?? DEFAULT_ZLANTAR_RULES)
    const searchLower = search.trim().toLowerCase()

    const monthTxs: ResolvedTx[] = []
    for (const tx of allTransactions) {
      if (!tx.date) continue
      if (tx.transaction_type === 'transfer') continue
      if (getMonthIdForDate(tx.date, monthStartDay, monthStartBusinessDay) !== monthId) continue
      if (searchLower) {
        const hay = `${tx.description ?? ''} ${tx.account_name ?? ''}`.toLowerCase()
        if (!hay.includes(searchLower)) continue
      }
      const { catId, subId } = resolveCategory(
        tx.category ?? '',
        tx.subcategory ?? '',
        catIds,
        ruleMap,
        transactionOverrides[txKey(tx)]
      )
      monthTxs.push({ tx, catId, subId })
    }

    return categories
      .map<CatGroup>((cat) => {
        const catTxs = monthTxs.filter((t) => t.catId === cat.id)
        const subMap = new Map<string, SubGroup>()
        const uncategorized: ResolvedTx[] = []

        for (const t of catTxs) {
          const subDef = cat.subcategories.find((s) => s.id === t.subId)
          if (!subDef) {
            uncategorized.push(t)
            continue
          }
          let group = subMap.get(subDef.id)
          if (!group) {
            group = { subId: subDef.id, subName: subDef.name, total: 0, transactions: [] }
            subMap.set(subDef.id, group)
          }
          group.total += t.tx.amount
          group.transactions.push(t)
        }

        const subgroups = cat.subcategories
          .map((s) => subMap.get(s.id))
          .filter((g): g is SubGroup => !!g)

        const total = catTxs.reduce((s, t) => s + t.tx.amount, 0)
        return {
          cat,
          total,
          count: catTxs.length,
          subgroups,
          uncategorized,
        }
      })
      .filter((g) => g.count > 0)
  }, [allTransactions, transactionOverrides, categories, zlantarCategoryRules, monthId, monthStartDay, monthStartBusinessDay, search])

  // Transfers for the selected month (own-account transfers — excluded from budget
  // totals; surfaced here so you can see what was moved).
  const transfers = useMemo(() => {
    const searchLower = search.trim().toLowerCase()
    return allTransactions
      .filter((tx) => {
        if (tx.transaction_type !== 'transfer' || !tx.date) return false
        if (getMonthIdForDate(tx.date, monthStartDay, monthStartBusinessDay) !== monthId) return false
        if (searchLower) {
          const hay = `${tx.description ?? ''} ${tx.account_name ?? ''}`.toLowerCase()
          if (!hay.includes(searchLower)) return false
        }
        return true
      })
      .sort((a, b) => b.date.localeCompare(a.date))
  }, [allTransactions, monthId, monthStartDay, monthStartBusinessDay, search])
  const transferTotal = transfers.reduce((s, t) => s + t.amount, 0)

  const grandTotal = groups.reduce((s, g) => s + g.total, 0)
  const grandCount = groups.reduce((s, g) => s + g.count, 0)

  // Donut: spending share by expense category for the selected month.
  const donutData = useMemo<DonutSlice[]>(() => {
    return groups
      .filter((g) => g.cat.type === 'expense')
      .map((g) => ({
        catId: g.cat.id,
        name: g.cat.name,
        value: Math.abs(g.total),
        color: g.cat.color ?? '#94a3b8',
      }))
      .filter((d) => d.value > 0)
      .sort((a, b) => b.value - a.value)
  }, [groups])
  const donutTotal = donutData.reduce((s, d) => s + d.value, 0)

  // Stacked bar: last 6 months of expense by category (respects search/month-start config).
  const trendData = useMemo<TrendDatum[]>(() => {
    const catIds = new Set(categories.map((c) => c.id))
    const ruleMap = buildRuleLookup(zlantarCategoryRules ?? DEFAULT_ZLANTAR_RULES)
    const searchLower = search.trim().toLowerCase()

    const monthIds: string[] = []
    for (let i = 5; i >= 0; i--) {
      let m = month - i
      let y = year
      while (m <= 0) { m += 12; y-- }
      monthIds.push(makeMonthId(y, m))
    }
    const monthSet = new Set(monthIds)
    const expenseCats = categories.filter((c) => c.type === 'expense')
    const expenseIds = new Set(expenseCats.map((c) => c.id))

    const buckets: Record<string, Record<string, number>> = {}
    for (const id of monthIds) buckets[id] = {}

    for (const tx of allTransactions) {
      if (!tx.date || tx.transaction_type === 'transfer') continue
      const mid = getMonthIdForDate(tx.date, monthStartDay, monthStartBusinessDay)
      if (!monthSet.has(mid)) continue
      if (searchLower) {
        const hay = `${tx.description ?? ''} ${tx.account_name ?? ''}`.toLowerCase()
        if (!hay.includes(searchLower)) continue
      }
      const { catId } = resolveCategory(
        tx.category ?? '',
        tx.subcategory ?? '',
        catIds,
        ruleMap,
        transactionOverrides[txKey(tx)]
      )
      if (!expenseIds.has(catId)) continue
      buckets[mid][catId] = (buckets[mid][catId] ?? 0) + Math.abs(tx.amount)
    }

    return monthIds.map((id) => {
      const [yStr, mStr] = id.split('-')
      const mNum = parseInt(mStr)
      const yNum = parseInt(yStr)
      const row: TrendDatum = {
        monthId: id,
        label: `${MONTH_NAMES_SHORT[mNum - 1]} ${String(yNum).slice(2)}`,
      }
      for (const cat of expenseCats) {
        row[cat.id] = buckets[id][cat.id] ?? 0
      }
      return row
    })
  }, [allTransactions, transactionOverrides, categories, zlantarCategoryRules, year, month, monthStartDay, monthStartBusinessDay, search])

  const expenseCategories = useMemo(
    () => categories.filter((c) => c.type === 'expense'),
    [categories]
  )
  const trendHasData = trendData.some((d) =>
    expenseCategories.some((c) => (d[c.id] as number) > 0)
  )

  const toggleCat = (id: string) => {
    setExpandedCats((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  const toggleSub = (key: string) => {
    setExpandedSubs((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return (
    <Layout>
      <PageHeader
        title="Transaktioner"
        subtitle="Bläddra alla transaktioner per kategori, underkategori och månad."
      />

      {/* Month navigator */}
      <div className="flex items-center gap-1 mb-6">
        <button
          onClick={prevMonth}
          className="p-2 rounded-lg hover:bg-gray-100 transition-colors text-gray-400 hover:text-gray-700"
          aria-label="Föregående månad"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <span className="text-base font-medium text-gray-800 min-w-44 text-center tabular-nums">
          {MONTH_NAMES_LONG[month - 1]} {year}
        </span>
        <button
          onClick={nextMonth}
          className="p-2 rounded-lg hover:bg-gray-100 transition-colors text-gray-400 hover:text-gray-700"
          aria-label="Nästa månad"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {/* Search */}
      <div className="relative mb-6">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-300" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Sök i beskrivning eller konto"
          className="w-full pl-9 pr-9 py-2 text-sm rounded-lg border border-warm-300 bg-white focus:outline-none focus:border-brand-400 transition-colors"
        />
        {search && (
          <button
            onClick={() => setSearch('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 text-gray-300 hover:text-gray-500"
            aria-label="Rensa sök"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* View toggle: categories tree vs transfers */}
      <div className="inline-flex rounded-lg border border-warm-300 bg-white p-0.5 mb-6">
        {([['categories', 'Kategorier'], ['transfers', 'Överföringar']] as const).map(([v, label]) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
              view === v ? 'bg-brand-500 text-white font-medium' : 'text-gray-500 hover:text-gray-800'
            }`}
          >
            {label}
            {v === 'transfers' && transfers.length > 0 && (
              <span className={`ml-1.5 text-xs ${view === v ? 'text-white/80' : 'text-gray-400'}`}>{transfers.length}</span>
            )}
          </button>
        ))}
      </div>

      {view === 'categories' && (
        <>
          {/* Charts */}
          {(donutData.length > 0 || trendHasData) && (
            <div className="grid md:grid-cols-2 gap-4 mb-6">
              {donutData.length > 0 && (
                <Card padding={false} className="p-3 md:p-5">
                  <CardHeader
                    title="Utgifter per kategori"
                    subtitle={`${MONTH_NAMES_LONG[month - 1]} ${year}`}
                  />
                  <CategoryDonut data={donutData} total={donutTotal} />
                </Card>
              )}
              {trendHasData && (
                <Card padding={false} className="p-3 md:p-5">
                  <CardHeader title="Utgifter senaste 6 månaderna" subtitle="Stapel per månad, färg per kategori" />
                  <CategoryTrendBar data={trendData} categories={expenseCategories} />
                </Card>
              )}
            </div>
          )}

          {/* Summary */}
          {grandCount > 0 && (
            <div className="flex items-center justify-between mb-4 text-xs text-gray-500 px-1">
              <span>{grandCount} transaktioner</span>
              <span className="tabular-nums font-medium text-gray-700">
                {formatCurrency(grandTotal)} netto
              </span>
            </div>
          )}

          {groups.length === 0 ? (
            <Card className="text-center py-16">
              <p className="text-gray-400 text-sm">
                Inga transaktioner för {MONTH_NAMES_LONG[month - 1]} {year}.
              </p>
            </Card>
          ) : (
            <Card padding={false} className="overflow-hidden">
              {groups.map((g) => (
                <CategoryBranch
                  key={g.cat.id}
                  group={g}
                  categories={categories}
                  receipts={groceryReceipts}
                  expanded={expandedCats.has(g.cat.id)}
                  onToggle={() => toggleCat(g.cat.id)}
                  expandedSubs={expandedSubs}
                  onToggleSub={toggleSub}
                />
              ))}
            </Card>
          )}
        </>
      )}

      {view === 'transfers' && (
        transfers.length === 0 ? (
          <Card className="text-center py-16">
            <p className="text-gray-400 text-sm">
              Inga överföringar för {MONTH_NAMES_LONG[month - 1]} {year}.
            </p>
          </Card>
        ) : (
          <Card padding={false} className="overflow-hidden">
            <div className="flex items-center justify-between px-3 md:px-5 py-3 bg-warm-50 border-b border-warm-200 text-xs text-gray-500">
              <span>{transfers.length} överföringar · räknas inte in i budgeten</span>
              <span className="tabular-nums font-medium text-gray-700">netto {formatCurrency(transferTotal)}</span>
            </div>
            {transfers.map((tx) => (
              <div key={txKey(tx)} className="flex items-start gap-2 px-3 md:px-5 py-2.5 border-b border-warm-100 last:border-0">
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-gray-700 truncate" title={tx.description ?? ''}>{tx.description || '—'}</div>
                  <div className="text-[11px] text-gray-400 truncate">
                    <span className="tabular-nums">{tx.date.slice(0, 10)}</span>
                    <span className="px-1 text-gray-300">·</span>
                    <span>{tx.account_name}</span>
                  </div>
                </div>
                <div className={`text-right tabular-nums font-medium text-sm shrink-0 ml-2 ${tx.amount < 0 ? 'text-red-500' : 'text-emerald-600'}`}>
                  {formatCurrency(tx.amount)}
                </div>
              </div>
            ))}
          </Card>
        )
      )}
    </Layout>
  )
}

// ─── Category branch ──────────────────────────────────────────────────────────

function CategoryBranch({
  group,
  categories,
  receipts,
  expanded,
  onToggle,
  expandedSubs,
  onToggleSub,
}: {
  group: CatGroup
  categories: CategoryDef[]
  receipts: GroceryReceipt[]
  expanded: boolean
  onToggle: () => void
  expandedSubs: Set<string>
  onToggleSub: (key: string) => void
}) {
  const { cat, total, count, subgroups, uncategorized } = group
  const hasBranches = subgroups.length > 0 || uncategorized.length > 0

  return (
    <div className="border-b border-warm-100 last:border-0">
      <div
        className="flex items-center gap-2 px-3 md:px-5 py-3 md:py-3.5 hover:bg-warm-50 transition-colors cursor-pointer select-none"
        onClick={onToggle}
      >
        <ChevronRight
          className={`w-3.5 h-3.5 text-gray-300 transition-transform duration-200 shrink-0 ${expanded ? 'rotate-90' : ''}`}
        />
        <div
          className="w-2 h-2 rounded-full shrink-0"
          style={{ backgroundColor: cat.color ?? '#94a3b8' }}
        />
        <span className="font-medium text-sm text-gray-800 truncate min-w-0 flex-1">{cat.name}</span>
        <Badge variant={cat.type === 'income' ? 'green' : cat.type === 'savings' ? 'blue' : 'gray'} size="sm">
          {cat.type === 'income' ? 'Inkomst' : cat.type === 'savings' ? 'Spar' : 'Utgift'}
        </Badge>
        <div className="text-right shrink-0 ml-1 md:ml-3 min-w-[88px]">
          <div className="text-sm font-medium tabular-nums text-gray-800">
            {formatCurrency(total)}
          </div>
          <div className="text-[10px] text-gray-400 tabular-nums">{count} st</div>
        </div>
      </div>

      {expanded && hasBranches && (
        <div className="bg-warm-50/60">
          {subgroups.map((sg) => {
            const key = `${cat.id}|${sg.subId}`
            const isOpen = expandedSubs.has(key)
            return (
              <SubcategoryBranch
                key={sg.subId}
                subName={sg.subName}
                total={sg.total}
                transactions={sg.transactions}
                categories={categories}
                receipts={receipts}
                catId={cat.id}
                subId={sg.subId}
                expanded={isOpen}
                onToggle={() => onToggleSub(key)}
              />
            )
          })}
          {uncategorized.length > 0 && (
            <SubcategoryBranch
              subName="Utan underkategori"
              total={uncategorized.reduce((s, t) => s + t.tx.amount, 0)}
              transactions={uncategorized}
              categories={categories}
              receipts={receipts}
              catId={cat.id}
              subId={undefined}
              expanded={expandedSubs.has(`${cat.id}|__none__`)}
              onToggle={() => onToggleSub(`${cat.id}|__none__`)}
              italic
            />
          )}
        </div>
      )}
    </div>
  )
}

// ─── Subcategory branch ───────────────────────────────────────────────────────

function SubcategoryBranch({
  subName,
  total,
  transactions,
  categories,
  receipts,
  catId,
  subId,
  expanded,
  onToggle,
  italic,
}: {
  subName: string
  total: number
  transactions: ResolvedTx[]
  categories: CategoryDef[]
  receipts: GroceryReceipt[]
  catId: string
  subId?: string
  expanded: boolean
  onToggle: () => void
  italic?: boolean
}) {
  // Level-3 breakdown for Matvaror, derived from linked grocery receipts (item grain).
  const groceryBreakdown = (catId === 'food' && subId === 'groceries')
    ? buildGroceryBreakdown(receipts, transactions.map((t) => t.tx))
    : null

  return (
    <div className="border-t border-warm-200/60">
      <div
        className="flex items-center gap-2 pl-7 md:pl-10 pr-3 md:pr-5 py-2.5 hover:bg-warm-100/60 transition-colors cursor-pointer select-none"
        onClick={onToggle}
      >
        <ChevronRight
          className={`w-3 h-3 text-gray-300 transition-transform duration-200 shrink-0 ${expanded ? 'rotate-90' : ''}`}
        />
        <span
          className={`text-sm truncate min-w-0 flex-1 ${italic ? 'italic text-gray-400' : 'text-gray-600'}`}
        >
          {subName}
        </span>
        <div className="text-right shrink-0 ml-1 md:ml-3 min-w-[88px]">
          <div className="text-sm tabular-nums text-gray-600">
            {formatCurrency(total)}
          </div>
          <div className="text-[10px] text-gray-400 tabular-nums">
            {transactions.length} st
          </div>
        </div>
      </div>

      {expanded && (
        <div className="bg-white border-t border-warm-200/60">
          {groceryBreakdown && groceryBreakdown.length > 0 && (
            <div className="pl-10 md:pl-16 pr-3 md:pr-5 py-2.5 border-b border-warm-100 bg-warm-50/40">
              <div className="text-[10px] font-semibold text-warm-500 uppercase tracking-widest mb-1.5">Fördelning från kvitton</div>
              <div className="flex flex-wrap gap-1.5">
                {groceryBreakdown.map((b) => (
                  <span key={b.category} className="text-xs bg-white border border-warm-200 rounded-full px-2.5 py-1 text-gray-600">
                    {GROCERY_CATEGORY_LABELS[b.category]} <span className="tabular-nums text-gray-400">{formatCurrency(b.amount)}</span>
                  </span>
                ))}
              </div>
            </div>
          )}
          {[...transactions]
            .sort((a, b) => b.tx.date.localeCompare(a.tx.date))
            .map((t) => (
              <TransactionRow key={txKey(t.tx)} tx={t.tx} categories={categories} catId={catId} subId={subId} />
            ))}
        </div>
      )}
    </div>
  )
}

// Aggregate linked receipts' items by grocery category for the given transactions.
function buildGroceryBreakdown(
  receipts: GroceryReceipt[],
  transactions: ZlantarTransaction[],
): { category: GroceryCategory; amount: number }[] {
  const keys = new Set(transactions.map((t) => txKey(t)))
  const sums = new Map<GroceryCategory, number>()
  for (const r of receipts) {
    const m = r.matchedTransaction
    if (!m) continue
    const linked = m.transactionId
      ? keys.has(m.transactionId)
      : transactions.some((t) => t.date === m.date && t.amount === m.amount)
    if (!linked) continue
    for (const item of r.items) sums.set(item.category, (sums.get(item.category) ?? 0) + item.amount)
  }
  return [...sums.entries()]
    .map(([category, amount]) => ({ category, amount }))
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
}

// ─── Transaction row (with inline re-categorization) ──────────────────────────

function TransactionRow({
  tx, categories, catId, subId,
}: {
  tx: ZlantarTransaction
  categories: CategoryDef[]
  catId: string
  subId?: string
}) {
  const store = useAppStore()
  const [editing, setEditing] = useState(false)
  const key = txKey(tx)
  const override = store.transactionOverrides[key]
  const cat = categories.find((c) => c.id === catId)
  const level3Name = override?.level3Id ? cat?.level3?.find((l) => l.id === override.level3Id)?.name : undefined

  return (
    <div className="border-b border-warm-100 last:border-0">
      <div className="flex items-start gap-2 pl-10 md:pl-16 pr-3 md:pr-5 py-2">
        <div className="flex-1 min-w-0">
          <div className="text-sm text-gray-700 truncate flex items-center gap-1.5" title={tx.description ?? ''}>
            {tx.description ?? '—'}
            {override && <span title="Omkategoriserad" className="w-1.5 h-1.5 rounded-full bg-brand-500 shrink-0" />}
            {level3Name && <span className="text-[10px] bg-warm-100 text-warm-600 rounded-full px-1.5 py-0.5 shrink-0">{level3Name}</span>}
          </div>
          <div className="text-[11px] text-gray-400 truncate" title={tx.account_name}>
            <span className="tabular-nums">{tx.date.slice(0, 10)}</span>
            <span className="px-1 text-gray-300">·</span>
            <span>{tx.account_name}</span>
          </div>
        </div>
        <div className={`text-right tabular-nums font-medium text-sm shrink-0 ml-2 ${tx.amount < 0 ? 'text-red-500' : 'text-emerald-600'}`}>
          {formatCurrency(tx.amount)}
        </div>
        <button
          onClick={() => setEditing((v) => !v)}
          className="text-gray-300 hover:text-brand-600 transition-colors shrink-0 mt-0.5"
          title="Byt kategori"
        >
          <Pencil className="w-3.5 h-3.5" />
        </button>
      </div>
      {editing && (
        <CategoryPicker
          categories={categories}
          currentCatId={catId}
          currentSubId={subId}
          currentLevel3Id={override?.level3Id}
          canReset={!!override}
          onPick={(c, s, l3) => { store.setTransactionOverride(key, { categoryId: c, subcategoryId: s, level3Id: l3 }); setEditing(false) }}
          onReset={() => { store.clearTransactionOverride(key); setEditing(false) }}
        />
      )}
    </div>
  )
}

// ─── Category picker (re-categorize a single transaction) ─────────────────────

function CategoryPicker({
  categories, currentCatId, currentSubId, currentLevel3Id, canReset, onPick, onReset,
}: {
  categories: CategoryDef[]
  currentCatId: string
  currentSubId?: string
  currentLevel3Id?: string
  canReset: boolean
  onPick: (catId: string, subId?: string, level3Id?: string) => void
  onReset: () => void
}) {
  const [catId, setCatId] = useState(currentCatId)
  const [subId, setSubId] = useState(currentSubId ?? '')
  const [level3Id, setLevel3Id] = useState(currentLevel3Id ?? '')
  const selectedCat = categories.find((c) => c.id === catId)
  const level3Options = (selectedCat?.level3 ?? []).filter((l) => l.parentSubId === subId)

  return (
    <div className="ml-10 md:ml-16 mb-2 flex flex-wrap items-center gap-2 bg-warm-50 border border-warm-200 rounded-lg p-2">
      <select
        className="border border-gray-200 rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
        value={catId}
        onChange={(e) => { setCatId(e.target.value); setSubId(''); setLevel3Id('') }}
      >
        {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      {selectedCat && selectedCat.subcategories.length > 0 && (
        <select
          className="border border-gray-200 rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          value={subId}
          onChange={(e) => { setSubId(e.target.value); setLevel3Id('') }}
        >
          <option value="">(ingen)</option>
          {selectedCat.subcategories.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      )}
      {level3Options.length > 0 && (
        <select
          className="border border-gray-200 rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          value={level3Id}
          onChange={(e) => setLevel3Id(e.target.value)}
          title="Nivå 3"
        >
          <option value="">(ingen nivå 3)</option>
          {level3Options.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
      )}
      <Button size="sm" onClick={() => onPick(catId, subId || undefined, level3Id || undefined)}>Spara</Button>
      {canReset && (
        <Button size="sm" variant="secondary" onClick={onReset}>
          <RotateCcw className="w-3.5 h-3.5" /> Återställ
        </Button>
      )}
    </div>
  )
}

// ─── Category donut ───────────────────────────────────────────────────────────

function CategoryDonut({ data, total }: { data: DonutSlice[]; total: number }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr] gap-3 items-center">
      <ResponsiveContainer width="100%" height={200}>
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="50%"
            innerRadius="44%"
            outerRadius="86%"
            stroke="none"
          >
            {data.map((entry) => (
              <Cell key={entry.catId} fill={entry.color} />
            ))}
          </Pie>
          <Tooltip
            formatter={(v, _name, item) => {
              const num = Number(v ?? 0)
              const pct = total > 0 ? ((num / total) * 100).toFixed(0) : 0
              const name = (item as { payload?: { name?: string } } | undefined)?.payload?.name ?? ''
              return [`${formatCurrency(num)} (${pct}%)`, name]
            }}
            labelStyle={{ display: 'none' }}
            contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e7e2d3' }}
          />
        </PieChart>
      </ResponsiveContainer>
      <div className="space-y-1 max-h-52 overflow-y-auto pr-1">
        {data.map((entry) => (
          <div key={entry.catId} className="flex items-center gap-2">
            <div
              className="w-2.5 h-2.5 rounded-full shrink-0"
              style={{ backgroundColor: entry.color }}
            />
            <span className="text-xs text-gray-700 flex-1 truncate">{entry.name}</span>
            <span className="text-xs text-gray-400 shrink-0 w-9 text-right tabular-nums">
              {total > 0 ? ((entry.value / total) * 100).toFixed(0) : 0}%
            </span>
          </div>
        ))}
        <div className="pt-1.5 mt-1 border-t border-warm-100 flex justify-between text-xs font-semibold text-gray-900">
          <span>Totalt</span>
          <span className="tabular-nums">{formatCurrency(total)}</span>
        </div>
      </div>
    </div>
  )
}

// ─── Category trend bar ───────────────────────────────────────────────────────

function CategoryTrendBar({
  data,
  categories,
}: {
  data: TrendDatum[]
  categories: CategoryDef[]
}) {
  // Only stack categories that have at least one non-zero value to keep the legend tidy.
  const activeCats = categories.filter((c) =>
    data.some((d) => (d[c.id] as number) > 0)
  )

  return (
    <div>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0ebe0" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
          <YAxis
            width={36}
            tick={{ fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 1000)}k` : `${v}`)}
          />
          <Tooltip
            cursor={{ fill: '#f5f1e6' }}
            contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e7e2d3' }}
            formatter={(v, name) => [formatCurrency(Number(v ?? 0)), String(name)]}
          />
          {activeCats.map((cat, i) => (
            <Bar
              key={cat.id}
              dataKey={cat.id}
              stackId="exp"
              name={cat.name}
              fill={cat.color ?? '#94a3b8'}
              radius={i === activeCats.length - 1 ? [4, 4, 0, 0] : 0}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2">
        {activeCats.map((cat) => (
          <div key={cat.id} className="flex items-center gap-1.5">
            <div
              className="w-2 h-2 rounded-sm shrink-0"
              style={{ backgroundColor: cat.color ?? '#94a3b8' }}
            />
            <span className="text-[11px] text-gray-500">{cat.name}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
