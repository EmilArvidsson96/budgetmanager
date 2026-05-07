import { useState, useRef, useMemo } from 'react'
import {
  Upload, Trash2, ChevronDown, ChevronRight, AlertTriangle, Loader2,
  Link2, Link2Off, FileText, Image, ClipboardPaste,
} from 'lucide-react'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
} from 'recharts'
import { useAppStore } from '@/store'
import { Layout, PageHeader } from '@/components/layout/Layout'
import { Card, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import {
  parseReceiptPDF,
  parseReceiptImage,
  parseReceiptText,
  findMatchingTransaction,
} from '@/utils/receiptParser'
import { DEFAULT_RECEIPT_MODEL } from '@/utils/receiptModels'
import { formatCurrency } from '@/utils/budgetHelpers'
import {
  GROCERY_CATEGORY_LABELS,
  type GroceryReceipt,
  type GroceryCategory,
  type MatchedTransaction,
  type ZlantarTransaction,
  type ZlantarCategoryRule,
  type CategoryDef,
} from '@/types'

// ─── Category pill colors ───────────────────────────────────────────────────

const CATEGORY_COLORS: Record<GroceryCategory, string> = {
  frukt_gront:  'bg-green-100 text-green-800',
  mejeri_agg:   'bg-yellow-100 text-yellow-800',
  kott_chark:   'bg-red-100 text-red-800',
  fisk:         'bg-blue-100 text-blue-800',
  brod_bageri:  'bg-amber-100 text-amber-800',
  torrvaror:    'bg-orange-100 text-orange-800',
  frys:         'bg-sky-100 text-sky-800',
  dryck:        'bg-indigo-100 text-indigo-800',
  godis_snacks: 'bg-pink-100 text-pink-800',
  hushall:      'bg-gray-100 text-gray-700',
  hygien:       'bg-purple-100 text-purple-800',
  ovrigt:       'bg-warm-100 text-warm-700',
}

const ALL_GROCERY_CATEGORIES = Object.keys(GROCERY_CATEGORY_LABELS) as GroceryCategory[]

// ─── Chart colors ────────────────────────────────────────────────────────────

type ChartCat = GroceryCategory | 'unmatched_transaction'

const CHART_COLORS: Record<ChartCat, string> = {
  unmatched_transaction: '#b0b0b0',  // distinct neutral grey (not hushall, not ovrigt)
  frukt_gront:           '#4ade80',
  mejeri_agg:            '#fde047',
  kott_chark:            '#f87171',
  fisk:                  '#60a5fa',
  brod_bageri:           '#d97706',
  torrvaror:             '#f97316',
  frys:                  '#38bdf8',
  dryck:                 '#818cf8',
  godis_snacks:          '#f472b6',
  hushall:               '#9ca3af',
  hygien:                '#c084fc',
  ovrigt:                '#d4bfa0',
}

const CHART_LABELS: Record<ChartCat, string> = {
  ...GROCERY_CATEGORY_LABELS,
  unmatched_transaction: 'Okopplad transaktion',
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

type InputMode = 'file' | 'text'

function yearMonthOf(date: string) { return date.slice(0, 7) }

function formatYearMonth(ym: string) {
  if (!ym) return ''
  const [year, month] = ym.split('-')
  const labels = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec']
  return `${labels[parseInt(month, 10) - 1]} ${year}`
}

// ─── Grocery transaction resolution ──────────────────────────────────────────

function resolveGroceryTransactions(
  txs: ZlantarTransaction[],
  rules: ZlantarCategoryRule[],
  categories: CategoryDef[],
): ZlantarTransaction[] {
  const catIds = new Set(categories.map((c) => c.id))
  const ruleMap = new Map<string, { appCategoryId: string; appSubcategoryId?: string }>()
  for (const r of rules) {
    const key = r.zlantarSubcategory
      ? `${r.zlantarCategory}|||${r.zlantarSubcategory}`
      : r.zlantarCategory
    ruleMap.set(key, { appCategoryId: r.appCategoryId, appSubcategoryId: r.appSubcategoryId })
  }
  return txs.filter((tx) => {
    const rawCat = tx.category ?? ''
    const rawSub = tx.subcategory ?? ''
    if (!rawCat) return false
    const exactKey = rawSub ? `${rawCat}|||${rawSub}` : ''
    const match = (exactKey ? ruleMap.get(exactKey) : undefined) ?? ruleMap.get(rawCat)
    let catId: string
    let subId: string
    if (match) {
      catId = match.appCategoryId
      subId = match.appSubcategoryId !== undefined ? match.appSubcategoryId : rawSub
    } else if (catIds.has(rawCat)) {
      catId = rawCat
      subId = rawSub
    } else {
      return false
    }
    return catId === 'food' && subId === 'groceries'
  })
}

// ─── Spend data pipeline ─────────────────────────────────────────────────────

interface SpendPoint {
  month: string
  monthLabel: string
  total: number
  [key: string]: unknown
}

function buildSpendSeries(
  receipts: GroceryReceipt[],
  groceryTxs: ZlantarTransaction[],
  includeUnmatchedReceipts: boolean,
): { points: SpendPoint[]; activeCategories: ChartCat[] } {
  // Index receipts by their matched transaction key (date_amount)
  const receiptByKey = new Map<string, GroceryReceipt>()
  for (const r of receipts) {
    if (r.matchedTransaction) {
      receiptByKey.set(`${r.matchedTransaction.date}_${r.matchedTransaction.amount}`, r)
    }
  }

  const monthSet = new Set<string>()
  for (const tx of groceryTxs) monthSet.add(tx.date.slice(0, 7))
  if (includeUnmatchedReceipts) {
    for (const r of receipts) {
      if (!r.matchedTransaction) monthSet.add(r.date.slice(0, 7))
    }
  }

  const sortedMonths = Array.from(monthSet).sort()
  const catTotals = new Map<ChartCat, number>()

  const rawPoints = sortedMonths.map((month) => {
    const cats = new Map<ChartCat, number>()
    const add = (cat: ChartCat, amount: number) => {
      cats.set(cat, (cats.get(cat) ?? 0) + amount)
      catTotals.set(cat, (catTotals.get(cat) ?? 0) + amount)
    }

    for (const tx of groceryTxs) {
      if (!tx.date.startsWith(month)) continue
      const receipt = receiptByKey.get(`${tx.date}_${tx.amount}`)
      if (receipt) {
        for (const item of receipt.items) add(item.category, Math.abs(item.amount))
      } else {
        add('unmatched_transaction', Math.abs(tx.amount))
      }
    }

    if (includeUnmatchedReceipts) {
      for (const r of receipts) {
        if (r.matchedTransaction || !r.date.startsWith(month)) continue
        for (const item of r.items) add(item.category, Math.abs(item.amount))
      }
    }

    const total = [...cats.values()].reduce((s, v) => s + v, 0)
    return { month, cats, total }
  })

  // Ordered: unmatched_transaction first (bottom of stack), then grocery cats by chart order
  const catOrder: ChartCat[] = [
    'unmatched_transaction',
    ...ALL_GROCERY_CATEGORIES,
  ]
  const activeCategories = catOrder.filter((c) => (catTotals.get(c) ?? 0) > 0)

  const points: SpendPoint[] = rawPoints.map(({ month, cats, total }) => {
    const point: SpendPoint = { month, monthLabel: formatYearMonth(month), total }
    for (const cat of activeCategories) point[cat] = cats.get(cat) ?? 0
    return point
  })

  return { points, activeCategories }
}

// ─── Custom tooltips ──────────────────────────────────────────────────────────

function AreaTooltipContent({
  active,
  payload,
  label,
  points,
}: {
  active?: boolean
  payload?: Array<{ dataKey: string; fill: string }>
  label?: string
  points: SpendPoint[]
}) {
  if (!active || !payload?.length) return null
  const orig = points.find((p) => p.monthLabel === label)
  if (!orig) return null
  const visible = [...payload]
    .reverse()
    .filter((p) => ((orig[p.dataKey] as number) ?? 0) > 0)

  return (
    <div className="bg-white border border-warm-200 rounded-xl shadow-lg p-3 text-xs space-y-1 max-h-72 overflow-auto">
      <p className="font-semibold text-gray-800 mb-1">{label}</p>
      {visible.map((p) => {
        const abs = (orig[p.dataKey] as number) ?? 0
        const pct = orig.total > 0 ? ((abs / orig.total) * 100).toFixed(0) : '0'
        return (
          <div key={p.dataKey} className="flex justify-between gap-4">
            <span style={{ color: p.fill }}>{CHART_LABELS[p.dataKey as ChartCat] ?? p.dataKey}</span>
            <span className="text-gray-700">
              {formatCurrency(abs)}
              <span className="text-gray-400 ml-1">({pct}%)</span>
            </span>
          </div>
        )
      })}
      <div className="pt-1 border-t border-warm-100 flex justify-between font-semibold text-gray-800">
        <span>Totalt</span>
        <span>{formatCurrency(orig.total)}</span>
      </div>
    </div>
  )
}

function PieTooltipContent({
  active,
  payload,
  total,
}: {
  active?: boolean
  payload?: Array<{ name: string; value: number; payload: { cat: ChartCat } }>
  total: number
}) {
  if (!active || !payload?.length) return null
  const entry = payload[0]
  return (
    <div className="bg-white border border-warm-200 rounded-xl shadow-lg p-3 text-xs">
      <p className="font-semibold mb-1" style={{ color: CHART_COLORS[entry.payload.cat] }}>
        {entry.name}
      </p>
      <p className="text-gray-700">{formatCurrency(entry.value)}</p>
      <p className="text-gray-400">
        {total > 0 ? ((entry.value / total) * 100).toFixed(1) : '0'}%
      </p>
    </div>
  )
}

// ─── Category pill ────────────────────────────────────────────────────────────

function CategoryPill({
  category,
  editable,
  onSelect,
}: {
  category: GroceryCategory
  editable?: boolean
  onSelect?: (cat: GroceryCategory) => void
}) {
  const [open, setOpen] = useState(false)
  const label = GROCERY_CATEGORY_LABELS[category]
  const color = CATEGORY_COLORS[category]

  if (!editable) {
    return <span className={`text-xs font-medium rounded-full px-2 py-0.5 ${color}`}>{label}</span>
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`text-xs font-medium rounded-full px-2 py-0.5 ${color} hover:opacity-80 flex items-center gap-1`}
      >
        {label}
        <ChevronDown className="w-3 h-3" />
      </button>
      {open && (
        <div className="absolute z-10 top-6 left-0 bg-white border border-warm-200 rounded-xl shadow-lg py-1 min-w-max max-h-60 overflow-y-auto">
          {ALL_GROCERY_CATEGORIES.map((cat) => (
            <button
              key={cat}
              className="w-full text-left text-xs px-3 py-1.5 hover:bg-warm-100 flex items-center gap-2"
              onClick={() => { onSelect?.(cat); setOpen(false) }}
            >
              <span className={`rounded-full px-2 py-0.5 ${CATEGORY_COLORS[cat]}`}>
                {GROCERY_CATEGORY_LABELS[cat]}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Transaction badge ────────────────────────────────────────────────────────

function TransactionBadge({
  matched,
  receiptId,
  receiptDate,
  receiptTotal,
}: {
  matched?: MatchedTransaction
  receiptId: string
  receiptDate: string
  receiptTotal: number
}) {
  const store = useAppStore()
  const [open, setOpen] = useState(false)

  const candidates = useMemo(() => {
    const ym = yearMonthOf(receiptDate)
    return store.allTransactions
      .filter((tx) => {
        if (!tx.date.startsWith(ym.slice(0, 4))) return false
        return Math.abs(tx.amount - receiptTotal) < 50
      })
      .sort((a, b) => Math.abs(a.amount - receiptTotal) - Math.abs(b.amount - receiptTotal))
      .slice(0, 10)
  }, [store.allTransactions, receiptDate, receiptTotal])

  if (matched) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-green-700 bg-green-50 border border-green-200 rounded-lg px-2.5 py-1">
        <Link2 className="w-3 h-3 shrink-0" />
        <span className="truncate max-w-[180px]">
          {matched.description || matched.date} · {formatCurrency(matched.amount)}
        </span>
        <button
          className="ml-1 text-green-500 hover:text-red-500 shrink-0"
          title="Ta bort koppling"
          onClick={() => store.setReceiptMatchedTransaction(receiptId, undefined)}
        >
          <Link2Off className="w-3 h-3" />
        </button>
      </div>
    )
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-brand-600 bg-warm-50 hover:bg-brand-50 border border-warm-200 hover:border-brand-300 rounded-lg px-2.5 py-1 transition-colors"
      >
        <Link2 className="w-3 h-3" />
        Koppla transaktion
      </button>
      {open && (
        <div className="absolute z-10 top-7 left-0 bg-white border border-warm-200 rounded-xl shadow-lg py-1 min-w-[260px] max-h-56 overflow-y-auto">
          {candidates.length === 0 ? (
            <p className="text-xs text-gray-400 px-3 py-2">Inga matchande transaktioner</p>
          ) : (
            candidates.map((tx, i) => (
              <button
                key={i}
                className="w-full text-left px-3 py-2 hover:bg-warm-50 flex items-center justify-between gap-3"
                onClick={() => {
                  store.setReceiptMatchedTransaction(receiptId, {
                    date: tx.date,
                    description: tx.description ?? '',
                    amount: tx.amount,
                  })
                  setOpen(false)
                }}
              >
                <div className="min-w-0">
                  <div className="text-xs font-medium text-gray-800 truncate">
                    {tx.description || '(ingen beskrivning)'}
                  </div>
                  <div className="text-[11px] text-gray-400">{tx.date}</div>
                </div>
                <span className="text-xs font-medium text-gray-700 shrink-0">
                  {formatCurrency(tx.amount)}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}

// ─── Receipt card ─────────────────────────────────────────────────────────────

function ReceiptCard({ receipt }: { receipt: GroceryReceipt }) {
  const [expanded, setExpanded] = useState(false)
  const store = useAppStore()

  return (
    <Card padding={false} className="overflow-hidden">
      <div
        className="flex items-start gap-3 p-4 cursor-pointer hover:bg-warm-50 select-none"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="mt-0.5 shrink-0">
          {expanded
            ? <ChevronDown className="w-4 h-4 text-warm-500" />
            : <ChevronRight className="w-4 h-4 text-warm-500" />}
        </div>
        <div className="flex-1 min-w-0 space-y-1.5">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm text-gray-900">{receipt.merchant}</span>
            <span className="text-xs text-gray-400">{receipt.date}</span>
          </div>
          <div className="inline-block" onClick={(e) => e.stopPropagation()}>
            <TransactionBadge
              matched={receipt.matchedTransaction}
              receiptId={receipt.id}
              receiptDate={receipt.date}
              receiptTotal={receipt.total}
            />
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-sm font-semibold text-gray-900">{formatCurrency(receipt.total)}</span>
          <Button
            variant="ghost"
            size="sm"
            className="text-gray-400 hover:text-red-500"
            onClick={(e) => { e.stopPropagation(); store.removeGroceryReceipt(receipt.id) }}
          >
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-warm-200 divide-y divide-warm-100">
          {receipt.items.map((item, i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-2.5 hover:bg-warm-50">
              <span className="flex-1 text-sm text-gray-700 min-w-0 truncate">{item.name}</span>
              <CategoryPill
                category={item.category}
                editable
                onSelect={(cat) => store.updateGroceryReceiptItemCategory(receipt.id, i, cat)}
              />
              <span className="text-sm text-gray-600 shrink-0 w-16 text-right">
                {formatCurrency(item.amount)}
              </span>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

// ─── Monthly breakdown ────────────────────────────────────────────────────────

function MonthlyBreakdown({ receipts }: { receipts: GroceryReceipt[] }) {
  const totals = useMemo(() => {
    const map = new Map<GroceryCategory, number>()
    for (const r of receipts) {
      for (const item of r.items) {
        map.set(item.category, (map.get(item.category) ?? 0) + item.amount)
      }
    }
    return ALL_GROCERY_CATEGORIES
      .map((cat) => ({ cat, amount: map.get(cat) ?? 0 }))
      .filter(({ amount }) => amount !== 0)
      .sort((a, b) => a.amount - b.amount)
  }, [receipts])

  const grandTotal = receipts.reduce((s, r) => s + r.total, 0)

  if (totals.length === 0) {
    return <p className="text-sm text-gray-400">Inga kvitton för denna period.</p>
  }

  const maxAbs = Math.max(...totals.map(({ amount }) => Math.abs(amount)), 1)

  return (
    <div className="space-y-2.5">
      {totals.map(({ cat, amount }) => (
        <div key={cat} className="flex items-center gap-3">
          <div className="w-32 shrink-0">
            <span className={`text-xs font-medium rounded-full px-2 py-0.5 ${CATEGORY_COLORS[cat]}`}>
              {GROCERY_CATEGORY_LABELS[cat]}
            </span>
          </div>
          <div className="flex-1 h-2 bg-warm-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-brand-400 rounded-full"
              style={{ width: `${(Math.abs(amount) / maxAbs) * 100}%` }}
            />
          </div>
          <span className="text-sm text-gray-700 w-20 text-right shrink-0">
            {formatCurrency(amount)}
          </span>
        </div>
      ))}
      <div className="pt-2 border-t border-warm-200 flex justify-between text-sm font-semibold text-gray-900">
        <span>Totalt {receipts.length} kvitton</span>
        <span>{formatCurrency(grandTotal)}</span>
      </div>
    </div>
  )
}

// ─── Spend analytics ──────────────────────────────────────────────────────────

function SpendAnalytics({ receipts }: { receipts: GroceryReceipt[] }) {
  const store = useAppStore()
  const [includeUnmatched, setIncludeUnmatched] = useState(false)
  const [areaMode, setAreaMode] = useState<'absolute' | 'percent'>('absolute')
  const [startMonth, setStartMonth] = useState('')
  const [endMonth, setEndMonth] = useState('')

  const groceryTxs = useMemo(
    () => resolveGroceryTransactions(
      store.allTransactions,
      store.settings.zlantarCategoryRules,
      store.settings.categories,
    ),
    [store.allTransactions, store.settings.zlantarCategoryRules, store.settings.categories],
  )

  const { points, activeCategories } = useMemo(
    () => buildSpendSeries(receipts, groceryTxs, includeUnmatched),
    [receipts, groceryTxs, includeUnmatched],
  )

  const months = useMemo(() => points.map((p) => p.month), [points])

  const effectiveStart = useMemo(() => {
    if (startMonth && months.includes(startMonth)) return startMonth
    return months.length >= 2 ? months[months.length - 2] : (months[0] ?? '')
  }, [startMonth, months])

  const effectiveEnd = useMemo(() => {
    if (endMonth && months.includes(endMonth)) return endMonth
    return months[months.length - 1] ?? ''
  }, [endMonth, months])

  const startIdx = Math.max(0, months.indexOf(effectiveStart))
  const endIdx = Math.max(startIdx, months.indexOf(effectiveEnd) === -1 ? months.length - 1 : months.indexOf(effectiveEnd))

  const windowPoints = useMemo(
    () => points.filter((p) => p.month >= effectiveStart && p.month <= effectiveEnd),
    [points, effectiveStart, effectiveEnd],
  )

  const areaChartData = useMemo(() => {
    if (areaMode === 'absolute') return points
    return points.map((p) => {
      const norm: SpendPoint = { month: p.month, monthLabel: p.monthLabel, total: 100 }
      for (const cat of activeCategories) {
        norm[cat] = p.total > 0 ? (((p[cat] as number) ?? 0) / p.total) * 100 : 0
      }
      return norm
    })
  }, [points, activeCategories, areaMode])

  const pieData = useMemo(() => {
    const totals = new Map<ChartCat, number>()
    for (const p of windowPoints) {
      for (const cat of activeCategories) {
        totals.set(cat, (totals.get(cat) ?? 0) + ((p[cat] as number) ?? 0))
      }
    }
    return [...totals.entries()]
      .filter(([, v]) => v > 0)
      .map(([cat, value]) => ({ cat, name: CHART_LABELS[cat], value }))
      .sort((a, b) => b.value - a.value)
  }, [windowPoints, activeCategories])

  const pieTotal = pieData.reduce((s, d) => s + d.value, 0)

  if (points.length === 0) {
    return (
      <Card className="mb-6">
        <CardHeader title="Spendanalys" />
        <p className="text-sm text-gray-400">
          Importera Zlantar-transaktioner för att se spendanalys över tid.
        </p>
        <label className="mt-4 flex items-center gap-2 cursor-pointer group">
          <input
            type="checkbox"
            checked={includeUnmatched}
            onChange={(e) => setIncludeUnmatched(e.target.checked)}
            className="rounded accent-brand-600"
          />
          <span className="text-xs text-gray-500 group-hover:text-gray-700 transition-colors">
            Inkludera kvitton utan matchad transaktion
          </span>
        </label>
      </Card>
    )
  }

  return (
    <Card className="mb-6">
      <CardHeader title="Spendanalys" />

      {/* ── Stacked area chart ── */}
      <div className="mb-2">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-xs text-gray-500">Visa:</span>
          {(['absolute', 'percent'] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => setAreaMode(mode)}
              className={`text-xs px-2.5 py-1 rounded-lg transition-colors ${
                areaMode === mode
                  ? 'bg-brand-600 text-white'
                  : 'bg-warm-100 text-warm-700 hover:bg-warm-200'
              }`}
            >
              {mode === 'absolute' ? 'Belopp (kr)' : 'Andel (%)'}
            </button>
          ))}
        </div>
        <ResponsiveContainer width="100%" height={240}>
          <AreaChart data={areaChartData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0ebe0" />
            <XAxis dataKey="monthLabel" tick={{ fontSize: 11 }} />
            <YAxis
              width={44}
              tick={{ fontSize: 11 }}
              tickFormatter={(v: number) =>
                areaMode === 'percent'
                  ? `${Math.round(v)}%`
                  : v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${v}`
              }
            />
            <Tooltip
              content={(props) => (
                <AreaTooltipContent
                  active={props.active}
                  payload={props.payload as Array<{ dataKey: string; fill: string }>}
                  label={props.label as string}
                  points={points}
                />
              )}
            />
            {activeCategories.map((cat) => (
              <Area
                key={cat}
                type="monotone"
                dataKey={cat}
                name={CHART_LABELS[cat]}
                stackId="stack"
                stroke={CHART_COLORS[cat]}
                fill={CHART_COLORS[cat]}
                fillOpacity={cat === 'unmatched_transaction' ? 0.6 : 0.8}
                strokeWidth={0}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="border-t border-warm-200 my-4" />

      {/* ── Time window controls ── */}
      <div className="mb-4 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-medium text-gray-600">Period:</span>
          <button
            onClick={() => {
              setStartMonth(months.length >= 2 ? months[months.length - 2] : months[0] ?? '')
              setEndMonth(months[months.length - 1] ?? '')
            }}
            className="text-xs px-2.5 py-1 rounded-lg bg-warm-100 text-warm-700 hover:bg-warm-200 transition-colors"
          >
            Senaste 2 månaderna
          </button>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500 w-8">Från</span>
            <input
              type="month"
              value={effectiveStart}
              min={months[0]}
              max={effectiveEnd}
              onChange={(e) => setStartMonth(e.target.value)}
              className="text-xs border border-warm-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-brand-400 bg-white"
            />
          </div>
          <span className="text-warm-300">→</span>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500 w-8">Till</span>
            <input
              type="month"
              value={effectiveEnd}
              min={effectiveStart}
              max={months[months.length - 1]}
              onChange={(e) => setEndMonth(e.target.value)}
              className="text-xs border border-warm-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-brand-400 bg-white"
            />
          </div>
        </div>

        {months.length > 1 && (
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-gray-400">
                <span>Från</span>
                <span className="font-medium text-gray-600">{formatYearMonth(months[startIdx])}</span>
              </div>
              <input
                type="range"
                min={0} max={months.length - 1} value={startIdx}
                onChange={(e) => {
                  const v = Number(e.target.value)
                  if (v <= endIdx) setStartMonth(months[v])
                }}
                className="w-full accent-brand-600 h-1.5"
              />
            </div>
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-gray-400">
                <span>Till</span>
                <span className="font-medium text-gray-600">{formatYearMonth(months[endIdx])}</span>
              </div>
              <input
                type="range"
                min={0} max={months.length - 1} value={endIdx}
                onChange={(e) => {
                  const v = Number(e.target.value)
                  if (v >= startIdx) setEndMonth(months[v])
                }}
                className="w-full accent-brand-600 h-1.5"
              />
            </div>
          </div>
        )}
      </div>

      {/* ── Pie chart + legend ── */}
      {pieData.length > 0 ? (
        <div className="grid md:grid-cols-2 gap-4 items-center">
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie
                data={pieData}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                innerRadius={48}
                outerRadius={96}
              >
                {pieData.map((entry) => (
                  <Cell key={entry.cat} fill={CHART_COLORS[entry.cat]} />
                ))}
              </Pie>
              <Tooltip
                content={(props) => (
                  <PieTooltipContent
                    active={props.active}
                    payload={props.payload as Array<{ name: string; value: number; payload: { cat: ChartCat } }>}
                    total={pieTotal}
                  />
                )}
              />
            </PieChart>
          </ResponsiveContainer>
          <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
            {pieData.map((entry) => (
              <div key={entry.cat} className="flex items-center gap-2">
                <div
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: CHART_COLORS[entry.cat] }}
                />
                <span className="text-xs text-gray-700 flex-1 truncate">{entry.name}</span>
                <span className="text-xs font-medium text-gray-900 shrink-0">
                  {formatCurrency(entry.value)}
                </span>
                <span className="text-xs text-gray-400 shrink-0 w-9 text-right">
                  {pieTotal > 0 ? ((entry.value / pieTotal) * 100).toFixed(0) : 0}%
                </span>
              </div>
            ))}
            <div className="pt-1.5 border-t border-warm-100 flex justify-between text-xs font-semibold text-gray-900">
              <span>Totalt</span>
              <span>{formatCurrency(pieTotal)}</span>
            </div>
          </div>
        </div>
      ) : (
        <p className="text-sm text-gray-400">Ingen data för vald period.</p>
      )}

      {/* ── Toggle for unmatched receipts ── */}
      <div className="mt-4 pt-3 border-t border-warm-100">
        <label className="flex items-center gap-2 cursor-pointer group">
          <input
            type="checkbox"
            checked={includeUnmatched}
            onChange={(e) => setIncludeUnmatched(e.target.checked)}
            className="rounded accent-brand-600"
          />
          <span className="text-xs text-gray-500 group-hover:text-gray-700 transition-colors">
            Inkludera kvitton utan matchad transaktion
          </span>
        </label>
      </div>
    </Card>
  )
}

// ─── Main view ────────────────────────────────────────────────────────────────

export function GroceryReceiptsView() {
  const store = useAppStore()
  const apiKey = store.settings.anthropicApiKey ?? ''
  const model = store.settings.anthropicModel ?? DEFAULT_RECEIPT_MODEL
  const allReceipts = store.groceryReceipts

  const [mode, setMode] = useState<InputMode>('file')
  const [pasteText, setPasteText] = useState('')
  const [parsing, setParsing] = useState<string[]>([])
  const [errors, setErrors] = useState<{ file: string; message: string }[]>([])
  const [selectedMonth, setSelectedMonth] = useState<string>('')
  const fileRef = useRef<HTMLInputElement>(null)

  const months = useMemo(() => {
    const set = new Set(allReceipts.map((r) => yearMonthOf(r.date)))
    return Array.from(set).sort().reverse()
  }, [allReceipts])

  const activeMonth = selectedMonth || months[0] || ''
  const monthReceipts = useMemo(
    () => allReceipts.filter((r) => yearMonthOf(r.date) === activeMonth),
    [allReceipts, activeMonth]
  )

  function addParsedReceipt(parsed: Omit<GroceryReceipt, 'id' | 'parsedAt'>) {
    const matched = findMatchingTransaction(
      parsed.date,
      parsed.total,
      store.allTransactions
    )
    const receipt: GroceryReceipt = {
      ...parsed,
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      parsedAt: new Date().toISOString(),
      matchedTransaction: matched,
    }
    store.addGroceryReceipt(receipt)
    setSelectedMonth(yearMonthOf(receipt.date))
  }

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    setErrors([])
    for (const file of Array.from(files)) {
      const isPdf = file.type === 'application/pdf' || file.name.endsWith('.pdf')
      const isImage = file.type.startsWith('image/')
      if (!isPdf && !isImage) continue
      setParsing((p) => [...p, file.name])
      try {
        const parsed = isPdf
          ? await parseReceiptPDF(file, apiKey, model)
          : await parseReceiptImage(file, apiKey, model)
        addParsedReceipt(parsed)
      } catch (err) {
        setErrors((prev) => [...prev, { file: file.name, message: String(err) }])
      } finally {
        setParsing((p) => p.filter((n) => n !== file.name))
      }
    }
  }

  async function handlePasteSubmit() {
    if (!pasteText.trim()) return
    setErrors([])
    const label = 'Inklistrat kvitto'
    setParsing((p) => [...p, label])
    try {
      const parsed = await parseReceiptText(pasteText, apiKey, model)
      addParsedReceipt(parsed)
      setPasteText('')
    } catch (err) {
      setErrors((prev) => [...prev, { file: label, message: String(err) }])
    } finally {
      setParsing((p) => p.filter((n) => n !== label))
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    handleFiles(e.dataTransfer.files)
  }

  const noApiKey = !apiKey.trim()
  const isParsing = parsing.length > 0

  return (
    <Layout>
      <PageHeader
        title="Matkvitton"
        subtitle="Ladda upp kvitton för att se vad du spenderar på i mataffären"
      />

      {noApiKey && (
        <div className="mb-6 flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-amber-500" />
          <span>
            Ingen Anthropic API-nyckel inställd. Gå till{' '}
            <a href="/budgetmanager/installningar" className="underline font-medium">Inställningar</a>{' '}
            → API-nycklar och lägg till din nyckel för att kunna tolka kvitton.
          </span>
        </div>
      )}

      {/* Input mode tabs */}
      <div className={`mb-4 flex gap-1 ${noApiKey ? 'opacity-50 pointer-events-none' : ''}`}>
        <button
          onClick={() => setMode('file')}
          className={`flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-lg transition-colors
            ${mode === 'file' ? 'bg-brand-600 text-white' : 'bg-warm-100 text-warm-700 hover:bg-warm-200'}`}
        >
          <Upload className="w-3.5 h-3.5" />
          Fil
        </button>
        <button
          onClick={() => setMode('text')}
          className={`flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-lg transition-colors
            ${mode === 'text' ? 'bg-brand-600 text-white' : 'bg-warm-100 text-warm-700 hover:bg-warm-200'}`}
        >
          <ClipboardPaste className="w-3.5 h-3.5" />
          Klistra in text
        </button>
      </div>

      {mode === 'file' && (
        <div
          className={`mb-6 border-2 border-dashed rounded-2xl p-8 text-center transition-colors
            ${noApiKey
              ? 'border-warm-200 bg-warm-50 opacity-60 pointer-events-none'
              : 'border-warm-300 bg-warm-50 hover:border-brand-400 hover:bg-brand-50 cursor-pointer'}`}
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
          onClick={() => !noApiKey && fileRef.current?.click()}
        >
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,application/pdf,image/png,image/jpeg,image/jpg,image/webp"
            multiple
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
          />
          <div className="flex items-center justify-center gap-3 mb-3">
            <FileText className="w-6 h-6 text-warm-400" />
            <Image className="w-6 h-6 text-warm-400" />
          </div>
          <p className="text-sm font-medium text-gray-700">Dra och släpp kvitton här</p>
          <p className="text-xs text-gray-400 mt-1">PDF, PNG eller JPEG — flera filer åt gången</p>
          {isParsing && (
            <div className="mt-4 space-y-1.5">
              {parsing.map((name) => (
                <div key={name} className="flex items-center justify-center gap-2 text-xs text-brand-600">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Tolkar {name}…
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {mode === 'text' && (
        <div className={`mb-6 space-y-3 ${noApiKey ? 'opacity-50 pointer-events-none' : ''}`}>
          <textarea
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            placeholder="Klistra in kvittotexten här…"
            rows={10}
            className="w-full border border-warm-300 rounded-xl px-4 py-3 text-sm font-mono text-gray-700 focus:outline-none focus:ring-2 focus:ring-brand-400 bg-warm-50 resize-y"
          />
          <div className="flex items-center gap-3">
            <Button
              onClick={handlePasteSubmit}
              disabled={!pasteText.trim() || isParsing}
              loading={isParsing}
            >
              Tolka kvitto
            </Button>
            {pasteText && (
              <button
                className="text-xs text-gray-400 hover:text-gray-600"
                onClick={() => setPasteText('')}
              >
                Rensa
              </button>
            )}
          </div>
          {isParsing && (
            <div className="flex items-center gap-2 text-xs text-brand-600">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Tolkar kvitto…
            </div>
          )}
        </div>
      )}

      {errors.length > 0 && (
        <div className="mb-6 space-y-2">
          {errors.map((e, i) => (
            <div key={i} className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <span><strong>{e.file}:</strong> {e.message}</span>
            </div>
          ))}
        </div>
      )}

      {allReceipts.length > 0 && (
        <>
          <SpendAnalytics receipts={allReceipts} />

          <div className="grid md:grid-cols-5 gap-6">
            {/* Left: month breakdown */}
            <div className="md:col-span-2 space-y-4">
              {months.length > 1 && (
                <div className="flex flex-wrap gap-2">
                  {months.map((m) => (
                    <button
                      key={m}
                      onClick={() => setSelectedMonth(m)}
                      className={`text-xs font-medium px-3 py-1.5 rounded-lg transition-colors
                        ${activeMonth === m
                          ? 'bg-brand-600 text-white'
                          : 'bg-warm-100 text-warm-700 hover:bg-warm-200'}`}
                    >
                      {formatYearMonth(m)}
                    </button>
                  ))}
                </div>
              )}
              <Card>
                <CardHeader
                  title={activeMonth ? `Fördelning ${formatYearMonth(activeMonth)}` : 'Fördelning'}
                />
                <MonthlyBreakdown receipts={monthReceipts} />
              </Card>
            </div>

            {/* Right: receipt list */}
            <div className="md:col-span-3 space-y-3">
              <h2 className="text-sm font-semibold text-gray-600 uppercase tracking-wide">
                {activeMonth ? `Kvitton ${formatYearMonth(activeMonth)}` : 'Kvitton'}
              </h2>
              <p className="text-xs text-gray-400 -mt-1">
                Klicka för att expandera och se varor. Koppla ett kvitto till en Zlantar-transaktion via länk-knappen.
              </p>
              {monthReceipts.length === 0 ? (
                <p className="text-sm text-gray-400">Inga kvitton för vald månad.</p>
              ) : (
                monthReceipts
                  .slice()
                  .sort((a, b) => b.date.localeCompare(a.date))
                  .map((r) => <ReceiptCard key={r.id} receipt={r} />)
              )}
            </div>
          </div>
        </>
      )}

      {allReceipts.length === 0 && !noApiKey && !isParsing && (
        <div className="text-center py-16 text-gray-400">
          <Upload className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p className="text-sm">Ladda upp ditt första kvitto för att komma igång</p>
        </div>
      )}
    </Layout>
  )
}
