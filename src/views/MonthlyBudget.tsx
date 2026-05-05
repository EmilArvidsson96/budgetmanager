import { useState } from 'react'
import { ChevronLeft, ChevronRight, Plus, Download } from 'lucide-react'
import { useAppStore } from '@/store'
import { Layout, PageHeader } from '@/components/layout/Layout'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { AmountInput } from '@/components/ui/AmountInput'
import { ProgressBar } from '@/components/ui/ProgressBar'
import {
  MONTH_NAMES_LONG,
  makeMonthId,
  formatCurrency,
  calcBudgetTotals,
  calcActualTotals,
  createBlankMonthlyBudget,
} from '@/utils/budgetHelpers'
import { exportToExcel } from '@/utils/excelExport'
import type { CategoryDef, SubcategoryBudget } from '@/types'

export function MonthlyBudgetView() {
  const today = new Date()
  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth() + 1)
  const [expandedCats, setExpandedCats] = useState<Set<string>>(new Set())
  const [exporting, setExporting] = useState(false)

  const store = useAppStore()
  const { settings, monthlyBudgets, actuals } = store
  const { categories, recurringItems } = settings

  const monthId = makeMonthId(year, month)
  const budget = monthlyBudgets[monthId]
  const actual = actuals[monthId]

  const prevMonth = () => {
    if (month === 1) { setMonth(12); setYear((y) => y - 1) }
    else setMonth((m) => m - 1)
  }
  const nextMonth = () => {
    if (month === 12) { setMonth(1); setYear((y) => y + 1) }
    else setMonth((m) => m + 1)
  }

  const initBudget = () => {
    const prevId = makeMonthId(month === 1 ? year - 1 : year, month === 1 ? 12 : month - 1)
    const prev = monthlyBudgets[prevId]
    store.upsertMonthlyBudget(createBlankMonthlyBudget(year, month, categories, recurringItems, prev))
  }

  const updateCatAmount = (catId: string, amount: number) => {
    if (!budget) return
    const cats = budget.categories.map((c) =>
      c.categoryId === catId ? { ...c, amount } : c
    )
    store.updateMonthlyCategories(monthId, cats)
  }

  const updateSubAmount = (catId: string, subId: string, amount: number) => {
    if (!budget) return
    const cats = budget.categories.map((c) => {
      if (c.categoryId !== catId) return c
      const subcategories: SubcategoryBudget[] = c.subcategories.map((s) =>
        s.subcategoryId === subId ? { ...s, amount } : s
      )
      const catAmount = subcategories.reduce((sum, s) => sum + s.amount, 0)
      return { ...c, amount: catAmount, subcategories }
    })
    store.updateMonthlyCategories(monthId, cats)
  }

  const toggleCat = (catId: string) => {
    setExpandedCats((prev) => {
      const next = new Set(prev)
      if (next.has(catId)) next.delete(catId)
      else next.add(catId)
      return next
    })
  }

  const handleExport = async () => {
    setExporting(true)
    try {
      await exportToExcel({ ...store }, year)
    } finally {
      setExporting(false)
    }
  }

  const budgetTotals = budget ? calcBudgetTotals(budget, categories) : null
  const actualTotals = actual ? calcActualTotals(actual, categories) : null

  return (
    <Layout>
      <PageHeader
        title="Månadsbudget"
        actions={
          <Button variant="secondary" size="sm" onClick={handleExport} loading={exporting}>
            <Download className="w-4 h-4" /> Exportera
          </Button>
        }
      />

      {/* Month navigator */}
      <div className="flex items-center gap-1 mb-8">
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

      {/* Summary cards */}
      {(budgetTotals || actualTotals) && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
          <SummaryCard
            label="Inkomster"
            value={budgetTotals?.totalIncome ?? 0}
            actual={actualTotals?.totalIncome}
            variant="green"
          />
          <SummaryCard
            label="Utgifter"
            value={budgetTotals?.totalExpense ?? 0}
            actual={actualTotals?.totalExpense}
            variant="red"
          />
          <SummaryCard
            label="Sparande"
            value={budgetTotals?.totalSavings ?? 0}
            actual={actualTotals?.totalSavings}
            variant="blue"
          />
          <SummaryCard
            label="Nettoresultat"
            value={budgetTotals?.netBalance ?? 0}
            actual={actualTotals?.netBalance}
            variant={budgetTotals && budgetTotals.netBalance >= 0 ? 'green' : 'red'}
          />
        </div>
      )}

      {/* No budget yet */}
      {!budget && (
        <Card className="text-center py-16">
          <p className="text-gray-400 mb-5 text-sm">
            Ingen budget planerad för {MONTH_NAMES_LONG[month - 1]} {year}.
          </p>
          <Button onClick={initBudget}>
            <Plus className="w-4 h-4" /> Skapa månadsbudget
          </Button>
        </Card>
      )}

      {/* Budget table */}
      {budget && (
        <Card padding={false} className="overflow-hidden">
          <div className="overflow-x-auto">
            <div className="min-w-[760px]">
              {/* Table header */}
              <div className="grid grid-cols-[1fr_150px_150px_130px_120px] bg-gray-50 border-b border-gray-100 px-5 py-2.5 text-[11px] font-semibold text-gray-400 uppercase tracking-widest">
                <div>Kategori</div>
                <div className="text-right">Budget</div>
                <div className="text-right">Utfall</div>
                <div className="text-right">Avvikelse</div>
                <div className="text-right pr-1">Förbrukat</div>
              </div>

              {categories.map((cat) => (
                <CategorySection
                  key={cat.id}
                  cat={cat}
                  budget={budget.categories.find((c) => c.categoryId === cat.id)}
                  actual={actual}
                  expanded={expandedCats.has(cat.id)}
                  onToggle={() => toggleCat(cat.id)}
                  onCatAmountChange={(a) => updateCatAmount(cat.id, a)}
                  onSubAmountChange={(subId, a) => updateSubAmount(cat.id, subId, a)}
                />
              ))}
            </div>
          </div>
        </Card>
      )}
    </Layout>
  )
}

