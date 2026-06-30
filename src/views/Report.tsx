import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Sparkles, Printer, FileText } from 'lucide-react'
import { Layout, PageHeader } from '@/components/layout/Layout'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'
import { useAppStore } from '@/store'
import { buildMonthlyReport, availableReportMonths } from '@/utils/report'
import { generateReportSummary, templateSummary } from '@/utils/reportNarrative'
import { MonthlyReportCard } from '@/components/report/MonthlyReportCard'

export function ReportView() {
  const store = useAppStore()
  const apiKey = store.settings.anthropicApiKey

  const months = useMemo(() => availableReportMonths(store), [store.actuals])
  const [monthId, setMonthId] = useState(() => months[0]?.id ?? '')

  // Keep a valid selection if the available months change underneath us.
  const activeMonthId = months.some((m) => m.id === monthId) ? monthId : months[0]?.id ?? ''

  const report = useMemo(
    () => buildMonthlyReport(store, activeMonthId),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [store.actuals, store.budgetBaseline, store.budgetOverrides, store.budgetHistory, store.monthlyBudgets, store.yearlyBudgets, store.settings, store.liquidityPlans, store.importSnapshots, store.allTransactions, store.wealthForecasts, activeMonthId]
  )

  // Save this period's 2-year forecast (once per period) so next month's report can
  // compare against it. Writes only the current period, leaving prior ones frozen.
  const outlookPeriod = report.wealthOutlook?.points[0]?.monthId
  useEffect(() => {
    const o = report.wealthOutlook
    if (!o || o.points.length === 0) return
    store.captureWealthForecast({
      takenForPeriod: o.points[0].monthId,
      takenAt: new Date().toISOString(),
      horizon: o.points.length - 1,
      points: o.points.map((p) => ({ monthId: p.monthId, netWorth: p.netWorth })),
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outlookPeriod])

  const [aiSummary, setAiSummary] = useState<{ month: string; text: string } | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const summary =
    aiSummary && aiSummary.month === activeMonthId ? aiSummary.text : templateSummary(report)

  async function handleGenerate() {
    if (!apiKey) return
    setLoading(true)
    setError(null)
    try {
      const text = await generateReportSummary(report, apiKey)
      setAiSummary({ month: activeMonthId, text })
    } catch {
      setError('Kunde inte nå Claude just nu – visar standardtexten istället.')
    } finally {
      setLoading(false)
    }
  }

  function handlePrint() {
    const prev = document.title
    document.title = `Månadsrapport ${report.title}`
    window.print()
    // Restore after the print dialog yields control back.
    setTimeout(() => {
      document.title = prev
    }, 500)
  }

  if (months.length === 0) {
    return (
      <Layout>
        <PageHeader title="Rapport" subtitle="En enkel månadssammanfattning att dela" />
        <Card className="text-center py-16 text-gray-500">
          <FileText className="w-8 h-8 mx-auto mb-3 text-gray-300" />
          <p className="font-medium text-gray-700">Ingen månad att rapportera ännu</p>
          <p className="text-sm mt-1">
            Importera transaktioner i <Link to="/floede" className="text-brand-600 hover:underline">Flöde</Link> så
            dyker varje månad upp här.
          </p>
        </Card>
      </Layout>
    )
  }

  return (
    <Layout>
      <PageHeader
        title="Rapport"
        subtitle="En enkel månadssammanfattning att dela"
        actions={
          <div className="no-print flex flex-wrap items-center gap-2">
            <Select
              className="w-40"
              value={activeMonthId}
              onChange={(e) => {
                setMonthId(e.target.value)
                setError(null)
              }}
              options={months.map((m) => ({ value: m.id, label: m.label }))}
            />
            <Button
              variant="secondary"
              onClick={handleGenerate}
              loading={loading}
              disabled={!apiKey || !report.hasData}
              title={apiKey ? 'Låt Claude skriva sammanfattningen' : 'Lägg till din Anthropic-nyckel i Inställningar'}
            >
              <Sparkles className="w-4 h-4" />
              {aiSummary?.month === activeMonthId ? 'Skriv om' : 'AI-sammanfattning'}
            </Button>
            <Button onClick={handlePrint} disabled={!report.hasData}>
              <Printer className="w-4 h-4" />
              Ladda ner PDF
            </Button>
          </div>
        }
      />

      {!apiKey && (
        <p className="no-print text-xs text-gray-400 -mt-4 mb-5">
          Tips: lägg till din Anthropic-nyckel i{' '}
          <Link to="/installningar" className="text-brand-600 hover:underline">Inställningar</Link> så kan Claude
          skriva sammanfattningen. Annars används en automatisk text.
        </p>
      )}

      {error && (
        <p className="no-print text-xs text-brand-600 -mt-4 mb-5">{error}</p>
      )}

      {report.hasData ? (
        <MonthlyReportCard report={report} summary={summary} />
      ) : (
        <Card className="text-center py-16 text-gray-500">
          Ingen data för {report.title}.
        </Card>
      )}
    </Layout>
  )
}
