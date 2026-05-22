import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Search, X } from 'lucide-react'
import { useAppStore } from '@/store'
import { Layout, PageHeader } from '@/components/layout/Layout'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import {
  MONTH_NAMES_LONG,
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
