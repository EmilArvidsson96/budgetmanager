import { useMemo, useState } from 'react'
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import { Card, CardHeader } from '@/components/ui/Card'
import { Select } from '@/components/ui/Select'
import { useAppStore } from '@/store'
import { formatCurrency, MONTH_NAMES_LONG } from '@/utils/budgetHelpers'
import { budgetedAmount } from '@/utils/projection'
import type { ProjectionMonth } from '@/utils/projection'

// Fallback palette for expense categories without an explicit color.
const CAT_COLORS = [
  '#2563eb', '#0891b2', '#0d9488', '#059669', '#65a30d', '#d97706',
  '#dc2626', '#db2777', '#7c3aed', '#4f46e5', '#0284c7', '#16a34a',
  '#ea580c', '#b45309', '#9333ea', '#0e7490',
]

const INCOME_COLOR = '#111827'

function tickFmt(v: number): string {
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`
  return `${Math.round(v / 1000)}k`
}

// Hand-built SVG donut (Recharts 3.8 <Pie> renders empty when mounted via a
// conditional view-switch under React 19 — selectPieSectors returns null and
// never recovers). This is fully deterministic and matches the WealthBarShape
// SVG approach used elsewhere.
function polar(cx: number, cy: number, r: number, angleDeg: number): [number, number] {
  const a = ((angleDeg - 90) * Math.PI) / 180
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)]
}

function donutSlicePath(cx: number, cy: number, rOuter: number, rInner: number, start: number, end: number): string {
  // Clamp a full circle just under 360° so the arc path is non-degenerate.
  const e = end - start >= 360 ? start + 359.999 : end
  const largeArc = e - start > 180 ? 1 : 0
  const [x1, y1] = polar(cx, cy, rOuter, start)
  const [x2, y2] = polar(cx, cy, rOuter, e)
  const [x3, y3] = polar(cx, cy, rInner, e)
  const [x4, y4] = polar(cx, cy, rInner, start)
  return `M${x1},${y1} A${rOuter},${rOuter} 0 ${largeArc} 1 ${x2},${y2} L${x3},${y3} A${rInner},${rInner} 0 ${largeArc} 0 ${x4},${y4} Z`
}

function DonutChart({ data, total }: { data: { catId: string; name: string; value: number; color: string }[]; total: number }) {
  const cx = 100, cy = 100, rOuter = 92, rInner = 54
  let angle = 0
  return (
    <svg viewBox="0 0 200 200" width="100%" height={240} role="img" aria-label="Budgetfördelning">
      {data.map((d) => {
        const sweep = total > 0 ? (d.value / total) * 360 : 0
        const start = angle
        angle += sweep
        const pct = total > 0 ? ((d.value / total) * 100).toFixed(0) : '0'
        return (
          <path key={d.catId} d={donutSlicePath(cx, cy, rOuter, rInner, start, angle)} fill={d.color} fillOpacity={0.9}>
            <title>{`${d.name}: ${formatCurrency(d.value)} (${pct}%)`}</title>
          </path>
        )
      })}
    </svg>
  )
}

function monthLabel(monthId: string): string {
  const year = monthId.slice(0, 4)
  const month = parseInt(monthId.slice(5, 7))
  return `${MONTH_NAMES_LONG[month - 1]} ${year}`
}

// Stacked monthly budget (expenses by category, income as a line) for the
// selected month and the coming months, plus an expense-composition pie for the
// selected month. Reads the same budgetedAmount() resolution as the projection,
// so the bars reflect overrides → baseline → legacy budgets.
export function BudgetCharts({ months }: { months: ProjectionMonth[] }) {
  const store = useAppStore()
  const { categories } = store.settings

  const expenseCats = useMemo(() => categories.filter((c) => c.type === 'expense'), [categories])
  const incomeCats = useMemo(() => categories.filter((c) => c.type === 'income'), [categories])

  const [selected, setSelected] = useState(months[0]?.monthId ?? '')
  // Horizon changes can drop the selected month from the list — fall back to the first.
  const selectedMonthId = months.some((m) => m.monthId === selected) ? selected : months[0]?.monthId ?? ''

  const rangeMonths = useMemo(
    () => months.filter((m) => m.monthId >= selectedMonthId),
    [months, selectedMonthId]
  )

  // Only categories with a non-zero budget somewhere in the range — keeps the
  // stack and legend tidy. Stable order drives a consistent colour mapping.
  const activeExpenseCats = useMemo(
    () => expenseCats.filter((c) => rangeMonths.some((m) => Math.abs(budgetedAmount(store, m.monthId, c.id)) > 0)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [expenseCats, rangeMonths, store.budgetBaseline, store.budgetOverrides, store.monthlyBudgets, store.yearlyBudgets]
  )

  const colorMap = useMemo(() => {
    const m = new Map<string, string>()
    activeExpenseCats.forEach((c, i) => m.set(c.id, c.color ?? CAT_COLORS[i % CAT_COLORS.length]))
    return m
  }, [activeExpenseCats])

  const nameMap = useMemo(() => new Map(activeExpenseCats.map((c) => [c.id, c.name])), [activeExpenseCats])

  // Stacked-bar data: one row per month, one numeric key per expense category +
  // a planned-income value rendered as a line.
  const barData = useMemo(
    () =>
      rangeMonths.map((m) => {
        const row: Record<string, string | number> = {
          label: m.label,
          Inkomst: Math.round(incomeCats.reduce((s, c) => s + budgetedAmount(store, m.monthId, c.id), 0)),
        }
        for (const c of activeExpenseCats) {
          row[c.id] = Math.round(Math.abs(budgetedAmount(store, m.monthId, c.id)))
        }
        return row
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rangeMonths, activeExpenseCats, incomeCats, store.budgetBaseline, store.budgetOverrides, store.monthlyBudgets, store.yearlyBudgets]
  )

  // Pie data: expense composition for the selected month only.
  const pieData = useMemo(
    () =>
      activeExpenseCats
        .map((c) => ({
          catId: c.id,
          name: c.name,
          value: Math.round(Math.abs(budgetedAmount(store, selectedMonthId, c.id))),
          color: colorMap.get(c.id)!,
        }))
        .filter((d) => d.value > 0)
        .sort((a, b) => b.value - a.value),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeExpenseCats, selectedMonthId, colorMap, store.budgetBaseline, store.budgetOverrides, store.monthlyBudgets, store.yearlyBudgets]
  )

  const pieTotal = pieData.reduce((s, d) => s + d.value, 0)
  const selectedIncome = Math.round(incomeCats.reduce((s, c) => s + budgetedAmount(store, selectedMonthId, c.id), 0))
  const selectedNet = selectedIncome - pieTotal

  const monthOptions = months.map((m) => ({ value: m.monthId, label: monthLabel(m.monthId) }))

  if (months.length === 0) {
    return (
      <Card className="text-center py-10 text-gray-400">Ingen budgetdata att visa.</Card>
    )
  }

  return (
    <div className="space-y-5">
      {/* Selected-month summary */}
      <div className="grid grid-cols-3 gap-3">
        <SummaryStat label={`Inkomst — ${monthLabel(selectedMonthId)}`} value={selectedIncome} tone="income" />
        <SummaryStat label="Utgifter" value={-pieTotal} tone="expense" />
        <SummaryStat label="Kvar" value={selectedNet} tone={selectedNet >= 0 ? 'income' : 'expense'} />
      </div>

      {/* Stacked bars over the selected + coming months */}
      <Card>
        <CardHeader
          title="Budget per månad"
          subtitle="Utgifter staplade per kategori, planerad inkomst som linje"
          action={
            <Select
              className="w-44"
              value={selectedMonthId}
              onChange={(e) => setSelected(e.target.value)}
              options={monthOptions}
            />
          }
        />
        <ResponsiveContainer width="100%" height={320}>
          <ComposedChart data={barData} barCategoryGap="20%" margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0ebe0" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
            <YAxis tickFormatter={tickFmt} tick={{ fontSize: 11 }} />
            <Tooltip
              content={(props: any) => (
                <BudgetBarTooltip active={props.active} payload={props.payload} label={props.label} nameMap={nameMap} />
              )}
            />
            {activeExpenseCats.map((c) => (
              <Bar
                key={c.id}
                dataKey={c.id}
                name={c.name}
                stackId="exp"
                fill={colorMap.get(c.id)}
                fillOpacity={0.9}
                isAnimationActive={false}
              />
            ))}
            <Line type="monotone" dataKey="Inkomst" stroke={INCOME_COLOR} strokeWidth={2.5} dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-xs text-gray-500">
          {activeExpenseCats.map((c) => (
            <span key={c.id} className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: colorMap.get(c.id) }} />
              {c.name}
            </span>
          ))}
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-0.5 inline-block" style={{ background: INCOME_COLOR }} />
            Inkomst
          </span>
        </div>
      </Card>

      {/* Composition pie for the selected month */}
      <Card>
        <CardHeader title={`Fördelning — ${monthLabel(selectedMonthId)}`} subtitle="Budgeterade utgifter per kategori" />
        {pieData.length === 0 ? (
          <p className="text-center text-gray-400 py-10">Inga budgeterade utgifter för {monthLabel(selectedMonthId)}.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr] gap-3 items-center">
            <DonutChart data={pieData} total={pieTotal} />
            <div className="space-y-1 max-h-60 overflow-y-auto pr-1">
              {pieData.map((entry) => (
                <div key={entry.catId} className="flex items-center gap-2 py-0.5">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: entry.color }} />
                  <span className="text-xs text-gray-700 flex-1 truncate">{entry.name}</span>
                  <span className="text-xs text-gray-500 shrink-0 tabular-nums">{formatCurrency(entry.value)}</span>
                  <span className="text-xs text-gray-400 shrink-0 w-9 text-right tabular-nums">
                    {pieTotal > 0 ? ((entry.value / pieTotal) * 100).toFixed(0) : 0}%
                  </span>
                </div>
              ))}
              <div className="pt-1.5 mt-1 border-t border-warm-100 flex justify-between text-xs font-semibold text-gray-900">
                <span>Totalt</span>
                <span className="tabular-nums">{formatCurrency(pieTotal)}</span>
              </div>
            </div>
          </div>
        )}
      </Card>
    </div>
  )
}

function SummaryStat({ label, value, tone }: { label: string; value: number; tone: 'income' | 'expense' }) {
  return (
    <div className="bg-white border border-warm-200 rounded-xl px-3 py-2.5">
      <p className="text-[11px] text-gray-400 mb-0.5 truncate">{label}</p>
      <p className={`text-base font-semibold tabular-nums ${tone === 'income' ? 'text-emerald-700' : 'text-gray-900'}`}>
        {formatCurrency(value)}
      </p>
    </div>
  )
}

function BudgetBarTooltip({
  active, payload, label, nameMap,
}: {
  active?: boolean
  payload?: Array<{ name: string; dataKey: string; value: number; fill: string }>
  label?: string
  nameMap: Map<string, string>
}) {
  if (!active || !payload?.length || !label) return null
  const income = payload.find((p) => p.dataKey === 'Inkomst')?.value ?? 0
  const expenseRows = payload.filter((p) => p.dataKey !== 'Inkomst' && p.value > 0)
  const expenseTotal = expenseRows.reduce((s, p) => s + p.value, 0)
  return (
    <div className="bg-white border border-gray-100 shadow-lg rounded-xl px-4 py-3 text-sm min-w-[200px]">
      <p className="font-semibold text-gray-800 mb-1">{label}</p>
      {[...expenseRows].reverse().map((p) => (
        <p key={p.dataKey} className="flex items-center justify-between gap-4 text-gray-600">
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-sm inline-block shrink-0" style={{ background: p.fill }} />
            {nameMap.get(p.dataKey) ?? p.name}
          </span>
          <span className="tabular-nums">{formatCurrency(p.value)}</span>
        </p>
      ))}
      <div className="mt-1.5 pt-1.5 border-t border-gray-100 flex justify-between font-semibold text-gray-800">
        <span>Utgifter</span>
        <span className="tabular-nums">{formatCurrency(expenseTotal)}</span>
      </div>
      <div className="flex justify-between text-gray-600 mt-0.5">
        <span>Inkomst</span>
        <span className="tabular-nums text-emerald-700">{formatCurrency(income)}</span>
      </div>
      <div className="flex justify-between font-semibold text-gray-800 mt-0.5">
        <span>Kvar</span>
        <span className="tabular-nums">{formatCurrency(income - expenseTotal)}</span>
      </div>
    </div>
  )
}
