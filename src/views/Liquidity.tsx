import { useState } from 'react'
import { ChevronLeft, ChevronRight, Plus, Download, Trash2 } from 'lucide-react'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { useAppStore } from '@/store'
import { Layout, PageHeader } from '@/components/layout/Layout'
import { Card, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { formatCurrency, MONTH_NAMES_SHORT } from '@/utils/budgetHelpers'
import { exportToExcel } from '@/utils/excelExport'
import { computeStartingBalance } from '@/utils/zlantarParser'
import type { LiquidityEntry } from '@/types'

function newId() {
  return `liq-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

const TYPE_LABELS: Record<LiquidityEntry['type'], string> = {
  income: 'Inkomst',
  expense: 'Utgift',
  transfer: 'Överföring',
  loan_payment: 'Lånebetal.',
}

export function LiquidityView() {
  const [year, setYear] = useState(new Date().getFullYear())
  const [exporting, setExporting] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<Partial<LiquidityEntry>>({
    type: 'expense',
    isConfirmed: false,
    date: `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-01`,
  })

  const store = useAppStore()
  const { liquidityPlans, settings, actuals } = store

  const planId = String(year)
  const plan = liquidityPlans[planId]

  // Computed starting balance from most recent Zlantar import
  const computed = computeStartingBalance(actuals, settings.accounts)

  // Effective starting balance: manual override or computed or 0
  const mode = plan?.startingBalanceMode ?? 'computed'
  const effectiveStartBalance =
    mode === 'manual'
      ? (plan?.manualStartingBalance ?? 0)
      : (computed?.balance ?? 0)

  const initPlan = () => {
    const startingBalances = settings.accounts
      .filter((a) => a.includeInLiquidity)
      .map((a) => ({
        accountId: a.id,
        accountName: a.name,
        accountType: a.type,
        balance: 0,
        currency: a.currency,
      }))
    store.upsertLiquidityPlan({
      id: planId,
      year,
      entries: [],
      startingBalances,
      startingBalanceMode: 'computed',
    })
  }

  const setBalanceMode = (newMode: 'computed' | 'manual') => {
    store.upsertLiquidityPlan({
      ...plan,
      startingBalanceMode: newMode,
      manualStartingBalance: newMode === 'manual' ? (plan.manualStartingBalance ?? effectiveStartBalance) : undefined,
    })
  }

  const setManualBalance = (value: number) => {
    store.upsertLiquidityPlan({ ...plan, manualStartingBalance: value })
  }

  const addEntry = () => {
    if (!form.description || !form.date || !form.amount) return
    const entry: LiquidityEntry = {
      id: newId(),
      date: form.date!,
      description: form.description!,
      amount: form.type === 'expense' || form.type === 'loan_payment'
        ? -Math.abs(form.amount!)
        : Math.abs(form.amount!),
      type: form.type ?? 'expense',
      isConfirmed: form.isConfirmed ?? false,
    }
    store.upsertLiquidityEntry(planId, entry)
    setForm({ type: 'expense', isConfirmed: false, date: form.date })
    setShowForm(false)
  }

  // Build chart data: cumulative balance per month
  const chartData = MONTH_NAMES_SHORT.map((name, i) => {
    const m = i + 1
    const monthStr = `${year}-${String(m).padStart(2, '0')}`
    const monthEntries = (plan?.entries ?? []).filter((e) => e.date.startsWith(monthStr))
    const inflow = monthEntries.filter((e) => e.amount > 0).reduce((s, e) => s + e.amount, 0)
    const outflow = monthEntries.filter((e) => e.amount < 0).reduce((s, e) => s + Math.abs(e.amount), 0)
    const entriesBefore = (plan?.entries ?? []).filter((e) => e.date < monthStr)
    const balance = effectiveStartBalance + entriesBefore.reduce((s, e) => s + e.amount, 0) + monthEntries.reduce((s, e) => s + e.amount, 0)
    return { name, inflow, outflow, balance }
  })

  const handleExport = async () => {
    setExporting(true)
    try { await exportToExcel({ ...store }, year) }
    finally { setExporting(false) }
  }

  const sorted = [...(plan?.entries ?? [])].sort((a, b) => a.date.localeCompare(b.date))

  return (
    <Layout>
      <PageHeader
        title="Likviditetsplanering"
        subtitle={`Kassaflöde ${year}`}
        actions={
          <Button variant="secondary" size="sm" onClick={handleExport} loading={exporting}>
            <Download className="w-4 h-4" /> Exportera Excel
          </Button>
        }
      />

      {/* Year nav */}
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => setYear((y) => y - 1)} className="p-1.5 rounded-lg hover:bg-gray-200 transition-colors">
          <ChevronLeft className="w-5 h-5 text-gray-600" />
        </button>
        <h2 className="text-lg font-semibold text-gray-800 min-w-16 text-center">{year}</h2>
        <button onClick={() => setYear((y) => y + 1)} className="p-1.5 rounded-lg hover:bg-gray-200 transition-colors">
          <ChevronRight className="w-5 h-5 text-gray-600" />
        </button>
      </div>

      {!plan && (
        <Card className="text-center py-12">
          <p className="text-gray-500 mb-4">Ingen likviditetsplan för {year}.</p>
          <Button onClick={initPlan}><Plus className="w-4 h-4" /> Skapa likviditetsplan</Button>
        </Card>
      )}

      {plan && (
        <div className="space-y-5">
          {/* Starting balance */}
          <Card>
            <CardHeader title="Startsaldo" subtitle="Saldot vid planeringens startpunkt" />
            <div className="flex flex-col sm:flex-row sm:items-center gap-4">
              {/* Mode toggle */}
              <div className="flex rounded-lg border border-gray-200 overflow-hidden text-sm shrink-0">
                <button
                  onClick={() => setBalanceMode('computed')}
                  className={`px-3 py-1.5 font-medium transition-colors ${mode === 'computed' ? 'bg-brand-600 text-white' : 'text-gray-600 hover:bg-gray-50'}`}
                >
                  Från import
                </button>
                <button
                  onClick={() => setBalanceMode('manual')}
                  className={`px-3 py-1.5 font-medium transition-colors border-l border-gray-200 ${mode === 'manual' ? 'bg-brand-600 text-white' : 'text-gray-600 hover:bg-gray-50'}`}
                >
                  Manuell
                </button>
              </div>

              {mode === 'computed' && (
                <div className="flex items-baseline gap-3">
                  <span className="text-2xl font-semibold text-gray-900">
                    {formatCurrency(effectiveStartBalance)}
                  </span>
                  {computed ? (
                    <span className="text-xs text-gray-400">
                      Importerat {new Date(computed.importedAt).toLocaleDateString('sv-SE')}
                    </span>
                  ) : (
                    <span className="text-xs text-amber-600">Inget importerat ännu — importera Zlantar-data för automatiskt saldo</span>
                  )}
                </div>
              )}

              {mode === 'manual' && (
                <div className="flex items-center gap-3">
                  <input
                    type="number"
                    value={plan.manualStartingBalance ?? ''}
                    onChange={(e) => setManualBalance(parseFloat(e.target.value) || 0)}
                    placeholder="0"
                    className="border border-gray-200 rounded-md px-3 py-1.5 text-sm w-40 focus:outline-none focus:ring-2 focus:ring-brand-500"
                  />
                  <span className="text-sm text-gray-500">kr</span>
                  {computed && (
                    <button
                      onClick={() => setManualBalance(computed.balance)}
                      className="text-xs text-brand-600 hover:underline"
                    >
                      Fyll från import ({formatCurrency(computed.balance)})
                    </button>
                  )}
                </div>
              )}
            </div>
          </Card>

          {/* Chart */}
          <Card>
            <CardHeader title="Saldoprojektion" subtitle="Beräknat kassaflöde per månad" />
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="balGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#0e90e3" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#0e90e3" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis tickFormatter={(v) => `${Math.round(v / 1000)}k`} tick={{ fontSize: 11 }} />
                <Tooltip
                  formatter={(v) => formatCurrency(Number(v ?? 0))}
                  labelStyle={{ fontWeight: 600 }}
                />
                <Area
                  type="monotone"
                  dataKey="balance"
                  stroke="#0e90e3"
                  fill="url(#balGrad)"
                  strokeWidth={2}
                  name="Saldo"
                />
              </AreaChart>
            </ResponsiveContainer>
          </Card>

          {/* Entries */}
          <Card padding={false}>
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <div>
                <h3 className="font-semibold text-gray-900">Planerade poster</h3>
                <p className="text-sm text-gray-500">{sorted.length} poster</p>
              </div>
              <Button size="sm" onClick={() => setShowForm(true)}>
                <Plus className="w-4 h-4" /> Lägg till
              </Button>
            </div>

            {/* Add form */}
            {showForm && (
              <div className="p-4 bg-brand-50 border-b border-brand-100">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
                  <div>
                    <label className="text-xs font-medium text-gray-600 block mb-1">Datum</label>
                    <input
                      type="date"
                      value={form.date ?? ''}
                      onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
                      className="w-full border border-gray-200 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className="text-xs font-medium text-gray-600 block mb-1">Beskrivning</label>
                    <input
                      type="text"
                      placeholder="t.ex. Hyra, Lön..."
                      value={form.description ?? ''}
                      onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                      className="w-full border border-gray-200 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-600 block mb-1">Typ</label>
                    <select
                      value={form.type ?? 'expense'}
                      onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as LiquidityEntry['type'] }))}
                      className="w-full border border-gray-200 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                    >
                      {Object.entries(TYPE_LABELS).map(([v, l]) => (
                        <option key={v} value={v}>{l}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-600 block mb-1">Belopp (kr)</label>
                    <input
                      type="number"
                      placeholder="0"
                      value={form.amount ?? ''}
                      onChange={(e) => setForm((f) => ({ ...f, amount: parseFloat(e.target.value) }))}
                      className="w-full border border-gray-200 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                    />
                  </div>
                  <div className="flex items-end gap-2">
                    <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer pb-1.5">
                      <input
                        type="checkbox"
                        checked={form.isConfirmed ?? false}
                        onChange={(e) => setForm((f) => ({ ...f, isConfirmed: e.target.checked }))}
                        className="rounded"
                      />
                      Bekräftad
                    </label>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={addEntry}>Lägg till</Button>
                  <Button size="sm" variant="secondary" onClick={() => setShowForm(false)}>Avbryt</Button>
                </div>
              </div>
            )}

            {/* Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    <th className="text-left px-4 py-2">Datum</th>
                    <th className="text-left px-4 py-2">Beskrivning</th>
                    <th className="text-left px-4 py-2">Typ</th>
                    <th className="text-right px-4 py-2">Belopp</th>
                    <th className="text-right px-4 py-2">Kumulativt</th>
                    <th className="text-center px-4 py-2">Bekr.</th>
                    <th className="px-4 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.length === 0 && (
                    <tr>
                      <td colSpan={7} className="text-center text-gray-400 py-8">
                        Inga poster tillagda än
                      </td>
                    </tr>
                  )}
                  {(() => {
                    let cumulative = effectiveStartBalance
                    return sorted.map((entry) => {
                      cumulative += entry.amount
                      return (
                        <tr key={entry.id} className="border-t border-gray-100 hover:bg-gray-50">
                          <td className="px-4 py-2.5 text-gray-600">{entry.date}</td>
                          <td className="px-4 py-2.5 font-medium text-gray-800">{entry.description}</td>
                          <td className="px-4 py-2.5">
                            <span className={`text-xs rounded-full px-2 py-0.5 font-medium
                              ${entry.type === 'income' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-700'}`}>
                              {TYPE_LABELS[entry.type]}
                            </span>
                          </td>
                          <td className={`px-4 py-2.5 text-right font-medium ${entry.amount >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                            {formatCurrency(entry.amount, true)}
                          </td>
                          <td className={`px-4 py-2.5 text-right font-medium ${cumulative < 0 ? 'text-red-600 bg-red-50' : 'text-gray-700'}`}>
                            {formatCurrency(cumulative)}
                          </td>
                          <td className="px-4 py-2.5 text-center">
                            {entry.isConfirmed
                              ? <span className="text-green-500">✓</span>
                              : <span className="text-gray-300">–</span>
                            }
                          </td>
                          <td className="px-4 py-2.5">
                            <button
                              onClick={() => store.removeLiquidityEntry(planId, entry.id)}
                              className="text-gray-300 hover:text-red-500 transition-colors"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </td>
                        </tr>
                      )
                    })
                  })()}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}
    </Layout>
  )
}
