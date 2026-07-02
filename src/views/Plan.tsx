import React, { useState, useMemo, useRef } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Trash2, Settings as SettingsIcon, TrendingUp, TrendingDown, AlertTriangle, Download, Sparkles, Copy, Check } from 'lucide-react'
import { Select } from '@/components/ui/Select'
import {
  ComposedChart, Area, Line, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, ReferenceDot,
} from 'recharts'
import { useAppStore } from '@/store'
import { Layout, PageHeader } from '@/components/layout/Layout'
import { Card, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { formatCurrency } from '@/utils/budgetHelpers'
import { getMonthIdForDate } from '@/utils/periodUtils'
import { useSalaryAnchors } from '@/hooks/useSalaryAnchors'
import { buildProjection, buildLiquidityHistory } from '@/utils/projection'
import { exportToExcel } from '@/utils/excelExport'
import { buildAiBriefing } from '@/utils/aiExport'
import { BaselineEditor } from '@/components/budget/BaselineEditor'
import { PlanGrid } from '@/components/budget/PlanGrid'
import { BudgetCharts } from '@/components/budget/BudgetCharts'
import { HistoryCharts } from '@/components/budget/HistoryCharts'
import type { LiquidityEntry, LiquidityPlan } from '@/types'

const HORIZONS = [12, 24, 36] as const
type Horizon = (typeof HORIZONS)[number]

const VIEWS = [
  { id: 'wealth', label: 'Förmögenhet' },
  { id: 'liquidity', label: 'Likviditet' },
  { id: 'budget', label: 'Månadsbudget' },
  { id: 'history', label: 'Historik' },
] as const
type PlanViewMode = (typeof VIEWS)[number]['id']

// Cohesive palette (light-mode app, hardcoded like the existing charts).
const LIQUID_COLOR = '#2563eb'
const LIQUID_ACCOUNT_COLORS = ['#2563eb', '#0891b2', '#0d9488', '#4f46e5', '#0284c7', '#059669']
const ASSET_COLORS = ['#059669', '#0891b2', '#16a34a', '#0d9488', '#7c3aed', '#65a30d', '#0284c7']
const LIABILITY_COLORS = ['#dc2626', '#ea580c', '#d97706', '#b45309']
const NETWORTH_COLOR = '#111827'

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

const LARGE_TX_THRESHOLD = 10_000
const LIQUIDITY_HISTORY_MONTHS = 2

function newId() {
  return `liq-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

function LiquidityTooltip({
  active, payload, label, largeTxs, planned, stacked,
}: {
  active?: boolean
  payload?: Array<{ name: string; value: number; fill: string }>
  label?: string
  largeTxs: Map<string, { amount: number; description: string }[]>
  planned: Map<string, LiquidityEntry[]>
  stacked: boolean
}) {
  if (!active || !payload?.length || !label) return null
  const flagTxs = largeTxs.get(label) ?? []
  const flagPlanned = planned.get(label) ?? []
  const total = payload.reduce((s, p) => s + (p.value ?? 0), 0)
  return (
    <div className="bg-white border border-gray-100 shadow-lg rounded-xl px-4 py-3 text-sm min-w-[180px]">
      <p className="font-semibold text-gray-800 mb-1">{label}</p>
      {stacked && payload.length > 1 ? (
        <>
          {[...payload].reverse().map((p) => (
            <p key={p.name} className="flex items-center justify-between gap-4 text-gray-600">
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-sm inline-block shrink-0" style={{ background: p.fill }} />
                {p.name}
              </span>
              <span className="tabular-nums">{formatCurrency(p.value)}</span>
            </p>
          ))}
          <div className="mt-1.5 pt-1.5 border-t border-gray-100 flex justify-between font-semibold text-gray-800">
            <span>Totalt</span>
            <span className="tabular-nums">{formatCurrency(total)}</span>
          </div>
        </>
      ) : (
        <p className="text-gray-600 tabular-nums">{formatCurrency(total)}</p>
      )}
      {flagTxs.length > 0 && (
        <div className="mt-2 pt-2 border-t border-amber-100">
          <p className="text-xs font-semibold text-amber-700 mb-1">Stor engångstransaktion</p>
          {flagTxs.map((tx, i) => (
            <p key={i} className="text-xs text-gray-600 flex justify-between gap-4">
              <span className="truncate">{tx.description}</span>
              <span className={`tabular-nums shrink-0 ${tx.amount < 0 ? 'text-red-600' : 'text-green-700'}`}>{formatCurrency(tx.amount, true)}</span>
            </p>
          ))}
        </div>
      )}
      {flagPlanned.length > 0 && (
        <div className="mt-2 pt-2 border-t border-violet-100">
          <p className="text-xs font-semibold text-violet-700 mb-1">Planerad engångspost</p>
          {flagPlanned.map((e, i) => (
            <p key={i} className="text-xs text-gray-600 flex justify-between gap-4">
              <span className="truncate">{e.description}</span>
              <span className={`tabular-nums shrink-0 ${e.amount < 0 ? 'text-red-600' : 'text-green-700'}`}>{formatCurrency(e.amount, true)}</span>
            </p>
          ))}
        </div>
      )}
    </div>
  )
}

// Custom bar shape for the wealth chart — renders positive segments above zero
// and negative segments below zero in a single column using SVG paths.
function WealthBarShape(props: any) {
  const { x, y, width, height, _liquid = 0, _assetSegs = [], _liabSegs = [] } = props
  if (!height || height <= 0 || !width) return null
  const totalPos = (_liquid as number) + (_assetSegs as any[]).reduce((s: number, seg: any) => s + Math.max(0, seg.value), 0)
  if (!totalPos) return null
  const ppu = height / totalPos
  const zeroY = y + height
  const R = 4
  const els: React.ReactNode[] = []

  // Positive segments — draw upward from zero
  let curY = zeroY
  if ((_liquid as number) > 0) {
    const h = Math.max(1, Math.round((_liquid as number) * ppu))
    const isTop = !(_assetSegs as any[]).some((s: any) => s.value > 0)
    els.push(isTop
      ? <path key="liq" fill={LIQUID_COLOR} fillOpacity={0.9}
          d={`M${x+R},${curY-h} h${width-2*R} a${R},${R} 0 0 1 ${R},${R} v${h-R} h${-width} v${-(h-R)} a${R},${R} 0 0 1 ${R},${-R}z`} />
      : <rect key="liq" x={x} y={curY - h} width={width} height={h} fill={LIQUID_COLOR} fillOpacity={0.9} />)
    curY -= h
  }
  ;(_assetSegs as any[]).forEach((seg: any, i: number) => {
    if (seg.value <= 0) return
    const h = Math.max(1, Math.round(seg.value * ppu))
    const isTop = !(_assetSegs as any[]).slice(i + 1).some((s: any) => s.value > 0)
    els.push(isTop
      ? <path key={seg.name} fill={seg.color} fillOpacity={0.9}
          d={`M${x+R},${curY-h} h${width-2*R} a${R},${R} 0 0 1 ${R},${R} v${h-R} h${-width} v${-(h-R)} a${R},${R} 0 0 1 ${R},${-R}z`} />
      : <rect key={seg.name} x={x} y={curY - h} width={width} height={h} fill={seg.color} fillOpacity={0.9} />)
    curY -= h
  })

  // Negative segments — draw downward from zero
  let negY = zeroY
  ;(_liabSegs as any[]).forEach((seg: any, i: number) => {
    if (seg.value >= 0) return
    const h = Math.max(1, Math.round(Math.abs(seg.value) * ppu))
    const isBottom = !(_liabSegs as any[]).slice(i + 1).some((s: any) => s.value < 0)
    els.push(isBottom
      ? <path key={seg.name} fill={seg.color} fillOpacity={0.85}
          d={`M${x},${negY} h${width} v${h-R} a${R},${R} 0 0 1 ${-R},${R} h${-(width-2*R)} a${R},${R} 0 0 1 ${-R},${-R}z`} />
      : <rect key={seg.name} x={x} y={negY} width={width} height={h} fill={seg.color} fillOpacity={0.85} />)
    negY += h
  })

  return <g>{els}</g>
}

export function PlanView() {
  const [horizon, setHorizon] = useState<Horizon>(12)
  const [view, setView] = useState<PlanViewMode>('wealth')
  const [showForm, setShowForm] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [copied, setCopied] = useState(false)
  const store = useAppStore()
  const { settings } = store
  const { anchors } = useSalaryAnchors()

  const handleExport = async () => {
    setExporting(true)
    try {
      await exportToExcel({ ...store }, new Date().getFullYear())
    } finally {
      setExporting(false)
    }
  }

  const stampToday = () => {
    const t = new Date()
    return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`
  }

  const handleAiExport = () => {
    const md = buildAiBriefing({ ...store })
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `ekonomi_brief_${stampToday()}.md`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleAiCopy = async () => {
    const md = buildAiBriefing({ ...store })
    try {
      await navigator.clipboard.writeText(md)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard unavailable (e.g. insecure context) — the download button remains.
    }
  }

  const today = new Date()
  const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  const startMonthId = getMonthIdForDate(todayIso, settings.monthStartDay, settings.monthStartBusinessDay, anchors)

  const projection = useMemo(
    () => buildProjection({ state: store, startMonthId, horizon }),
    // recompute when inputs that affect the projection change
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [store.settings.accounts, store.monthlyBudgets, store.yearlyBudgets, store.liquidityPlans, store.importSnapshots, startMonthId, horizon, anchors]
  )

  const { months, accounts } = projection
  const now = months[0]
  const end = months[months.length - 1]

  // Past months prepended to the liquidity chart only, so large non-recurring
  // transactions from before "now" can be flagged (the forward projection in
  // `months` never contains elapsed periods). Built from actual closing balances,
  // not simulated. Other tabs/KPIs keep using `months` unchanged.
  const liquidityHistory = useMemo(
    () => buildLiquidityHistory(store, startMonthId, LIQUIDITY_HISTORY_MONTHS),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [store.actuals, store.settings.accounts, startMonthId]
  )
  const liquidityMonths = useMemo(() => [...liquidityHistory, ...months], [liquidityHistory, months])

  // Lowest projected liquidity over the horizon (skip baseline).
  const trough = months.slice(1).reduce(
    (lo, m) => (m.liquidity < lo.liquidity ? m : lo),
    months[1] ?? months[0]
  )

  const assetAccounts = accounts.filter((a) => a.role === 'asset')
  const liabilityAccounts = accounts.filter((a) => a.role === 'liability')

  // Liabilities with a linkedAssetId are netted into that asset's bar.
  // Liabilities without one appear as separate negative bars.
  const linkedLiabilities = liabilityAccounts.filter((l) => store.settings.accounts.find((a) => a.id === l.id)?.linkedAssetId)
  const unlinkedLiabilities = liabilityAccounts.filter((l) => !store.settings.accounts.find((a) => a.id === l.id)?.linkedAssetId)

  // Map: assetId → linked liability accounts
  const liabilitiesByAsset = new Map<string, typeof liabilityAccounts>()
  for (const l of linkedLiabilities) {
    const assetId = store.settings.accounts.find((a) => a.id === l.id)!.linkedAssetId!
    if (!liabilitiesByAsset.has(assetId)) liabilitiesByAsset.set(assetId, [])
    liabilitiesByAsset.get(assetId)!.push(l)
  }

  // ── Liquid account breakdown for stacked area chart ──────────────────────
  const liquidAccounts = accounts.filter((a) => a.role === 'liquid')
  // Only accounts with a positive starting balance can form a meaningful stack.
  const posLiquidAccounts = liquidAccounts.filter((a) => (now.values[a.id] ?? 0) > 0)
  const posLiquidTotal = posLiquidAccounts.reduce((s, a) => s + (now.values[a.id] ?? 0), 0)
  const useStackedLiquidity = posLiquidAccounts.length > 1 && posLiquidTotal > 0

  // ── Chart data ────────────────────────────────────────────────────────────
  const wealthChartData = months.map((m) => {
    const liquid = Math.max(0, Math.round(m.liquidity))
    const assetSegs = assetAccounts.map((a, i) => {
      const linked = liabilitiesByAsset.get(a.id) ?? []
      const loanSum = linked.reduce((s, l) => s + (m.values[l.id] ?? 0), 0)
      return { name: a.name, value: Math.max(0, Math.round((m.values[a.id] ?? 0) + loanSum)), color: ASSET_COLORS[i % ASSET_COLORS.length] }
    })
    const liabSegs = unlinkedLiabilities.map((l, i) => ({
      name: l.name, value: Math.round(m.values[l.id] ?? 0), color: LIABILITY_COLORS[i % LIABILITY_COLORS.length],
    }))
    const totalAssets = liquid + assetSegs.reduce((s, seg) => s + seg.value, 0)
    return { label: m.label, _wealth: totalAssets, _liquid: liquid, _assetSegs: assetSegs, _liabSegs: liabSegs, Nettoförmögenhet: Math.round(m.netWorth) }
  })

  const liquidityData = liquidityMonths.map((m) => ({ label: m.label, Likviditet: Math.round(m.liquidity) }))

  // Per-account stacked data. History months use the real per-account balance from
  // that month's import; projected months split the total proportionally based on
  // starting balances (their per-account values are frozen — see buildProjection).
  // When total goes negative we zero-out the stack (the red reference line + alert cover that case).
  const liquidityStackData = useMemo(() => {
    if (!useStackedLiquidity) return liquidityData
    return liquidityMonths.map((m) => {
      const row: Record<string, string | number> = { label: m.label }
      if (m.isHistory) {
        for (const a of posLiquidAccounts) row[a.name] = Math.max(0, Math.round(m.values[a.id] ?? 0))
        return row
      }
      const total = Math.round(m.liquidity)
      if (total <= 0) {
        for (const a of posLiquidAccounts) row[a.name] = 0
      } else {
        let assigned = 0
        posLiquidAccounts.forEach((a, i) => {
          const isLast = i === posLiquidAccounts.length - 1
          const v = isLast ? total - assigned : Math.round((now.values[a.id] ?? 0) / posLiquidTotal * total)
          row[a.name] = Math.max(0, v)
          assigned += Math.max(0, v)
        })
      }
      return row
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liquidityMonths, posLiquidAccounts, posLiquidTotal, useStackedLiquidity, liquidityData])

  const liquidityGoesNegative = trough && trough.liquidity < 0

  const minLiabilityValue = unlinkedLiabilities.length > 0
    ? Math.min(...months.map(m => unlinkedLiabilities.reduce((s, l) => s + (m.values[l.id] ?? 0), 0)))
    : 0

  const netWorthDelta = end.netWorth - now.netWorth

  // Carry-forward transparency: is the projection reusing an older budget?
  const budgetYears = Object.keys(store.yearlyBudgets).map(Number)
  const lastBudgetYear = budgetYears.length ? Math.max(...budgetYears) : null
  const endYear = Number(end.monthId.slice(0, 4))
  const carryForward = lastBudgetYear != null && endYear > lastBudgetYear

  // ── One-off entry handling (reuses liquidityPlans) ──────────────────────────
  const [form, setForm] = useState<Partial<LiquidityEntry>>({ type: 'expense', date: todayIso, includeInProjection: true })
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
      includeInProjection: form.includeInProjection === false ? false : undefined,
    }
    if (!store.liquidityPlans[year]) {
      const plan: LiquidityPlan = { id: year, year: Number(year), entries: [], startingBalances: [], startingBalanceMode: 'computed' }
      store.upsertLiquidityPlan(plan)
    }
    store.upsertLiquidityEntry(year, entry)
    setForm({ type: 'expense', date: form.date, includeInProjection: true })
    setShowForm(false)
  }

  // Upcoming one-off entries within the horizon.
  const horizonEnd = end.monthId
  const upcomingEntries = useMemo(() => {
    const list: { planYear: string; entry: LiquidityEntry }[] = []
    for (const plan of Object.values(store.liquidityPlans)) {
      for (const e of plan.entries) {
        if (!e.date) continue
        const mid = getMonthIdForDate(e.date, settings.monthStartDay, settings.monthStartBusinessDay, anchors)
        if (mid >= startMonthId && mid <= horizonEnd) list.push({ planYear: plan.id, entry: e })
      }
    }
    return list.sort((a, b) => a.entry.date.localeCompare(b.entry.date))
  }, [store.liquidityPlans, settings.monthStartDay, settings.monthStartBusinessDay, anchors, startMonthId, horizonEnd])

  // Flags: large non-recurring actual transactions grouped by chart label.
  // Uses liquidityMonths (history + projection) so transactions from the past
  // months shown on the liquidity chart get flagged too, not just future ones.
  const largeNonRecurringByLabel = useMemo(() => {
    const recurringAmounts = settings.recurringItems.map((r) => Math.abs(r.amount))
    const byLabel = new Map<string, { amount: number; description: string }[]>()
    for (const m of liquidityMonths) {
      const txs = store.allTransactions.filter((tx) => {
        if (Math.abs(tx.amount) < LARGE_TX_THRESHOLD) return false
        if (tx.transaction_type === 'transfer') return false
        if (tx.category === 'salary') return false
        if (recurringAmounts.some((r) => r > 0 && Math.abs(Math.abs(tx.amount) - r) / r < 0.15)) return false
        const mid = getMonthIdForDate(tx.date, settings.monthStartDay, settings.monthStartBusinessDay, anchors)
        return mid === m.monthId
      })
      if (txs.length > 0) {
        byLabel.set(m.label, txs.map((tx) => ({ amount: tx.amount, description: tx.description ?? tx.category ?? 'Transaktion' })))
      }
    }
    return byLabel
  }, [store.allTransactions, liquidityMonths, settings.recurringItems, settings.monthStartDay, settings.monthStartBusinessDay, anchors])

  // Flags: planned one-off entries grouped by chart label.
  const plannedByLabel = useMemo(() => {
    const byLabel = new Map<string, LiquidityEntry[]>()
    for (const { entry } of upcomingEntries) {
      if (entry.includeInProjection === false) continue
      const mid = getMonthIdForDate(entry.date, settings.monthStartDay, settings.monthStartBusinessDay, anchors)
      const m = months.find((mo) => mo.monthId === mid)
      if (!m) continue
      if (!byLabel.has(m.label)) byLabel.set(m.label, [])
      byLabel.get(m.label)!.push(entry)
    }
    return byLabel
  }, [upcomingEntries, months, settings.monthStartDay, settings.monthStartBusinessDay, anchors])

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
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <Button variant="secondary" size="sm" onClick={handleExport} loading={exporting}>
              <Download className="w-4 h-4" /> Exportera
            </Button>
            <Button variant="secondary" size="sm" onClick={handleAiExport} title="Ladda ner ett självförklarande underlag för en AI-assistent (Markdown)">
              <Sparkles className="w-4 h-4" /> AI-underlag
            </Button>
            <Button variant="secondary" size="sm" onClick={handleAiCopy} title="Kopiera AI-underlaget till urklipp">
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />} {copied ? 'Kopierad' : 'Kopiera'}
            </Button>
            <div className="flex rounded-lg border border-warm-300 overflow-hidden text-sm">
              {VIEWS.map((v) => (
                <button
                  key={v.id}
                  onClick={() => setView(v.id)}
                  className={`px-3 py-1.5 font-medium transition-colors ${v.id !== VIEWS[0].id ? 'border-l border-warm-300' : ''} ${
                    view === v.id ? 'bg-brand-600 text-white' : 'text-gray-600 hover:bg-warm-50'
                  }`}
                >
                  {v.label}
                </button>
              ))}
            </div>
            {view !== 'history' && (
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
            )}
          </div>
        }
      />

      <div className="space-y-5">
        {/* Backward-looking history — its own KPIs + window control, no projection */}
        {view === 'history' && <HistoryCharts />}

        {/* KPI cards (forward projection) */}
        {view !== 'history' && (
        <>
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
        </>
        )}

        {/* Net worth composition */}
        {view === 'wealth' && (
        <Card>
          <CardHeader title="Förmögenhet över tid" subtitle="Tillgångar ovan noll, skulder under noll — nettoförmögenhet som linje" />
          <ResponsiveContainer width="100%" height={340}>
            <ComposedChart data={wealthChartData} barCategoryGap="20%">
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
              <YAxis
                domain={[minLiabilityValue > 0 ? 0 : minLiabilityValue * 1.15, 'auto']}
                tickFormatter={tickFmt}
                tick={{ fontSize: 11 }}
              />
              <Tooltip
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null
                  const d = payload[0].payload
                  return (
                    <div className="bg-white border border-gray-100 shadow-lg rounded-xl px-4 py-3 text-sm min-w-[200px]">
                      <p className="font-semibold text-gray-800 mb-2">{label}</p>
                      {d._liquid > 0 && (
                        <div className="flex justify-between gap-8">
                          <span className="flex items-center gap-1.5">
                            <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: LIQUID_COLOR }} />
                            Likvida medel
                          </span>
                          <span className="tabular-nums text-gray-700">{formatCurrency(d._liquid)}</span>
                        </div>
                      )}
                      {d._assetSegs?.filter((s: any) => s.value > 0).map((seg: any) => (
                        <div key={seg.name} className="flex justify-between gap-8">
                          <span className="flex items-center gap-1.5">
                            <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: seg.color }} />
                            {seg.name}
                          </span>
                          <span className="tabular-nums text-gray-700">{formatCurrency(seg.value)}</span>
                        </div>
                      ))}
                      {d._liabSegs?.filter((s: any) => s.value < 0).map((seg: any) => (
                        <div key={seg.name} className="flex justify-between gap-8">
                          <span className="flex items-center gap-1.5">
                            <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: seg.color }} />
                            {seg.name}
                          </span>
                          <span className="tabular-nums text-red-600">{formatCurrency(seg.value)}</span>
                        </div>
                      ))}
                      <div className="mt-2 pt-2 border-t border-gray-100 flex justify-between gap-8 font-semibold">
                        <span>Nettoförmögenhet</span>
                        <span className="tabular-nums">{formatCurrency(d.Nettoförmögenhet)}</span>
                      </div>
                    </div>
                  )
                }}
              />
              <ReferenceLine y={0} stroke="#6b7280" strokeWidth={1} />
              {/* Single Bar with custom shape that renders all segments */}
              <Bar dataKey="_wealth" isAnimationActive={false} shape={WealthBarShape} legendType="none" />
              {/* Net worth line */}
              <Line type="monotone" dataKey="Nettoförmögenhet" stroke={NETWORTH_COLOR} strokeWidth={2.5} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </Card>
        )}

        {/* Liquidity */}
        {view === 'liquidity' && (
        <Card>
          <CardHeader title="Likviditet över tid" subtitle="Kassa månad för månad — per konto, inkl. de senaste 2 månaderna" />
          <ResponsiveContainer width="100%" height={220}>
            <ComposedChart data={liquidityStackData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
              <YAxis tickFormatter={tickFmt} tick={{ fontSize: 11 }} />
              <Tooltip content={(props: any) => (
                <LiquidityTooltip
                  active={props.active}
                  payload={props.payload}
                  label={props.label}
                  largeTxs={largeNonRecurringByLabel}
                  planned={plannedByLabel}
                  stacked={useStackedLiquidity}
                />
              )} />
              <ReferenceLine y={0} stroke="#dc2626" strokeDasharray="3 3" />
              {liquidityHistory.length > 0 && (
                <ReferenceLine
                  x={now.label}
                  stroke="#9ca3af"
                  strokeDasharray="2 2"
                  label={{ value: 'Idag', position: 'insideTopRight', fontSize: 10, fill: '#9ca3af' }}
                />
              )}
              {useStackedLiquidity
                ? posLiquidAccounts.map((a, i) => (
                    <Area
                      key={a.id}
                      type="monotone"
                      dataKey={a.name}
                      stackId="liq"
                      stroke={LIQUID_ACCOUNT_COLORS[i % LIQUID_ACCOUNT_COLORS.length]}
                      fill={LIQUID_ACCOUNT_COLORS[i % LIQUID_ACCOUNT_COLORS.length]}
                      fillOpacity={0.65}
                      strokeWidth={1}
                      strokeOpacity={0.4}
                    />
                  ))
                : <Area type="monotone" dataKey="Likviditet" stroke={LIQUID_COLOR} fill={LIQUID_COLOR} fillOpacity={0.15} strokeWidth={2} />
              }
              {/* Flag: large non-recurring transactions */}
              {liquidityData.filter((d) => largeNonRecurringByLabel.has(d.label)).map((d) => (
                <ReferenceDot key={`l-${d.label}`} x={d.label} y={d.Likviditet} r={5} fill="#f59e0b" stroke="white" strokeWidth={2} />
              ))}
              {/* Flag: planned one-off entries */}
              {liquidityData.filter((d) => plannedByLabel.has(d.label)).map((d) => (
                <ReferenceDot key={`p-${d.label}`} x={d.label} y={d.Likviditet} r={9} fill="#7c3aed" fillOpacity={0.25} stroke="#7c3aed" strokeWidth={2} />
              ))}
            </ComposedChart>
          </ResponsiveContainer>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-xs text-gray-500">
            {useStackedLiquidity && posLiquidAccounts.map((a, i) => (
              <span key={a.id} className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: LIQUID_ACCOUNT_COLORS[i % LIQUID_ACCOUNT_COLORS.length] }} />
                {a.name}
              </span>
            ))}
            {largeNonRecurringByLabel.size > 0 && (
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-amber-400 inline-block" />
                Stor engångstransaktion (&gt;{(LARGE_TX_THRESHOLD / 1000).toFixed(0)}k)
              </span>
            )}
            {plannedByLabel.size > 0 && (
              <span className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-violet-600 inline-block" />
                Planerad engångspost
              </span>
            )}
          </div>
          {carryForward && (
            <p className="text-xs text-gray-400 mt-1">
              Från {lastBudgetYear! + 1} rullas {lastBudgetYear} års budget framåt — lägg in en budget för senare år för en mer exakt prognos.
            </p>
          )}
        </Card>
        )}

        {/* Monthly budget — stacked bars + composition pie for the selected & coming months */}
        {view === 'budget' && <BudgetCharts months={months} />}

        {/* Budget baseline — the editable plan that drives the projection above */}
        {view === 'budget' && (
        <Card>
          <CardHeader
            title="Budgetbas — din normalmånad"
            subtitle="Sätt målbeloppen som driver prognosen. Justera enskilda månader i Flöde."
          />
          <BaselineEditor />
        </Card>
        )}

        {/* Coming-months grid — adjustable rows (categories) × columns (months) */}
        {view === 'budget' && <PlanGrid />}

        {/* Holdings / assumptions */}
        {view === 'wealth' && (
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
                  <th className="px-2 py-2" title="Ingår i budget — påverkar inte likvid separat">I budget</th>
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
                      <td className="px-2 py-1 text-center">
                        {(contributionValue != null && contributionValue !== 0) || acc?.contributionIsBudgeted ? (
                          <input
                            type="checkbox"
                            checked={!!acc?.contributionIsBudgeted}
                            onChange={(e) => acc && store.upsertAccount({ ...acc, contributionIsBudgeted: e.target.checked || undefined })}
                            title="Ingår redan i en budgetpost — dras inte från likvid igen"
                            className="w-4 h-4 rounded accent-brand-600 cursor-pointer"
                          />
                        ) : (
                          <span className="text-gray-200">—</span>
                        )}
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
            Klicka på en cell för att redigera. "I budget" = insättningen/amorteringen finns redan som en budgetpost och ska inte dras från likvid en gång till.
          </p>
        </Card>
        )}

        {/* One-off planned entries */}
        {view === 'liquidity' && (
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
                <div className="flex items-end gap-2">
                  <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer pb-1.5">
                    <input
                      type="checkbox"
                      checked={form.includeInProjection ?? true}
                      onChange={(e) => setForm((f) => ({ ...f, includeInProjection: e.target.checked }))}
                      className="rounded"
                    />
                    Ingår i likviditetsprognos
                  </label>
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
                  <th className="text-center px-4 py-2">Prognos</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {upcomingEntries.length === 0 && (
                  <tr><td colSpan={6} className="text-center text-gray-400 py-8">Inga planerade engångsposter inom horisonten</td></tr>
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
                    <td className="px-4 py-2.5 text-center">
                      <input
                        type="checkbox"
                        checked={entry.includeInProjection !== false}
                        onChange={(e) =>
                          store.upsertLiquidityEntry(planYear, {
                            ...entry,
                            includeInProjection: e.target.checked ? undefined : false,
                          })
                        }
                        className="rounded"
                        title="Ingår i likviditetsprognos"
                      />
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
        )}
      </div>
    </Layout>
  )
}
