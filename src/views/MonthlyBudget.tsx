import { useState } from 'react'
import { ChevronLeft, ChevronRight, Plus, Download, ChevronDown, ChevronUp } from 'lucide-react'
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
        subtitle={`${MONTH_NAMES_LONG[month - 1]} ${year}`}
        actions={
          <Button variant="secondary" size="sm" onClick={handleExport} loading={exporting}>
            <Download className="w-4 h-4" /> Exportera Excel
          </Button>
        }
      />

      {/* Month navigator */}
      <div className="flex items-center gap-3 mb-6">
        <button onClick={prevMonth} className="p-1.5 rounded-lg hover:bg-gray-200 transition-colors">
          <ChevronLeft className="w-5 h-5 text-gray-600" />
        </button>
        <h2 className="text-lg font-semibold text-gray-800 min-w-40 text-center">
          {MONTH_NAMES_LONG[month - 1]} {year}
        </h2>
        <button onClick={nextMonth} className="p-1.5 rounded-lg hover:bg-gray-200 transition-colors">
          <ChevronRight className="w-5 h-5 text-gray-600" />
        </button>
      </div>

      {/* Summary cards */}
      {(budgetTotals || actualTotals) && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <SummaryCard
            label="Budgeterade inkomster"
            value={budgetTotals?.totalIncome ?? 0}
            actual={actualTotals?.totalIncome}
            variant="green"
          />
          <SummaryCard
            label="Budgeterade utgifter"
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
        <Card className="text-center py-12">
          <p className="text-gray-500 mb-4">
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
          {/* Table header */}
          <div className="grid grid-cols-[1fr_160px_160px_160px_160px] gap-0 bg-gray-50 border-b border-gray-200 px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide">
            <div>Kategori</div>
            <div className="text-right">Budget</div>
            <div className="text-right">Utfall</div>
            <div className="text-right">Avvikelse</div>
            <div className="text-right">Förbrukat</div>
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
    <div className="border-b border-gray-100 last:border-0">
      {/* Category row */}
      <div
        className={`grid grid-cols-[1fr_160px_160px_160px_160px] gap-0 px-4 py-3 items-center
          hover:bg-gray-50 transition-colors group cursor-pointer`}
        onClick={hasSubcategories ? onToggle : undefined}
      >
        <div className="flex items-center gap-2">
          {hasSubcategories && (
            <button className="text-gray-400">
              {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
          )}
          <div
            className="w-2.5 h-2.5 rounded-full shrink-0"
            style={{ backgroundColor: cat.color ?? '#94a3b8' }}
          />
          <span className="font-medium text-sm text-gray-800">{cat.name}</span>
          {!hasSubcategories && (
            <Badge variant={cat.type === 'income' ? 'green' : cat.type === 'savings' ? 'blue' : 'gray'} size="sm">
              {cat.type === 'income' ? 'Inkomst' : cat.type === 'savings' ? 'Sparande' : 'Utgift'}
            </Badge>
          )}
        </div>

        <div className="text-right" onClick={(e) => e.stopPropagation()}>
          <AmountInput
            value={budgetAmt}
            onChange={onCatAmountChange}
            className="w-full"
          />
        </div>

        <div className="text-right text-sm">
          {actualAmt !== null ? (
            <span className="text-gray-700 font-medium">{formatCurrency(actualAmt)}</span>
          ) : (
            <span className="text-gray-300">–</span>
          )}
        </div>

        <div className="text-right text-sm">
          {variance !== null ? (
            <span className={`font-medium ${isOverBudget ? 'text-red-600' : 'text-green-600'}`}>
              {formatCurrency(variance, true)}
            </span>
          ) : (
            <span className="text-gray-300">–</span>
          )}
        </div>

        <div className="pl-4">
          {actualAmt !== null && budgetAmt > 0 && (
            <ProgressBar value={actualAmt} max={budgetAmt} />
          )}
        </div>
      </div>

      {/* Subcategory rows */}
      {expanded && hasSubcategories && (
        <div className="bg-gray-50/50">
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
                className="grid grid-cols-[1fr_160px_160px_160px_160px] gap-0 px-4 py-2 items-center border-t border-gray-100"
              >
                <div className="pl-8 text-sm text-gray-600">{sub.name}</div>
                <div className="text-right">
                  <AmountInput
                    value={subBudget}
                    onChange={(a) => onSubAmountChange(sub.id, a)}
                    className="w-full"
                  />
                </div>
                <div className="text-right text-sm text-gray-600">
                  {subActual !== null ? formatCurrency(subActual) : '–'}
                </div>
                <div className="text-right text-sm">
                  {subVariance !== null ? (
                    <span className={subVariance > 0 && cat.type !== 'income' ? 'text-red-500' : 'text-green-500'}>
                      {formatCurrency(subVariance, true)}
                    </span>
                  ) : '–'}
                </div>
                <div className="pl-4">
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
  const colors = {
    green: 'text-green-700 bg-green-50 border-green-100',
    red:   'text-red-700 bg-red-50 border-red-100',
    blue:  'text-brand-700 bg-brand-50 border-brand-100',
  }
  return (
    <div className={`rounded-xl border p-4 ${colors[variant]}`}>
      <div className="text-xs font-medium mb-1 opacity-75">{label}</div>
      <div className="text-xl font-bold">{formatCurrency(value)}</div>
      {actual !== null && actual !== undefined && (
        <div className="text-xs mt-1 opacity-75">
          Utfall: {formatCurrency(actual)}
        </div>
      )}
    </div>
  )
}