// ─── Category section ─────────────────────────────────────────────────────────

interface CategorySectionProps {
  cat: CategoryDef
  budget: { amount: number; subcategories: SubcategoryBudget[] } | undefined
  actual: import('@/types').MonthlyActuals | undefined
  expanded: boolean
  onToggle: () => void
  onCatAmountChange: (a: number) => void
  onSubAmountChange: (subId: string, a: number) => void
}

function CategorySection({
  cat, budget, actual, expanded, onToggle,
  onCatAmountChange, onSubAmountChange,
}: CategorySectionProps) {
  const budgetAmt = budget?.amount ?? 0
  const actualAmt = actual
    ? actual.entries.filter((e: import('@/types').ActualEntry) => e.categoryId === cat.id).reduce((s: number, e: import('@/types').ActualEntry) => s + e.totalAmount, 0)
    : null

  const variance = actualAmt !== null ? actualAmt - budgetAmt : null
  const isOverBudget = variance !== null && cat.type !== 'income' && variance > 0
  const hasSubcategories = cat.subcategories.length > 0

  return (
    <div className="border-b border-gray-50 last:border-0">
      {/* Category row */}
      <div
        className={`grid grid-cols-[1fr_150px_150px_130px_120px] px-5 py-3.5 items-center
          hover:bg-gray-50/60 transition-colors cursor-pointer select-none`}
        onClick={hasSubcategories ? onToggle : undefined}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          {hasSubcategories && (
            <ChevronRight
              className={`w-3.5 h-3.5 text-gray-300 transition-transform duration-200 shrink-0 ${expanded ? 'rotate-90' : ''}`}
            />
          )}
          {!hasSubcategories && <div className="w-3.5 shrink-0" />}
          <div
            className="w-2 h-2 rounded-full shrink-0"
            style={{ backgroundColor: cat.color ?? '#94a3b8' }}
          />
          <span className="font-medium text-sm text-gray-800 truncate">{cat.name}</span>
          <Badge variant={cat.type === 'income' ? 'green' : cat.type === 'savings' ? 'blue' : 'gray'} size="sm">
            {cat.type === 'income' ? 'Inkomst' : cat.type === 'savings' ? 'Spar' : 'Utgift'}
          </Badge>
        </div>

        <div className="text-right" onClick={(e) => e.stopPropagation()}>
          <AmountInput value={budgetAmt} onChange={onCatAmountChange} className="w-full" />
        </div>

        <div className="text-right text-sm tabular-nums">
          {actualAmt !== null ? (
            <span className="text-gray-700 font-medium">{formatCurrency(actualAmt)}</span>
          ) : (
            <span className="text-gray-200">–</span>
          )}
        </div>

        <div className="text-right text-sm tabular-nums">
          {variance !== null ? (
            <span className={`font-medium ${isOverBudget ? 'text-red-500' : 'text-emerald-600'}`}>
              {formatCurrency(variance, true)}
            </span>
          ) : (
            <span className="text-gray-200">–</span>
          )}
        </div>

        <div className="pl-3 pr-1">
          {actualAmt !== null && budgetAmt > 0 && (
            <ProgressBar value={actualAmt} max={budgetAmt} />
          )}
        </div>
      </div>

      {/* Subcategory rows */}
      {expanded && hasSubcategories && (
        <div className="bg-gray-50/40">
          {cat.subcategories.map((sub) => {
            const subBudget = budget?.subcategories.find((s) => s.subcategoryId === sub.id)?.amount ?? 0
            const subActual = actual
              ? actual.entries
                  .filter((e: import('@/types').ActualEntry) => e.categoryId === cat.id && e.subcategoryId === sub.id)
                  .reduce((s: number, e: import('@/types').ActualEntry) => s + e.totalAmount, 0)
              : null
            const subVariance = subActual !== null ? subActual - subBudget : null

            return (
              <div
                key={sub.id}
                className="grid grid-cols-[1fr_150px_150px_130px_120px] px-5 py-2.5 items-center border-t border-gray-100/60"
              >
                <div className="pl-9 text-sm text-gray-500">{sub.name}</div>
                <div className="text-right">
                  <AmountInput
                    value={subBudget}
                    onChange={(a) => onSubAmountChange(sub.id, a)}
                    className="w-full"
                  />
                </div>
                <div className="text-right text-sm text-gray-500 tabular-nums">
                  {subActual !== null ? formatCurrency(subActual) : '–'}
                </div>
                <div className="text-right text-sm tabular-nums">
                  {subVariance !== null ? (
                    <span className={subVariance > 0 && cat.type !== 'income' ? 'text-red-500' : 'text-emerald-600'}>
                      {formatCurrency(subVariance, true)}
                    </span>
                  ) : '–'}
                </div>
                <div className="pl-3 pr-1">
                  {subActual !== null && subBudget > 0 && (
                    <ProgressBar value={subActual} max={subBudget} />
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── Summary card ─────────────────────────────────────────────────────────────

function SummaryCard({
  label, value, actual, variant,
}: {
  label: string
  value: number
  actual?: number | null
  variant: 'green' | 'red' | 'blue'
}) {
  const topBorder = {
    green: 'border-t-emerald-400',
    red:   'border-t-red-400',
    blue:  'border-t-brand-500',
  }
  const valueColor = {
    green: 'text-emerald-700',
    red:   'text-red-600',
    blue:  'text-brand-700',
  }
  return (
    <div className={`bg-white border border-gray-100 border-t-2 ${topBorder[variant]} rounded-xl p-4`}>
      <div className="text-[11px] font-medium text-gray-400 uppercase tracking-wide mb-2">{label}</div>
      <div className={`text-xl font-semibold tabular-nums tracking-tight ${valueColor[variant]}`}>
        {formatCurrency(value)}
      </div>
      {actual !== null && actual !== undefined && (
        <div className="text-[11px] text-gray-400 mt-1.5 tabular-nums">
          Utfall: {formatCurrency(actual)}
        </div>
      )}
    </div>
  )
}
