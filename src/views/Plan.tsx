import { useState, useMemo, useRef } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Trash2, Settings as SettingsIcon, TrendingUp, TrendingDown, AlertTriangle, Download } from 'lucide-react'
import { Select } from '@/components/ui/Select'
import {
  ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Legend,
} from 'recharts'
import { useAppStore } from '@/store'
import { Layout, PageHeader } from '@/components/layout/Layout'
import { Card, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { formatCurrency } from '@/utils/budgetHelpers'
import { getMonthIdForDate } from '@/utils/periodUtils'
import { buildProjection } from '@/utils/projection'
import { exportToExcel } from '@/utils/excelExport'
import { BaselineEditor } from '@/components/budget/BaselineEditor'
import { PlanGrid } from '@/components/budget/PlanGrid'
import type { LiquidityEntry, LiquidityPlan } from '@/types'

const HORIZONS = [12, 24, 36] as const
type Horizon = (typeof HORIZONS)[number]

// Cohesive palette (light-mode app, hardcoded like the existing charts).
const LIQUID_COLOR = '#0e90e3'
const ASSET_COLORS = ['#C96332', '#059669', '#d9920a', '#7c3aed', '#0d9488', '#db2777', '#2563eb', '#65a30d']
const NETWORTH_COLOR = '#1f2937'
const DEBT_COLOR = '#dc2626'

const TYPE_LABELS: Record<LiquidityEntry['type'], string> = {
  income: 'Inkomst',
  expense: 'Utgift',
  transfer: 'Överföring',
  loan_payment: 'Lånebetal.',
}

function InlineNumber({
  value,
  onCommit,
  format,
  placeholder,
}: {
  value: number | undefined
  onCommit: (v: number | null) => void
  format: (v: number) => string
  placeholder?: string
}) {
  const [editing, setEditing] = useState(false)
  const [raw, setRaw] = useState('')
  const ref = useRef<HTMLInputElement>(null)

  const commit = () => {
    setEditing(false)
    const cleaned = raw.replace(',', '.').trim()
    if (cleaned === '') { onCommit(null); return }
    const parsed = parseFloat(cleaned)
    if (isNaN(parsed)) { onCommit(null); return }
    onCommit(parsed)
  }

  return (
    <input
      ref={ref}
      value={editing ? raw : value != null ? format(value) : ''}
      placeholder={placeholder ?? '–'}
      onFocus={() => { setEditing(true); setRaw(value != null ? String(value) : '') }}
      onChange={(e) => setRaw(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') ref.current?.blur() }}
      className="w-full text-right text-sm tabular-nums rounded px-2 py-1 bg-transparent border border-transparent
        hover:border-warm-200 focus:outline-none focus:ring-1 focus:ring-brand-400 focus:bg-white focus:border-transparent
        text-gray-600 placeholder:text-gray-300"
    />
  )
}

function tickFmt(v: number): string {
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`
  return `${Math.round(v / 1000)}k`
}

function newId() {
  return `liq-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

export function PlanView() {
  const [horizon, setHorizon] = useState<Horizon>(12)
  const [showForm, setShowForm] = useState(false)
  const [exporting, setExporting] = useState(false)
  const store = useAppStore()
  const { settings } = store

  const handleExport = async () => {
    setExporting(true)
    try {
      await exportToExcel({ ...store }, new Date().getFullYear())
    } finally {
      setExporting(false)
    }
  }

  const today = new Date()
  const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  const startMonthId = getMonthIdForDate(todayIso, settings.monthStartDay, settings.monthStartBusinessDay)

  const projection = useMemo(
    () => buildProjection({ state: store, startMonthId, horizon }),
    // recompute when inputs that affect the projection change
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [store.settings.accounts, store.monthlyBudgets, store.yearlyBudgets, store.liquidityPlans, store.importSnapshots, startMonthId, horizon]
  )

  const { months, accounts } = projection
  const now = months[0]
  const end = months[months.length - 1]

  // Lowest projected liquidity over the horizon (skip baseline).
  const trough = months.slice(1).reduce(
    (lo, m) => (m.liquidity < lo.liquidity ? m : lo),
    months[1] ?? months[0]
  )

  const assetAccounts = accounts.filter((a) => a.role === 'asset')
  const hasLiabilities = accounts.some((a) => a.role === 'liability')

  // ── Chart data ────────────────────────────────────────────────────────────
  const chartData = months.map((m) => {
    const row: Record<string, number | string> = { label: m.label }
    row['Likvida medel'] = Math.round(m.liquidity)
    for (const a of assetAccounts) row[a.name] = Math.round(m.values[a.id] ?? 0)
    row['Nettoförmögenhet'] = Math.round(m.netWorth)
    if (hasLiabilities) row['Skulder'] = Math.round(m.totalLiabilities)
    return row
  })

  const liquidityData = months.map((m) => ({ label: m.label, Likviditet: Math.round(m.liquidity) }))
  const liquidityGoesNegative = trough && trough.liquidity < 0

  const netWorthDelta = end.netWorth - now.netWorth

  // Carry-forward transparency: is the projection reusing an older budget?
  const budgetYears = Object.keys(store.yearlyBudgets).map(Number)
  const lastBudgetYear = budgetYears.length ? Math.max(...budgetYears) : null
  const endYear = Number(end.monthId.slice(0, 4))
  const carryForward = lastBudgetYear != null && endYear > lastBudgetYear

  // ── One-off entry handling (reuses liquidityPlans) ──────────────────────────
  const [form, setForm] = useState<Partial<LiquidityEntry>>({ type: 'expense', date: todayIso })
  const addEntry = () => {
    if (!form.description || !form.date || !form.amount) return
    const year = form.date.slice(0, 4)
    const entry: LiquidityEntry = {
      id: newId(),
      date: form.date,
      description: form.description,
      amount: form.type === 'expense' || form.type === 'loan_payment' ? -Math.abs(form.amount) : Math.abs(form.amount),
      type: form.type ?? 'expense',
      isConfirmed: false,
    }
    if (!store.liquidityPlans[year]) {
      const plan: LiquidityPlan = { id: year, year: Number(year), entries: [], startingBalances: [], startingBalanceMode: 'computed' }
      store.upsertLiquidityPlan(plan)
    }
    store.upsertLiquidityEntry(year, entry)
    setForm({ type: 'expense', date: form.date })
    setShowForm(false)
  }

  // Upcoming one-off entries within the horizon.
  const horizonEnd = end.monthId
  const upcomingEntries = useMemo(() => {
    const list: { planYear: string; entry: LiquidityEntry }[] = []
    for (const plan of Object.values(store.liquidityPlans)) {
      for (const e of plan.entries) {
        if (!e.date) continue
        const mid = getMonthIdForDate(e.date, settings.monthStartDay, settings.monthStartBusinessDay)
        if (mid >= startMonthId && mid <= horizonEnd) list.push({ planYear: plan.id, entry: e })
      }
    }
    return list.sort((a, b) => a.entry.date.localeCompare(b.entry.date))
  }, [store.liquidityPlans, settings.monthStartDay, settings.monthStartBusinessDay, startMonthId, horizonEnd])

  if (accounts.length === 0) {
    return (
      <Layout>
        <PageHeader title="Plan" subtitle="Likviditet & förmögenhet framåt" />
        <Card className="text-center py-12">
          <p className="text-gray-500 mb-4">Inga konton ännu. Lägg till konton — inklusive bostad och sparande — för att se prognosen.</p>
          <Link to="/installningar"><Button><SettingsIcon className="w-4 h-4" /> Gå till inställningar</Button></Link>
        </Card>
      </Layout>
    )
  }

  return (
    <Layout>
      <PageHeader
        title="Plan"
        subtitle="Likviditet & förmögenhet framåt"
        actions={
          <div className="flex items-center gap-2 shrink-0">
            <Button variant="secondary" size="sm" onClick={handleExport} loading={exporting}>
              <Download className="w-4 h-4" /> Exportera
            </Button>
            <div className="flex rounded-lg border border-warm-300 overflow-hidden text-sm">
              {HORIZONS.map((h) => (
                <button
                  key={h}
                  onClick={() => setHorizon(h)}
                  className={`px-3 py-1.5 font-medium transition-colors ${h !== HORIZONS[0] ? 'border-l border-warm-300' : ''} ${
                    horizon === h ? 'bg-brand-600 text-white' : 'text-gray-600 hover:bg-warm-50'
                  }`}
                >
                  {h} mån
                </button>
              ))}
            </div>
          </div>
        }
      />

      <div className="space-y-5">
        {/* KPI cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Card>
            <p className="text-xs text-gray-400 mb-1">Nettoförmögenhet idag</p>
            <p className="text-xl font-semibold text-gray-900 tabular-nums">{formatCurrency(now.netWorth)}</p>
          </Card>
          <Card>
            <p className="text-xs text-gray-400 mb-1">Om {horizon} mån</p>
            <p className="text-xl font-semibold text-gray-900 tabular-nums">{formatCurrency(end.netWorth)}</p>
            <p className={`text-xs mt-0.5 flex items-center gap-1 ${netWorthDelta >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              {netWorthDelta >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
              {formatCurrency(netWorthDelta, true)}
            </p>
          </Card>
          <Card>
            <p className="text-xs text-gray-400 mb-1">Likviditet idag</p>
            <p className="text-xl font-semibold text-gray-900 tabular-nums">{formatCurrency(now.liquidity)}</p>
          </Card>
          <Card className={liquidityGoesNegative ? 'border-red-300 bg-red-50' : ''}>
            <p className="text-xs text-gray-400 mb-1">Lägsta likviditet</p>
            <p className={`text-xl font-semibold tabular-nums ${liquidityGoesNegative ? 'text-red-600' : 'text-gray-900'}`}>
              {formatCurrency(trough.liquidity)}
            </p>
            <p className="text-xs text-gray-400 mt-0.5">{trough.label}</p>
          </Card>
        </div>

        {liquidityGoesNegative && (
          <div className="flex items-start gap-2 text-sm bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>Likviditeten går under noll i {trough.label} ({formatCurrency(trough.liquidity)}). Justera planerade poster eller insättningar.</span>
          </div>
        )}

        {/* Net worth composition */}
        <Card>
          <CardHeader title="Förmögenhet över tid" subtitle="Hur tillgångarna ackumuleras — staplat per tillgång" />
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
              <YAxis tickFormatter={tickFmt} tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v) => formatCurrency(Number(v ?? 0))} labelStyle={{ fontWeight: 600 }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Area type="monotone" dataKey="Likvida medel" stackId="assets" stroke={LIQUID_COLOR} fill={LIQUID_COLOR} fillOpacity={0.25} strokeWidth={1.5} />
              {assetAccounts.map((a, i) => (
                <Area
                  key={a.id}
                  type="monotone"
                  dataKey={a.name}
                  stackId="assets"
                  stroke={ASSET_COLORS[i % ASSET_COLORS.length]}
                  fill={ASSET_COLORS[i % ASSET_COLORS.length]}
                  fillOpacity={0.25}
                  strokeWidth={1.5}
                />
              ))}
              {hasLiabilities && (
                <Line type="monotone" dataKey="Skulder" stroke={DEBT_COLOR} strokeWidth={1.5} strokeDasharray="4 3" dot={false} />
              )}
              <Line type="monotone" dataKey="Nettoförmögenhet" stroke={NETWORTH_COLOR} strokeWidth={2.5} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </Card>

        {/* Liquidity */}
        <Card>
          <CardHeader title="Likviditet över tid" subtitle="Kassa månad för månad — driven av budgeten" />
          <ResponsiveContainer width="100%" height={220}>
            <ComposedChart data={liquidityData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
              <YAxis tickFormatter={tickFmt} tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v) => formatCurrency(Number(v ?? 0))} labelStyle={{ fontWeight: 600 }} />
              <ReferenceLine y={0} stroke="#dc2626" strokeDasharray="3 3" />
              <Area type="monotone" dataKey="Likviditet" stroke={LIQUID_COLOR} fill={LIQUID_COLOR} fillOpacity={0.15} strokeWidth={2} />
            </ComposedChart>
          </ResponsiveContainer>
          {carryForward && (
            <p className="text-xs text-gray-400 mt-2">
              Från {lastBudgetYear! + 1} rullas {lastBudgetYear} års budget framåt — lägg in en budget för senare år för en mer exakt prognos.
            </p>
          )}
        </Card>

        {/* Budget baseline — the editable plan that drives the projection above */}
        <Card>
          <CardHeader
            title="Budgetbas — din normalmånad"
            subtitle="Sätt målbeloppen som driver prognosen. Justera enskilda månader i Flöde."
          />
          <BaselineEditor />
        </Card>

        {/* Coming-months grid — adjustable rows (categories) × columns (months) */}
        <PlanGrid />

        {/* Holdings / assumptions */}
        <Card padding={false}>
          <div className="flex items-center justify-between p-5 border-b border-gray-100">
            <div>
              <h3 className="font-semibold text-gray-900">Innehav & antaganden</h3>
              <p className="text-sm text-gray-500">Nuvärde → prognos om {horizon} mån</p>
            </div>
            <Link to="/installningar" className="text-sm text-gray-400 hover:text-gray-600 flex items-center gap-1">
              <SettingsIcon className="w-3.5 h-3.5" /> Mer
            </Link>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  <th className="text-left px-4 py-2">Konto</th>
                  <th className="text-right px-4 py-2">Avkastning</th>
                  <th className="text-right px-4 py-2">Insättning/mån</th>
                  <th className="text-right px-4 py-2">Nuvärde</th>
                  <th className="text-right px-4 py-2">Prognos</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((a) => {
                  const acc = settings.accounts.find((x) => x.id === a.id)
                  const cur = now.values[a.id] ?? 0
                  const fut = end.values[a.id] ?? 0
                  const isLiability = a.role === 'liability'

                  const handleReturn = (v: number | null) => {
                    if (!acc) return
                    if (isLiability) {
                      store.upsertAccount({ ...acc, interestRate: v ?? undefined })
                    } else {
                      store.upsertAccount({ ...acc, expectedReturn: v != null ? v / 100 : undefined })
                    }
                  }
                  const handleContribution = (v: number | null) => {
                    if (!acc) return
                    if (isLiability) {
                      store.upsertAccount({ ...acc, monthlyPayment: v ?? undefined })
                    } else {
                      store.upsertAccount({ ...acc, monthlyContribution: v ?? undefined })
                    }
                  }

                  const returnValue = isLiability
                    ? acc?.interestRate
                    : acc?.expectedReturn != null ? acc.expectedReturn * 100 : undefined
                  const contributionValue = isLiability ? acc?.monthlyPayment : acc?.monthlyContribution

                  return (
                    <tr key={a.id} className="border-t border-gray-100">
                      <td className="px-4 py-2">
                        <span className="font-medium text-gray-800">{a.name}</span>
                        <span className="ml-2 text-xs text-gray-400">
                          {a.role === 'liquid' ? 'Likvid' : a.role === 'liability' ? 'Skuld' : 'Tillgång'}
                        </span>
                      </td>
                      <td className="px-1 py-1">
                        <InlineNumber
                          value={returnValue}
                          onCommit={handleReturn}
                          format={(v) => `${v.toFixed(1)} %`}
                          placeholder="0.0 %"
                        />
                      </td>
                      <td className="px-1 py-1">
                        <InlineNumber
                          value={contributionValue}
                          onCommit={handleContribution}
                          format={(v) => Math.round(v).toLocaleString('sv-SE')}
                          placeholder="0"
                        />
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-gray-700">{formatCurrency(cur)}</td>
                      <td className={`px-4 py-2 text-right tabular-nums font-medium ${fut >= cur ? 'text-gray-900' : 'text-red-600'}`}>
                        {formatCurrency(fut)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-gray-400 px-5 py-3 border-t border-gray-100">
            Klicka på en cell för att redigera. Avkastning i % per år — insättning/amortering i kr/mån. Sparande styrs härifrån, inte av sparkategorier i budgeten.
          </p>
        </Card>

        {/* One-off planned entries */}
        <Card padding={false}>
          <div className="flex items-center justify-between p-5 border-b border-gray-100">
            <div>
              <h3 className="font-semibold text-gray-900">Planerade engångsposter</h3>
              <p className="text-sm text-gray-500">{upcomingEntries.length} poster inom horisonten</p>
            </div>
            <Button size="sm" onClick={() => setShowForm(true)}><Plus className="w-4 h-4" /> Lägg till</Button>
          </div>

          {showForm && (
            <div className="p-4 bg-brand-50 border-b border-brand-100">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
                <div>
                  <label className="text-xs font-medium text-gray-600 block mb-1">Datum</label>
                  <input type="date" value={form.date ?? ''} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
                    className="w-full border border-gray-200 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
                </div>
                <div className="md:col-span-2">
                  <label className="text-xs font-medium text-gray-600 block mb-1">Beskrivning</label>
                  <input type="text" placeholder="t.ex. Resa, bonus, ny bil..." value={form.description ?? ''}
                    onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                    className="w-full border border-gray-200 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600 block mb-1">Typ</label>
                  <Select
                    className="w-full"
                    value={form.type ?? 'expense'}
                    onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as LiquidityEntry['type'] }))}
                    options={Object.entries(TYPE_LABELS).map(([v, l]) => ({ value: v, label: l }))}
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600 block mb-1">Belopp (kr)</label>
                  <input type="number" placeholder="0" value={form.amount ?? ''}
                    onChange={(e) => setForm((f) => ({ ...f, amount: parseFloat(e.target.value) }))}
                    className="w-full border border-gray-200 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
                </div>
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={addEntry}>Lägg till</Button>
                <Button size="sm" variant="secondary" onClick={() => setShowForm(false)}>Avbryt</Button>
              </div>
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  <th className="text-left px-4 py-2">Datum</th>
                  <th className="text-left px-4 py-2">Beskrivning</th>
                  <th className="text-left px-4 py-2">Typ</th>
                  <th className="text-right px-4 py-2">Belopp</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {upcomingEntries.length === 0 && (
                  <tr><td colSpan={5} className="text-center text-gray-400 py-8">Inga planerade engångsposter inom horisonten</td></tr>
                )}
                {upcomingEntries.map(({ planYear, entry }) => (
                  <tr key={entry.id} className="border-t border-gray-100 hover:bg-gray-50">
                    <td className="px-4 py-2.5 text-gray-600">{entry.date}</td>
                    <td className="px-4 py-2.5 font-medium text-gray-800">{entry.description}</td>
                    <td className="px-4 py-2.5">
                      <span className={`text-xs rounded-full px-2 py-0.5 font-medium ${entry.amount >= 0 ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-700'}`}>
                        {TYPE_LABELS[entry.type]}
                      </span>
                    </td>
                    <td className={`px-4 py-2.5 text-right font-medium ${entry.amount >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                      {formatCurrency(entry.amount, true)}
                    </td>
                    <td className="px-4 py-2.5">
                      <button onClick={() => store.removeLiquidityEntry(planYear, entry.id)} className="text-gray-300 hover:text-red-500 transition-colors">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </Layout>
  )
}
