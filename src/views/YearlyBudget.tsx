import { useState, useMemo } from 'react'
import { ChevronLeft, ChevronRight, Plus, Download, Trash2, TrendingUp } from 'lucide-react'
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

function linReg(points: [number, number][]): (x: number) => number {
  const n = points.length
  if (n === 0) return () => 0
  if (n === 1) return () => points[0][1]
  const meanX = points.reduce((s, [x]) => s + x, 0) / n
  const meanY = points.reduce((s, [, y]) => s + y, 0) / n
  const num = points.reduce((s, [x, y]) => s + (x - meanX) * (y - meanY), 0)
  const den = points.reduce((s, [x]) => s + (x - meanX) ** 2, 0)
  const slope = den === 0 ? 0 : num / den
  const intercept = meanY - slope * meanX
  return (x: number) => slope * x + intercept
}

export function YearlyBudgetView() {
  const [year, setYear] = useState(new Date().getFullYear())
  const [exporting, setExporting] = useState(false)
  const [showInitDialog, setShowInitDialog] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [initMode, setInitMode] = useState<YearInitMode>('prev-budget')
  const [showForecast, setShowForecast] = useState(false)
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

  // Linear regression forecast — one predictor per category based on months with actuals
  const forecastData = useMemo(() => {
    if (!showForecast) return null
    return new Map(
      categories.map((cat) => {
        const points: [number, number][] = []
        for (let m = 1; m <= 12; m++) {
          const act = actuals[makeMonthId(year, m)]
          if (act) {
            const amt = act.entries
              .filter((e) => e.categoryId === cat.id)
              .reduce((s, e) => s + e.totalAmount, 0)
            points.push([m, amt])
          }
        }
        return [cat.id, { predict: linReg(points), hasData: points.length >= 1 }] as const
      })
    )
  }, [showForecast, categories, actuals, year])

  const getForecast = (catId: string, month: number): number | null => {
    if (!forecastData) return null
    if (actuals[makeMonthId(year, month)]) return null  // already has actual
    const fd = forecastData.get(catId)
    if (!fd?.hasData) return null
    return fd.predict(month)
  }

  const getFullYearForecast = (catId: string): number | null => {
    if (!forecastData) return null
    const fd = forecastData.get(catId)
    if (!fd?.hasData) return null
    let total = 0
    for (let m = 1; m <= 12; m++) {
      const act = actuals[makeMonthId(year, m)]
      if (act) {
        total += act.entries
          .filter((e) => e.categoryId === catId)
          .reduce((s, e) => s + e.totalAmount, 0)
      } else {
        total += fd.predict(m)
      }
    }
    return Math.round(total)
  }

  const months = Array.from({ length: 12 }, (_, i) => i + 1)

  return (
    <Layout>
      <PageHeader
        title="Årsbudget"
        subtitle={`Översikt för ${year}`}
        actions={
          <div className="flex gap-2">
            {yb && (
              <Button variant="secondary" size="sm" onClick={() => setShowDeleteDialog(true)}>
                <Trash2 className="w-4 h-4" /> Ta bort budget
              </Button>
            )}
            <Button variant="secondary" size="sm" onClick={handleExport} loading={exporting}>
              <Download className="w-4 h-4" /> Exportera Excel
            </Button>
          </div>
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

      {/* Legend + forecast toggle */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex flex-wrap items-center gap-4 text-xs text-gray-500">
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
          {showForecast && (
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded bg-amber-100 border border-amber-300 inline-block" />
              Prognos (linjär regression)
            </span>
          )}
        </div>
        {yb && (
          <Button
            variant={showForecast ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => setShowForecast((v) => !v)}
          >
            <TrendingUp className="w-4 h-4" />
            {showForecast ? 'Dölj prognos' : 'Visa prognos'}
          </Button>
        )}
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

      {showDeleteDialog && (
        <Dialog
          title="Ta bort årsbudget"
          description={`Är du säker på att du vill ta bort årsbudgeten för ${year}? Detta går inte att ångra.`}
          onClose={() => setShowDeleteDialog(false)}
        >
          <div className="flex gap-2 justify-end">
            <Button variant="secondary" onClick={() => setShowDeleteDialog(false)}>Avbryt</Button>
            <Button variant="danger" onClick={() => { store.removeYearlyBudget(String(year)); setShowDeleteDialog(false) }}>Ta bort</Button>
          </div>
        </Dialog>
      )}

      {yb && (
        <Card padding={false} className="overflow-auto max-h-[calc(100vh-20rem)]">
          <table className="border-collapse" style={{ minWidth: 1510 }}>
            <thead>
              <tr className="bg-gray-900 text-white text-xs font-semibold uppercase tracking-wide">
                <th scope="col" className="sticky top-0 left-0 z-30 bg-gray-900 text-left px-4 py-2.5 w-[220px]">
                  Kategori
                </th>
                <th scope="col" className="sticky top-0 z-20 bg-gray-900 text-right px-2 py-2.5 w-[110px]">
                  Årsbudget
                </th>
                {MONTH_NAMES_SHORT.map((m) => (
                  <th key={m} scope="col" className="sticky top-0 z-20 bg-gray-900 text-center px-1 py-2.5 w-[80px]">
                    {m}
                  </th>
                ))}
                <th scope="col" className="sticky top-0 z-20 bg-gray-900 text-right px-2 py-2.5 w-[110px]">
                  {showForecast ? 'Prognos helår' : 'YTD Utfall'}
                </th>
                <th scope="col" className="sticky top-0 z-20 bg-gray-900 text-right px-4 py-2.5 w-[110px]">
                  Avvikelse
                </th>
              </tr>
            </thead>
            <tbody>
              {categories.map((cat) => {
                const yc = yb.categories.find((c) => c.categoryId === cat.id)
                const annualBudget = yc?.annualAmount ?? 0
                const ytdActual = calcYearlyActualTotal(store, year, cat.id)
                const fullYearForecast = getFullYearForecast(cat.id)
                const comparisonAmount =
                  showForecast && fullYearForecast !== null ? fullYearForecast : ytdActual
                const variance = comparisonAmount - annualBudget

                return (
                  <tr key={cat.id} className="border-b border-gray-100 last:border-0 hover:bg-gray-50 group">
                    {/* Sticky category column */}
                    <td className="sticky left-0 z-10 bg-white group-hover:bg-gray-50 px-4 py-2.5 transition-colors">
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
                    </td>

                    {/* Annual budget input */}
                    <td className="px-2 py-2.5">
                      <AmountInput
                        value={annualBudget}
                        onChange={(a) => updateAnnualAmount(cat.id, a)}
                        className="w-full"
                        defaultNegative={cat.type !== 'income'}
                      />
                    </td>

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
                        ? act.entries
                            .filter((e) => e.categoryId === cat.id)
                            .reduce((s, e) => s + e.totalAmount, 0)
                        : null
                      const forecast = getForecast(cat.id, m)

                      return (
                        <td key={m} className="px-1 py-2.5 text-center">
                          <div
                            className={`text-xs font-medium rounded px-1 py-0.5 mx-0.5 ${
                              isDetailed ? 'bg-brand-100 text-brand-800' : 'text-gray-500'
                            }`}
                            title={isDetailed ? 'Detaljerad månadsbudget' : 'Årsallokering'}
                          >
                            {monthBudget !== null ? formatCurrencyCompact(monthBudget) : '–'}
                          </div>
                          {monthActual !== null && (
                            <div className="text-xs text-green-700 bg-green-50 rounded px-1 py-0.5 mx-0.5 mt-0.5">
                              {formatCurrencyCompact(monthActual)}
                            </div>
                          )}
                          {forecast !== null && (
                            <div
                              className="text-xs text-amber-700 bg-amber-50 rounded px-1 py-0.5 mx-0.5 mt-0.5 italic"
                              title="Extrapolerat via linjär regression"
                            >
                              ~{formatCurrencyCompact(Math.round(forecast))}
                            </div>
                          )}
                        </td>
                      )
                    })}

                    {/* Full-year forecast or YTD actual */}
                    <td className="px-2 py-2.5 text-right text-sm font-medium">
                      {showForecast && fullYearForecast !== null ? (
                        <span className="text-amber-700">{formatCurrency(fullYearForecast)}</span>
                      ) : (
                        <span className="text-gray-700">{formatCurrency(ytdActual)}</span>
                      )}
                    </td>

                    {/* Variance */}
                    <td className="px-4 py-2.5 text-right text-sm font-medium">
                      {annualBudget !== 0 ? (
                        <span className={variance < 0 ? 'text-red-600' : 'text-green-600'}>
                          {formatCurrency(variance, true)}
                        </span>
                      ) : '–'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </Card>
      )}
    </Layout>
  )
}
