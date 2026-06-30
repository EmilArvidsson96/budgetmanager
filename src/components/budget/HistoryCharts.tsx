import { useMemo, useState } from 'react'
import {
  ComposedChart, Area, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts'
import { TrendingUp, TrendingDown, Minus } from 'lucide-react'
import { Card, CardHeader } from '@/components/ui/Card'
import { Select } from '@/components/ui/Select'
import { useAppStore } from '@/store'
import { formatCurrency } from '@/utils/budgetHelpers'
import { getMonthlyHistory, averageOf, type MonthHistoryPoint } from '@/utils/history'

// Fallback palette for categories without an explicit color (matches BudgetCharts).
const CAT_COLORS = [
  '#2563eb', '#0891b2', '#0d9488', '#059669', '#65a30d', '#d97706',
  '#dc2626', '#db2777', '#7c3aed', '#4f46e5', '#0284c7', '#16a34a',
  '#ea580c', '#b45309', '#9333ea', '#0e7490',
]
const INCOME_COLOR = '#059669'
const EXPENSE_COLOR = '#94a3b8'
const SAVINGS_COLOR = '#2563eb'
const PLAN_COLOR = '#dc2626'
const AVG_COLOR = '#7c3aed'

const WINDOWS = [12, 24, 0] as const   // 0 = all
type Win = (typeof WINDOWS)[number]
const winLabel = (w: Win) => (w === 0 ? 'Allt' : `${w} mån`)

function tickFmt(v: number): string {
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`
  return `${Math.round(v / 1000)}k`
}

// ─── Drill-in lens ──────────────────────────────────────────────────────────
type Lens = { id: string; name: string; color: string; goodWhenHigher: boolean }

function lensValue(p: MonthHistoryPoint, lensId: string): { actual: number; planned: number } {
  if (lensId === 'expense') return p.expense
  if (lensId === 'income') return p.income
  if (lensId === 'savings') return p.savings
  return p.byCat[lensId.slice(4)] ?? { actual: 0, planned: 0 }   // 'cat:<id>'
}

export function HistoryCharts() {
  const store = useAppStore()
  const { categories } = store.settings

  const history = useMemo(
    () => getMonthlyHistory(store),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [store.actuals, store.budgetBaseline, store.budgetOverrides, store.budgetHistory, store.monthlyBudgets, store.yearlyBudgets, categories]
  )

  const [win, setWin] = useState<Win>(history.length > 12 ? 12 : 0)
  const points = useMemo(
    () => (win === 0 ? history : history.slice(-win)),
    [history, win]
  )

  const [lensId, setLensId] = useState('expense')

  const expenseCats = useMemo(() => categories.filter((c) => c.type === 'expense'), [categories])

  // Expense categories that actually appear (actual or plan) somewhere in the window.
  const activeExpenseCats = useMemo(
    () => expenseCats.filter((c) => points.some((p) => (p.byCat[c.id]?.actual ?? 0) > 0 || (p.byCat[c.id]?.planned ?? 0) > 0)),
    [expenseCats, points]
  )
  const colorMap = useMemo(() => {
    const m = new Map<string, string>()
    activeExpenseCats.forEach((c, i) => m.set(c.id, c.color ?? CAT_COLORS[i % CAT_COLORS.length]))
    return m
  }, [activeExpenseCats])

  if (history.length === 0) {
    return (
      <Card className="text-center py-12 text-gray-500">
        Ingen historik ännu. Importera transaktioner i Flöde — varje importerad månad dyker upp här.
      </Card>
    )
  }

  // ── KPIs over the window ────────────────────────────────────────────────────
  const avgIncome = averageOf(points, (p) => p.income.actual)
  const avgExpense = averageOf(points, (p) => p.expense.actual)
  const avgSavings = averageOf(points, (p) => (p.savingsKnown ? p.savings.actual : null))
  const planMonths = points.filter((p) => p.expense.planned > 0)
  const withinBudget = planMonths.filter((p) => p.expense.actual <= p.expense.planned).length

  // ── Overview chart data (income / expense / savings actual + expense plan) ──
  const overviewData = points.map((p) => ({
    label: p.label,
    Utgifter: Math.round(p.expense.actual),
    Utgiftsplan: Math.round(p.expense.planned),
    Inkomst: Math.round(p.income.actual),
    Sparande: p.savingsKnown ? Math.round(p.savings.actual) : null,
  }))

  // ── Cost-evolution stacked area (expenses by category) ──────────────────────
  const costData = points.map((p) => {
    const row: Record<string, string | number> = { label: p.label }
    for (const c of activeExpenseCats) row[c.id] = Math.round(p.byCat[c.id]?.actual ?? 0)
    return row
  })

  // ── Drill-in lens ──────────────────────────────────────────────────────────
  const lensOptions = [
    { value: 'expense', label: 'Alla utgifter' },
    ...activeExpenseCats.map((c) => ({ value: `cat:${c.id}`, label: c.name })),
    { value: 'income', label: 'Inkomst' },
    { value: 'savings', label: 'Sparande' },
  ]
  const lens: Lens = useMemo(() => {
    if (lensId === 'expense') return { id: 'expense', name: 'Alla utgifter', color: EXPENSE_COLOR, goodWhenHigher: false }
    if (lensId === 'income') return { id: 'income', name: 'Inkomst', color: INCOME_COLOR, goodWhenHigher: true }
    if (lensId === 'savings') return { id: 'savings', name: 'Sparande', color: SAVINGS_COLOR, goodWhenHigher: true }
    const catId = lensId.slice(4)
    const cat = categories.find((c) => c.id === catId)
    return { id: lensId, name: cat?.name ?? 'Kategori', color: colorMap.get(catId) ?? cat?.color ?? CAT_COLORS[0], goodWhenHigher: false }
  }, [lensId, categories, colorMap])

  const detailData = useMemo(() => {
    // 3-month trailing average of the actual.
    const actuals = points.map((p) => lensValue(p, lensId).actual)
    return points.map((p, i) => {
      const v = lensValue(p, lensId)
      const lo = Math.max(0, i - 2)
      const window = actuals.slice(lo, i + 1)
      const avg = window.reduce((s, x) => s + x, 0) / window.length
      return { label: p.label, Utfall: Math.round(v.actual), Plan: Math.round(v.planned), Snitt: Math.round(avg) }
    })
  }, [points, lensId])

  // Lens stats: average actual vs plan, total, and trend (older half → newer half).
  const lensAvgActual = averageOf(points, (p) => lensValue(p, lensId).actual)
  const lensAvgPlan = averageOf(points, (p) => { const v = lensValue(p, lensId).planned; return v > 0 ? v : null })
  const lensTotal = points.reduce((s, p) => s + lensValue(p, lensId).actual, 0)
  const trend = (() => {
    if (points.length < 2) return 0
    const mid = Math.floor(points.length / 2)
    const older = averageOf(points.slice(0, mid), (p) => lensValue(p, lensId).actual)
    const newer = averageOf(points.slice(mid), (p) => lensValue(p, lensId).actual)
    if (older === 0) return 0
    return (newer - older) / Math.abs(older)
  })()
  const trendGood = lens.goodWhenHigher ? trend >= 0 : trend <= 0
  const TrendIcon = Math.abs(trend) < 0.02 ? Minus : trend > 0 ? TrendingUp : TrendingDown

  return (
    <div className="space-y-5">
      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card>
          <p className="text-xs text-gray-400 mb-1">Snittinkomst / mån</p>
          <p className="text-xl font-semibold text-emerald-700 tabular-nums">{formatCurrency(avgIncome)}</p>
        </Card>
        <Card>
          <p className="text-xs text-gray-400 mb-1">Snittutgift / mån</p>
          <p className="text-xl font-semibold text-gray-900 tabular-nums">{formatCurrency(avgExpense)}</p>
        </Card>
        <Card>
          <p className="text-xs text-gray-400 mb-1">Snittsparande / mån</p>
          <p className="text-xl font-semibold text-blue-700 tabular-nums">{formatCurrency(avgSavings)}</p>
        </Card>
        <Card>
          <p className="text-xs text-gray-400 mb-1">Månader inom budget</p>
          <p className="text-xl font-semibold text-gray-900 tabular-nums">
            {planMonths.length > 0 ? `${withinBudget} / ${planMonths.length}` : '–'}
          </p>
          <p className="text-xs text-gray-400 mt-0.5">utgifter mot plan</p>
        </Card>
      </div>

      {/* Overview: income / expense / savings over time */}
      <Card>
        <CardHeader
          title="Inkomster, utgifter & sparande"
          subtitle="Utfall per månad — utgiftsbudgeten som streckad linje"
          action={
            <div className="flex rounded-lg border border-warm-300 overflow-hidden text-sm">
              {WINDOWS.map((w) => (
                <button
                  key={w}
                  onClick={() => setWin(w)}
                  className={`px-3 py-1.5 font-medium transition-colors ${w !== WINDOWS[0] ? 'border-l border-warm-300' : ''} ${
                    win === w ? 'bg-brand-600 text-white' : 'text-gray-600 hover:bg-warm-50'
                  }`}
                >
                  {winLabel(w)}
                </button>
              ))}
            </div>
          }
        />
        <ResponsiveContainer width="100%" height={320}>
          <ComposedChart data={overviewData} barCategoryGap="25%" margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0ebe0" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
            <YAxis tickFormatter={tickFmt} tick={{ fontSize: 11 }} />
            <Tooltip content={(props: any) => <OverviewTooltip {...props} />} />
            <Bar dataKey="Utgifter" fill={EXPENSE_COLOR} fillOpacity={0.85} isAnimationActive={false} />
            <Line type="monotone" dataKey="Utgiftsplan" stroke={PLAN_COLOR} strokeWidth={1.5} strokeDasharray="4 3" dot={false} />
            <Line type="monotone" dataKey="Inkomst" stroke={INCOME_COLOR} strokeWidth={2.5} dot={false} />
            <Line type="monotone" dataKey="Sparande" stroke={SAVINGS_COLOR} strokeWidth={2} dot={false} connectNulls />
          </ComposedChart>
        </ResponsiveContainer>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-xs text-gray-500">
          <Legend swatch={EXPENSE_COLOR} shape="sq" label="Utgifter" />
          <Legend swatch={PLAN_COLOR} shape="dash" label="Utgiftsplan" />
          <Legend swatch={INCOME_COLOR} shape="line" label="Inkomst" />
          <Legend swatch={SAVINGS_COLOR} shape="line" label="Sparande" />
        </div>
      </Card>

      {/* Cost evolution: expenses by category over time */}
      {activeExpenseCats.length > 0 && (
        <Card>
          <CardHeader title="Kostnadsutveckling" subtitle="Utgifter per kategori, staplade över tid" />
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart data={costData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0ebe0" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
              <YAxis tickFormatter={tickFmt} tick={{ fontSize: 11 }} />
              <Tooltip content={(props: any) => <CostTooltip {...props} cats={activeExpenseCats} colorMap={colorMap} />} />
              {activeExpenseCats.map((c) => (
                <Area
                  key={c.id}
                  type="monotone"
                  dataKey={c.id}
                  name={c.name}
                  stackId="cost"
                  stroke={colorMap.get(c.id)}
                  fill={colorMap.get(c.id)}
                  fillOpacity={0.55}
                  strokeWidth={1}
                  isAnimationActive={false}
                />
              ))}
            </ComposedChart>
          </ResponsiveContainer>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-xs text-gray-500">
            {activeExpenseCats.map((c) => (
              <button
                key={c.id}
                onClick={() => setLensId(`cat:${c.id}`)}
                className="flex items-center gap-1.5 hover:text-gray-800 transition-colors"
                title="Visa i detalj nedan"
              >
                <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: colorMap.get(c.id) }} />
                {c.name}
              </button>
            ))}
          </div>
        </Card>
      )}

      {/* Drill-in detail per category / income / savings */}
      <Card>
        <CardHeader
          title="Detalj"
          subtitle="Utfall mot budget med 3-mån snitt"
          action={
            <Select className="w-44" value={lensId} onChange={(e) => setLensId(e.target.value)} options={lensOptions} />
          }
        />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          <Stat label="Snitt utfall" value={lensAvgActual} />
          <Stat label="Snitt plan" value={lensAvgPlan} muted />
          <Stat label="Totalt i perioden" value={lensTotal} />
          <div className="bg-white border border-warm-200 rounded-xl px-3 py-2.5">
            <p className="text-[11px] text-gray-400 mb-0.5">Trend</p>
            <p className={`text-base font-semibold tabular-nums flex items-center gap-1 ${trendGood ? 'text-emerald-700' : 'text-red-600'}`}>
              <TrendIcon className="w-4 h-4" />
              {Math.abs(trend) < 0.02 ? 'Stabil' : `${trend > 0 ? '+' : '−'}${Math.abs(trend * 100).toFixed(0)} %`}
            </p>
          </div>
        </div>
        <ResponsiveContainer width="100%" height={300}>
          <ComposedChart data={detailData} barCategoryGap="25%" margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0ebe0" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
            <YAxis tickFormatter={tickFmt} tick={{ fontSize: 11 }} />
            <Tooltip content={(props: any) => <DetailTooltip {...props} name={lens.name} />} />
            <ReferenceLine y={0} stroke="#e5e7eb" />
            <Bar dataKey="Utfall" fill={lens.color} fillOpacity={0.85} isAnimationActive={false} />
            <Line type="monotone" dataKey="Plan" stroke={PLAN_COLOR} strokeWidth={1.5} strokeDasharray="4 3" dot={false} />
            <Line type="monotone" dataKey="Snitt" stroke={AVG_COLOR} strokeWidth={2} dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-xs text-gray-500">
          <Legend swatch={lens.color} shape="sq" label={`${lens.name} (utfall)`} />
          <Legend swatch={PLAN_COLOR} shape="dash" label="Budget" />
          <Legend swatch={AVG_COLOR} shape="line" label="3-mån snitt" />
        </div>
      </Card>
    </div>
  )
}

// ─── Small pieces ─────────────────────────────────────────────────────────────

function Legend({ swatch, shape, label }: { swatch: string; shape: 'sq' | 'line' | 'dash'; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      {shape === 'sq' ? (
        <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: swatch }} />
      ) : shape === 'dash' ? (
        <span className="w-3 inline-block border-t-2 border-dashed" style={{ borderColor: swatch }} />
      ) : (
        <span className="w-3 h-0.5 inline-block" style={{ background: swatch }} />
      )}
      {label}
    </span>
  )
}

function Stat({ label, value, muted }: { label: string; value: number; muted?: boolean }) {
  return (
    <div className="bg-white border border-warm-200 rounded-xl px-3 py-2.5">
      <p className="text-[11px] text-gray-400 mb-0.5 truncate">{label}</p>
      <p className={`text-base font-semibold tabular-nums ${muted ? 'text-gray-400' : 'text-gray-900'}`}>{formatCurrency(value)}</p>
    </div>
  )
}

function TooltipBox({ label, children }: { label?: string; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-gray-100 shadow-lg rounded-xl px-4 py-3 text-sm min-w-[190px]">
      {label && <p className="font-semibold text-gray-800 mb-1.5">{label}</p>}
      {children}
    </div>
  )
}

function Row({ color, name, value, dim }: { color?: string; name: string; value: number | null; dim?: boolean }) {
  return (
    <p className={`flex items-center justify-between gap-4 ${dim ? 'text-gray-400' : 'text-gray-600'}`}>
      <span className="flex items-center gap-1.5">
        {color && <span className="w-2 h-2 rounded-sm inline-block shrink-0" style={{ background: color }} />}
        {name}
      </span>
      <span className="tabular-nums">{value === null ? '–' : formatCurrency(value)}</span>
    </p>
  )
}

function OverviewTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  return (
    <TooltipBox label={label}>
      <Row color={INCOME_COLOR} name="Inkomst" value={d.Inkomst} />
      <Row color={EXPENSE_COLOR} name="Utgifter" value={d.Utgifter} />
      <Row color={PLAN_COLOR} name="Utgiftsplan" value={d.Utgiftsplan} dim />
      <Row color={SAVINGS_COLOR} name="Sparande" value={d.Sparande} />
    </TooltipBox>
  )
}

function CostTooltip({ active, payload, label, cats, colorMap }: any) {
  if (!active || !payload?.length) return null
  const rows = cats
    .map((c: any) => ({ name: c.name, color: colorMap.get(c.id), value: payload[0].payload[c.id] ?? 0 }))
    .filter((r: any) => r.value > 0)
    .sort((a: any, b: any) => b.value - a.value)
  const total = rows.reduce((s: number, r: any) => s + r.value, 0)
  return (
    <TooltipBox label={label}>
      {rows.map((r: any) => <Row key={r.name} color={r.color} name={r.name} value={r.value} />)}
      <div className="mt-1.5 pt-1.5 border-t border-gray-100 flex justify-between font-semibold text-gray-800">
        <span>Totalt</span>
        <span className="tabular-nums">{formatCurrency(total)}</span>
      </div>
    </TooltipBox>
  )
}

function DetailTooltip({ active, payload, label, name }: any) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  const diff = d.Utfall - d.Plan
  return (
    <TooltipBox label={label}>
      <Row name={`${name} (utfall)`} value={d.Utfall} />
      <Row name="Budget" value={d.Plan} dim />
      <Row name="3-mån snitt" value={d.Snitt} dim />
      {d.Plan > 0 && (
        <div className="mt-1.5 pt-1.5 border-t border-gray-100 flex justify-between font-semibold text-gray-800">
          <span>Mot budget</span>
          <span className={`tabular-nums ${diff > 0 ? 'text-red-600' : 'text-emerald-700'}`}>{formatCurrency(diff, true)}</span>
        </div>
      )}
    </TooltipBox>
  )
}
