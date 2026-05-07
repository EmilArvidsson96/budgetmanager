import { useState } from 'react'
import { ChevronLeft, ChevronRight, Plus, Download } from 'lucide-react'
import { useAppStore } from '@/store'
import { Layout, PageHeader } from '@/components/layout/Layout'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { AmountInput } from '@/components/ui/AmountInput'
import { Badge } from '@/components/ui/Badge'
import { Dialog, OptionRow } from '@/components/ui/Dialog'
import {
  MONTH_NAMES_SHORT,
  makeMonthId,
  formatCurrencyCompact,
  formatCurrency,
  createBlankYearlyBudget,
  createYearlyBudgetFromPrevYearBudget,
  createYearlyBudgetFromActuals,
  calcYearlyActualTotal,
} from '@/utils/budgetHelpers'
import { exportToExcel } from '@/utils/excelExport'

type YearInitMode = 'prev-budget' | 'prev-actuals' | 'blank'

export function YearlyBudgetView() {
  const [year, setYear] = useState(new Date().getFullYear())
  const [exporting, setExporting] = useState(false)
  const [showInitDialog, setShowInitDialog] = useState(false)
  const [initMode, setInitMode] = useState<YearInitMode>('prev-budget')
  const store = useAppStore()
  const { settings, yearlyBudgets, monthlyBudgets, actuals } = store
  const { categories } = settings

  const yb = yearlyBudgets[String(year)]

  const prevYearlyBudget = yearlyBudgets[String(year - 1)]
  const hasPrevYearActuals = Array.from({ length: 12 }, (_, i) =>
    actuals[makeMonthId(year - 1, i + 1)]
  ).some(Boolean)

  const confirmInitYearly = () => {
    let newBudget
    if (initMode === 'prev-budget' && prevYearlyBudget) {
      newBudget = createYearlyBudgetFromPrevYearBudget(year, categories, prevYearlyBudget)
    } else if (initMode === 'prev-actuals' && hasPrevYearActuals) {
      newBudget = createYearlyBudgetFromActuals(year, categories, actuals, year - 1)
    } else {
      newBudget = createBlankYearlyBudget(year, categories)
    }
    store.upsertYearlyBudget(newBudget)
    setShowInitDialog(false)
  }

  const updateAnnualAmount = (catId: string, amount: number) => {
    if (!yb) return
    const cats = yb.categories.map((c) =>
      c.categoryId === catId ? { ...c, annualAmount: amount } : c
    )
    store.upsertYearlyBudget({ ...yb, categories: cats })
  }

  const handleExport = async () => {
    setExporting(true)
    try {
      await exportToExcel({ ...store }, year)
    } finally {
      setExporting(false)
    }
  }

  const months = Array.from({ length: 12 }, (_, i) => i + 1)

  return (
    <Layout>
      <PageHeader
        title="Årsbudget"
        subtitle={`Översikt för ${year}`}
        actions={
          <Button variant="secondary" size="sm" onClick={handleExport} loading={exporting}>
            <Download className="w-4 h-4" /> Exportera Excel
          </Button>
        }
      />

      {/* Year navigator */}
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => setYear((y) => y - 1)} className="p-1.5 rounded-lg hover:bg-gray-200 transition-colors">
          <ChevronLeft className="w-5 h-5 text-gray-600" />
        </button>
        <h2 className="text-lg font-semibold text-gray-800 min-w-16 text-center">{year}</h2>
        <button onClick={() => setYear((y) => y + 1)} className="p-1.5 rounded-lg hover:bg-gray-200 transition-colors">
          <ChevronRight className="w-5 h-5 text-gray-600" />
        </button>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 mb-4 text-xs text-gray-500">
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded bg-brand-100 border border-brand-300 inline-block" />
          Detaljerad månadsbudget
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded bg-gray-100 border border-gray-300 inline-block" />
          Årsallokering (÷12)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded bg-green-100 border border-green-300 inline-block" />
          Verkligt utfall
        </span>
      </div>

      {!yb && (
        <Card className="text-center py-12">
          <p className="text-gray-500 mb-4">Ingen årsbudget skapad för {year}.</p>
          <Button onClick={() => {
            if (prevYearlyBudget) setInitMode('prev-budget')
            else if (hasPrevYearActuals) setInitMode('prev-actuals')
            else setInitMode('blank')
            setShowInitDialog(true)
          }}>
            <Plus className="w-4 h-4" /> Skapa årsbudget
          </Button>
        </Card>
      )}

      {showInitDialog && (
        <Dialog
          title="Skapa årsbudget"
          description={`Välj vad ${year} års budget ska baseras på.`}
          onClose={() => setShowInitDialog(false)}
        >
          <div className="flex flex-col gap-2 mb-5">
            <OptionRow
              label={`Föregående årets budget (${year - 1})`}
              sublabel={prevYearlyBudget ? undefined : 'Ingen årsbudget för föregående år'}
              selected={initMode === 'prev-budget'}
              disabled={!prevYearlyBudget}
              onClick={() => setInitMode('prev-budget')}
            />
            <OptionRow
              label={`Föregående årets utfall (${year - 1})`}
              sublabel={hasPrevYearActuals ? undefined : 'Inga utfall registrerade för föregående år'}
              selected={initMode === 'prev-actuals'}
              disabled={!hasPrevYearActuals}
              onClick={() => setInitMode('prev-actuals')}
            />
            <OptionRow
              label="Tom budget"
              sublabel="Alla kategorier börjar på 0 kr"
              selected={initMode === 'blank'}
              onClick={() => setInitMode('blank')}
            />
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="secondary" onClick={() => setShowInitDialog(false)}>Avbryt</Button>
            <Button onClick={confirmInitYearly}>Skapa</Button>
          </div>
        </Dialog>
      )}

      {yb && (
        <Card padding={false} className="overflow-auto">
          {/* Sticky header */}
          <div className="sticky top-0 z-10 bg-gray-900 text-white">
            <div
              className="grid text-xs font-semibold uppercase tracking-wide px-4 py-2.5"
              style={{ gridTemplateColumns: `220px 110px repeat(12, 80px) 110px 110px` }}
            >
              <div>Kategori</div>
              <div className="text-right">Årsbudget</div>
              {MONTH_NAMES_SHORT.map((m) => (
                <div key={m} className="text-center">{m}</div>
              ))}
              <div className="text-right">YTD Utfall</div>
              <div className="text-right">Avvikelse</div>
            </div>
          </div>

          {/* Rows */}
          {categories.map((cat) => {
            const yc = yb.categories.find((c) => c.categoryId === cat.id)
            const annualBudget = yc?.annualAmount ?? 0
            const ytdActual = calcYearlyActualTotal(store, year, cat.id)
            const variance = ytdActual - annualBudget

            return (
              <div key={cat.id} className="border-b border-gray-100 last:border-0">
                <div
                  className="grid items-center px-4 py-2.5 hover:bg-gray-50"
                  style={{ gridTemplateColumns: `220px 110px repeat(12, 80px) 110px 110px` }}
                >
                  {/* Category name */}
                  <div className="flex items-center gap-2 min-w-0">
                    <div
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: cat.color ?? '#94a3b8' }}
                    />
                    <span className="text-sm font-medium text-gray-800 truncate">{cat.name}</span>
                    <Badge
                      variant={cat.type === 'income' ? 'green' : cat.type === 'savings' ? 'blue' : 'gray'}
                      size="sm"
                    >
                      {cat.type === 'income' ? 'In' : cat.type === 'savings' ? 'Spar' : 'Ut'}
                    </Badge>
                  </div>

                  {/* Annual budget input */}
                  <div>
                    <AmountInput
                      value={annualBudget}
                      onChange={(a) => updateAnnualAmount(cat.id, a)}
                      className="w-full"
                      defaultNegative={cat.type !== 'income'}
                    />
                  </div>

                  {/* Month columns */}
                  {months.map((m) => {
                    const mid = makeMonthId(year, m)
                    const mb = monthlyBudgets[mid]
                    const act = actuals[mid]
                    const isDetailed = !!mb
                    const monthBudget = mb
                      ? (mb.categories.find((c) => c.categoryId === cat.id)?.amount ?? 0)
                      : annualBudget > 0 ? Math.round(annualBudget / 12) : null
                    const monthActual = act
                      ? act.entries.filter((e) => e.categoryId === cat.id).reduce((s, e) => s + e.totalAmount, 0)
                      : null

                    return (
                      <div key={m} className="text-center">
                        <div
                          className={`text-xs font-medium rounded px-1 py-0.5 mx-0.5
                            ${isDetailed ? 'bg-brand-100 text-brand-800' : 'text-gray-500'}`}
                          title={isDetailed ? 'Detaljerad månadsbudget' : 'Årsallokering'}
                        >
                          {monthBudget !== null ? formatCurrencyCompact(monthBudget) : '–'}
                        </div>
                        {monthActual !== null && (
                          <div className="text-xs text-green-700 bg-green-50 rounded px-1 py-0.5 mx-0.5 mt-0.5">
                            {formatCurrencyCompact(monthActual)}
                          </div>
                        )}
                      </div>
                    )
                  })}

                  {/* YTD actual */}
                  <div className="text-right text-sm font-medium text-gray-700">
                    {formatCurrency(ytdActual)}
                  </div>

                  {/* Variance */}
                  <div className="text-right text-sm font-medium">
                    {annualBudget !== 0 ? (
                      <span className={variance < 0 ? 'text-red-600' : 'text-green-600'}>
                        {formatCurrency(variance, true)}
                      </span>
                    ) : '–'}
                  </div>
                </div>
              </div>
            )
          })}
        </Card>
      )}
    </Layout>
  )
}
