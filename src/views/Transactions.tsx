import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Search, X } from 'lucide-react'
import {
  PieChart, Pie, Cell,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import { useAppStore } from '@/store'
import { Layout, PageHeader } from '@/components/layout/Layout'
import { Card, CardHeader } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import {
  MONTH_NAMES_LONG,
  MONTH_NAMES_SHORT,
  makeMonthId,
  formatCurrency,
} from '@/utils/budgetHelpers'
import { getMonthIdForDate } from '@/utils/periodUtils'
import { DEFAULT_ZLANTAR_RULES } from '@/store/defaultCategories'
import type {
  CategoryDef,
  ZlantarTransaction,
  ZlantarCategoryRule,
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
  ruleMap: Map<string, RuleTarget>
): { catId: string; subId: string } {
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

  const { settings, allTransactions } = useAppStore()
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
        ruleMap
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
  }, [allTransactions, categories, zlantarCategoryRules, monthId, monthStartDay, monthStartBusinessDay, search])

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
        ruleMap
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
  }, [allTransactions, categories, zlantarCategoryRules, year, month, monthStartDay, monthStartBusinessDay, search])

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

      {/* Charts */}
      {(donutData.length > 0 || trendHasData) && (
        <div className="grid md:grid-cols-2 gap-4 mb-6">
          {donutData.length > 0 && (
            <Card>
              <CardHeader
                title="Utgifter per kategori"
                subtitle={`${MONTH_NAMES_LONG[month - 1]} ${year}`}
              />
              <CategoryDonut data={donutData} total={donutTotal} />
            </Card>
          )}
          {trendHasData && (
            <Card>
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
              expanded={expandedCats.has(g.cat.id)}
              onToggle={() => toggleCat(g.cat.id)}
              expandedSubs={expandedSubs}
              onToggleSub={toggleSub}
            />
          ))}
        </Card>
      )}
    </Layout>
  )
}

// ─── Category branch ──────────────────────────────────────────────────────────

function CategoryBranch({
  group,
  expanded,
  onToggle,
  expandedSubs,
  onToggleSub,
}: {
  group: CatGroup
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
        className="grid grid-cols-[1fr_80px_160px] px-5 py-3.5 items-center hover:bg-warm-50 transition-colors cursor-pointer select-none"
        onClick={onToggle}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <ChevronRight
            className={`w-3.5 h-3.5 text-gray-300 transition-transform duration-200 shrink-0 ${expanded ? 'rotate-90' : ''}`}
          />
          <div
            className="w-2 h-2 rounded-full shrink-0"
            style={{ backgroundColor: cat.color ?? '#94a3b8' }}
          />
          <span className="font-medium text-sm text-gray-800 truncate">{cat.name}</span>
          <Badge variant={cat.type === 'income' ? 'green' : cat.type === 'savings' ? 'blue' : 'gray'} size="sm">
            {cat.type === 'income' ? 'Inkomst' : cat.type === 'savings' ? 'Spar' : 'Utgift'}
          </Badge>
        </div>
        <div className="text-right text-xs text-gray-400 tabular-nums">{count} st</div>
        <div className="text-right text-sm font-medium tabular-nums text-gray-800">
          {formatCurrency(total)}
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
  expanded,
  onToggle,
  italic,
}: {
  subName: string
  total: number
  transactions: ResolvedTx[]
  expanded: boolean
  onToggle: () => void
  italic?: boolean
}) {
  return (
    <div className="border-t border-warm-200/60">
      <div
        className="grid grid-cols-[1fr_80px_160px] px-5 py-2.5 items-center hover:bg-warm-100/60 transition-colors cursor-pointer select-none"
        onClick={onToggle}
      >
        <div className="flex items-center gap-2 min-w-0 pl-6">
          <ChevronRight
            className={`w-3 h-3 text-gray-300 transition-transform duration-200 shrink-0 ${expanded ? 'rotate-90' : ''}`}
          />
          <span className={`text-sm text-gray-600 truncate ${italic ? 'italic text-gray-400' : ''}`}>
            {subName}
          </span>
        </div>
        <div className="text-right text-xs text-gray-400 tabular-nums">
          {transactions.length} st
        </div>
        <div className="text-right text-sm tabular-nums text-gray-600">
          {formatCurrency(total)}
        </div>
      </div>

      {expanded && (
        <div className="bg-white border-t border-warm-200/60">
          {[...transactions]
            .sort((a, b) => b.tx.date.localeCompare(a.tx.date))
            .map((t, i) => (
              <div
                key={i}
                className="grid grid-cols-[100px_1fr_140px_110px] px-5 py-2 text-sm items-center gap-2 border-b border-warm-100 last:border-0"
              >
                <div className="pl-12 text-gray-400 tabular-nums text-xs">{t.tx.date}</div>
                <div className="text-gray-700 truncate" title={t.tx.description ?? ''}>
                  {t.tx.description ?? '—'}
                </div>
                <div className="text-gray-400 text-xs truncate" title={t.tx.account_name}>
                  {t.tx.account_name}
                </div>
                <div
                  className={`text-right tabular-nums font-medium ${
                    t.tx.amount < 0 ? 'text-red-500' : 'text-emerald-600'
                  }`}
                >
                  {formatCurrency(t.tx.amount)}
                </div>
              </div>
            ))}
        </div>
      )}
    </div>
  )
}

// ─── Category donut ───────────────────────────────────────────────────────────

function CategoryDonut({ data, total }: { data: DonutSlice[]; total: number }) {
  return (
    <div className="grid grid-cols-[1fr_1fr] gap-3 items-center">
      <ResponsiveContainer width="100%" height={200}>
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="50%"
            innerRadius={44}
            outerRadius={86}
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
          <XAxis dataKey="label" tick={{ fontSize: 11 }} axisLine={false} tickLine={false} />
          <YAxis
            width={44}
            tick={{ fontSize: 11 }}
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
