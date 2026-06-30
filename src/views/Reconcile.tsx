import { useMemo, useState, useEffect } from 'react'
import { ChevronLeft, ChevronRight, CheckCircle2, AlertTriangle, Lock, Unlock, Tag, ArrowLeftRight } from 'lucide-react'
import { useAppStore } from '@/store'
import { Layout, PageHeader } from '@/components/layout/Layout'
import { Card, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { MONTH_NAMES_LONG, makeMonthId, formatCurrency } from '@/utils/budgetHelpers'
import { budgetedAmount } from '@/utils/projection'
import { reconcileTransfers, reconciledKeysFromRecords } from '@/utils/transferReconciliation'

export function ReconcileView() {
  const today = new Date()
  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth() + 1)
  const store = useAppStore()
  const { settings, actuals, monthCloses, reconciliations, allTransactions } = store
  const { categories } = settings

  const monthId = makeMonthId(year, month)
  const actual = actuals[monthId]
  const close = monthCloses[monthId]

  const [note, setNote] = useState('')
  useEffect(() => { setNote(close?.note ?? '') }, [monthId, close?.note])

  const prevMonth = () => { if (month === 1) { setMonth(12); setYear((y) => y - 1) } else setMonth((m) => m - 1) }
  const nextMonth = () => { if (month === 12) { setMonth(1); setYear((y) => y + 1) } else setMonth((m) => m + 1) }

  // Per-category plan vs actual.
  const rows = useMemo(() => {
    const actualByCat = new Map<string, number>()
    for (const e of actual?.entries ?? []) {
      actualByCat.set(e.categoryId, (actualByCat.get(e.categoryId) ?? 0) + e.totalAmount)
    }
    return categories
      .map((cat) => {
        const budget = Math.abs(budgetedAmount(store, monthId, cat.id))
        const act = Math.abs(actualByCat.get(cat.id) ?? 0)
        return { cat, budget, actual: act }
      })
      .filter((r) => r.budget > 0 || r.actual > 0)
  }, [actual, categories, store, monthId])

  // Outcome totals (actual).
  const totals = useMemo(() => {
    let income = 0, expense = 0, savings = 0
    for (const r of rows) {
      if (r.cat.type === 'income') income += r.actual
      else if (r.cat.type === 'savings') savings += r.actual
      else if (r.cat.type === 'expense') expense += r.actual
    }
    return { income, expense, savings, net: income - expense - savings }
  }, [rows])

  // Planned totals.
  const planned = useMemo(() => {
    let income = 0, expense = 0, savings = 0
    for (const r of rows) {
      if (r.cat.type === 'income') income += r.budget
      else if (r.cat.type === 'savings') savings += r.budget
      else if (r.cat.type === 'expense') expense += r.budget
    }
    return { income, expense, savings, net: income - expense - savings }
  }, [rows])

  // Checklist signals.
  const uncategorizedCount = actual?.entries.find((e) => e.categoryId === 'other')?.transactionCount ?? 0
  const overPlanCount = rows.filter((r) => r.cat.type === 'expense' && r.budget > 0 && r.actual > r.budget).length
  const pendingTransfers = useMemo(() => {
    if (!settings.accounts.some((a) => a.owner?.trim())) return 0
    return reconcileTransfers({
      transactions: allTransactions,
      accounts: settings.accounts,
      partnerName: settings.partnerName,
      alreadyReconciledKeys: reconciledKeysFromRecords(reconciliations),
    }).length
  }, [allTransactions, settings.accounts, settings.partnerName, reconciliations])

  // Has the outcome drifted since the month was closed?
  const drifted = close ? Math.round(close.net) !== Math.round(totals.net) : false

  const doClose = () => {
    store.closeMonth({
      monthId,
      closedAt: new Date().toISOString(),
      note: note.trim() || undefined,
      income: totals.income, expense: totals.expense, savings: totals.savings, net: totals.net,
    })
  }

  const checklist = [
    { icon: Tag, label: 'Okategoriserade poster', count: uncategorizedCount, ok: uncategorizedCount === 0 },
    { icon: ArrowLeftRight, label: 'Väntande överföringar', count: pendingTransfers, ok: pendingTransfers === 0 },
    { icon: AlertTriangle, label: 'Kategorier över plan', count: overPlanCount, ok: overPlanCount === 0, warnOnly: true },
  ]

  return (
    <Layout>
      <PageHeader
        title="Avstämning"
        subtitle="Stäm av månaden mot planen och stäng den."
        actions={
          close ? (
            <Button variant="secondary" size="sm" onClick={() => store.reopenMonth(monthId)}>
              <Unlock className="w-4 h-4" /> Öppna igen
            </Button>
          ) : (
            <Button size="sm" onClick={doClose} disabled={!actual}>
              <Lock className="w-4 h-4" /> Stäng månaden
            </Button>
          )
        }
      />

      {/* Month nav */}
      <div className="flex items-center gap-1 mb-6">
        <button onClick={prevMonth} className="p-2 rounded-lg hover:bg-gray-100 transition-colors text-gray-400 hover:text-gray-700" aria-label="Föregående månad">
          <ChevronLeft className="w-4 h-4" />
        </button>
        <span className="text-base font-medium text-gray-800 min-w-44 text-center tabular-nums">{MONTH_NAMES_LONG[month - 1]} {year}</span>
        <button onClick={nextMonth} className="p-2 rounded-lg hover:bg-gray-100 transition-colors text-gray-400 hover:text-gray-700" aria-label="Nästa månad">
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {!actual && (
        <Card className="text-center py-12">
          <p className="text-gray-500">Inga importerade transaktioner för {MONTH_NAMES_LONG[month - 1]} {year}. Importera i Flöde först.</p>
        </Card>
      )}

      {actual && (
        <div className="space-y-5">
          {/* Status banner */}
          {close ? (
            <div className={`flex items-start gap-2 text-sm rounded-xl px-4 py-3 border ${drifted ? 'bg-amber-50 border-amber-200 text-amber-800' : 'bg-emerald-50 border-emerald-200 text-emerald-800'}`}>
              {drifted ? <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /> : <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />}
              <div>
                <p className="font-medium">
                  Stängd {new Date(close.closedAt).toLocaleDateString('sv-SE')} · netto {formatCurrency(close.net, true)}
                </p>
                {drifted && <p className="text-xs mt-0.5">Siffrorna har ändrats sedan avslutet (netto nu {formatCurrency(totals.net, true)}). Öppna igen och stäng om för att uppdatera.</p>}
                {close.note && !drifted && <p className="text-xs mt-0.5">{close.note}</p>}
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-sm bg-warm-100 border border-warm-300 text-gray-600 rounded-xl px-4 py-3">
              <Unlock className="w-4 h-4 shrink-0" /> Månaden är inte avstämd ännu.
            </div>
          )}

          {/* Result KPIs */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {([
              ['Inkomst', totals.income, planned.income, 'income'],
              ['Utgifter', totals.expense, planned.expense, 'expense'],
              ['Sparande', totals.savings, planned.savings, 'savings'],
              ['Netto', totals.net, planned.net, 'net'],
            ] as const).map(([label, act, plan, kind]) => {
              const diff = act - plan
              // For expenses, spending less than planned is good (green).
              const good = kind === 'expense' ? diff <= 0 : diff >= 0
              return (
                <Card key={label}>
                  <p className="text-xs text-gray-400 mb-1">{label}</p>
                  <p className="text-xl font-semibold text-gray-900 tabular-nums">{formatCurrency(act)}</p>
                  {plan > 0 || kind === 'net' ? (
                    <p className={`text-xs mt-0.5 tabular-nums ${good ? 'text-emerald-600' : 'text-red-600'}`}>
                      plan {formatCurrency(plan)} · {formatCurrency(diff, true)}
                    </p>
                  ) : (
                    <p className="text-xs mt-0.5 text-gray-300">ingen plan</p>
                  )}
                </Card>
              )
            })}
          </div>

          {/* Checklist */}
          <Card padding={false}>
            <div className="px-5 py-3.5 border-b border-warm-100"><h3 className="font-semibold text-gray-900 text-sm">Checklista</h3></div>
            {checklist.map((c) => (
              <div key={c.label} className="flex items-center gap-3 px-5 py-3 border-b border-warm-100 last:border-0">
                {c.ok
                  ? <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                  : <c.icon className={`w-4 h-4 shrink-0 ${c.warnOnly ? 'text-amber-500' : 'text-red-500'}`} />}
                <span className="text-sm text-gray-700 flex-1">{c.label}</span>
                <span className={`text-sm tabular-nums font-medium ${c.ok ? 'text-emerald-600' : c.warnOnly ? 'text-amber-600' : 'text-red-600'}`}>
                  {c.ok ? 'Klart' : c.count}
                </span>
              </div>
            ))}
          </Card>

          {/* Per-category plan vs actual */}
          <Card padding={false}>
            <div className="px-5 py-3.5 border-b border-warm-100"><h3 className="font-semibold text-gray-900 text-sm">Plan vs utfall per kategori</h3></div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    <th className="text-left px-5 py-2">Kategori</th>
                    <th className="text-right px-5 py-2">Plan</th>
                    <th className="text-right px-5 py-2">Utfall</th>
                    <th className="text-right px-5 py-2">Diff</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const diff = r.actual - r.budget
                    const over = r.cat.type === 'expense' && r.budget > 0 && diff > 0
                    return (
                      <tr key={r.cat.id} className="border-t border-warm-100">
                        <td className="px-5 py-2.5">
                          <span className="inline-flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: r.cat.color ?? '#94a3b8' }} />
                            <span className="text-gray-800">{r.cat.name}</span>
                          </span>
                        </td>
                        <td className="px-5 py-2.5 text-right tabular-nums text-gray-500">{r.budget > 0 ? formatCurrency(r.budget) : '–'}</td>
                        <td className="px-5 py-2.5 text-right tabular-nums text-gray-800">{formatCurrency(r.actual)}</td>
                        <td className={`px-5 py-2.5 text-right tabular-nums font-medium ${over ? 'text-red-600' : 'text-gray-500'}`}>
                          {r.budget > 0 ? formatCurrency(diff, true) : '–'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Note + close */}
          {!close && (
            <Card>
              <CardHeader title="Anteckning" subtitle="Valfri kommentar som sparas med avslutet" />
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                placeholder="t.ex. Extra utgift för bilservice i juni"
                className="w-full border border-warm-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
              />
              <div className="mt-3">
                <Button onClick={doClose}><Lock className="w-4 h-4" /> Stäng månaden</Button>
              </div>
            </Card>
          )}
        </div>
      )}
    </Layout>
  )
}
