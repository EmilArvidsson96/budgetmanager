// ─── Kassaflöde — the waterfall, now budget-aware ─────────────────────────────
//
// Cascades income down through savings/buffer and each expense category to the
// month's net result. Every bar that has a plan gets a transparent "ghost" bar
// in the same category colour, anchored at the same start point as the actual
// bar — like a Gantt chart's baseline vs. actual: if the solid bar falls short
// of the ghost, that's budget headroom left; if it runs past the ghost (or, for
// savings, springs off in the opposite direction because a buffer draw
// happened instead), a red marker flags the overrun. A small plus/minus line
// under the amount spells out the same comparison in kronor.

import { useState } from 'react'
import { X } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { formatCurrency } from '@/utils/budgetHelpers'
import { txKey } from '@/utils/transferReconciliation'
import type { ZlantarTransaction } from '@/types'

export interface SavingsAccountDelta {
  accountId: string
  accountName: string
  opening: number
  closing: number
  delta: number
  known: boolean
}

export interface CashflowExpenseGroup {
  catId: string
  catName: string
  catColor: string
  total: number    // actual, absolute
  budget: number   // planned, absolute — 0 means no plan
  txs: ZlantarTransaction[]
}

export interface CashflowData {
  income: number
  incomeBudget: number
  incomeTxs: ZlantarTransaction[]
  netSavings: number
  savingsBudget: number
  savingsAccounts: SavingsAccountDelta[]
  totalExpenses: number
  totalExpenseBudget: number
  expenseGroups: CashflowExpenseGroup[]
  plannedNet: number
}

function hexToRgba(hex: string, alpha: number): string {
  if (!hex.startsWith('#') || hex.length < 7) return `rgba(148, 163, 184, ${alpha})`
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

// Signed plan-vs-actual comparison. `sense` says which direction is "good":
// 'moreIsGood' for income/net/savings (saving or earning more than planned is
// a win), 'moreIsBad' for expenses (spending more than planned is the overrun).
function makeDiff(actual: number, planned: number | undefined, sense: 'moreIsGood' | 'moreIsBad'): { label: string; tone: 'good' | 'bad' } | undefined {
  if (planned === undefined || planned === 0) return undefined
  const diff = actual - planned
  if (sense === 'moreIsBad') {
    return diff > 0
      ? { label: `+${formatCurrency(diff)} över plan`, tone: 'bad' }
      : { label: `${formatCurrency(-diff)} kvar av plan`, tone: 'good' }
  }
  return diff >= 0
    ? { label: `+${formatCurrency(diff)} över plan`, tone: 'good' }
    : { label: `${formatCurrency(-diff)} under plan`, tone: 'bad' }
}

// One step in the waterfall. `prev`/`next` are the running cumulative totals
// before and after this step (signed — can go below zero). `kind` 'total' bars
// are anchored to the zero line (Inkomst, the final result); 'delta' bars float
// between prev and next. `budget`/`budgetSign` describe the ghost bar: it spans
// from `prev` to `prev ± budget`, independent of which way the actual bar goes
// — so a savings target that turned into a buffer draw shows the ghost and the
// solid bar splaying in opposite directions, making the mismatch obvious.
interface WFStep {
  id: string
  label: string
  prev: number
  next: number
  displayValue: number
  sign: '+' | '−'
  color: string
  kind: 'total' | 'delta'
  txs?: ZlantarTransaction[]
  balances?: SavingsAccountDelta[]
  budget?: number
  budgetSign?: '+' | '−'
  diffLabel?: string
  diffTone?: 'good' | 'bad'
}

export function WaterfallCard({ data }: { data: CashflowData }) {
  const { income, incomeBudget, incomeTxs, netSavings, savingsBudget, savingsAccounts, expenseGroups, plannedNet } = data
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const bufferAmt = netSavings < 0 ? Math.abs(netSavings) : 0
  const savingsAmt = netSavings > 0 ? netSavings : 0

  // Build the running cascade: income (from 0) → +buffer / −savings → −expenses → net.
  const steps: WFStep[] = []

  const incomeDiff = makeDiff(income, incomeBudget, 'moreIsGood')
  steps.push({
    id: 'income', label: 'Inkomst', prev: 0, next: income, displayValue: income, sign: '+', color: '#6479b3', kind: 'total',
    txs: incomeTxs, budget: incomeBudget > 0 ? incomeBudget : undefined, budgetSign: '+',
    diffLabel: incomeDiff?.label, diffTone: incomeDiff?.tone,
  })
  let running = income

  if (bufferAmt > 0) {
    const d = makeDiff(-bufferAmt, savingsBudget > 0 ? savingsBudget : undefined, 'moreIsGood')
    steps.push({
      id: 'buffer', label: 'Från buffert', prev: running, next: running + bufferAmt, displayValue: bufferAmt, sign: '+', color: '#94a3b8', kind: 'delta',
      balances: savingsAccounts, budget: savingsBudget > 0 ? savingsBudget : undefined, budgetSign: '−',
      diffLabel: d?.label, diffTone: d?.tone,
    })
    running += bufferAmt
  } else if (savingsAmt > 0) {
    const d = makeDiff(savingsAmt, savingsBudget > 0 ? savingsBudget : undefined, 'moreIsGood')
    steps.push({
      id: 'savings', label: 'Sparande', prev: running, next: running - savingsAmt, displayValue: savingsAmt, sign: '−', color: '#52a871', kind: 'delta',
      balances: savingsAccounts, budget: savingsBudget > 0 ? savingsBudget : undefined, budgetSign: '−',
      diffLabel: d?.label, diffTone: d?.tone,
    })
    running -= savingsAmt
  }

  for (const g of expenseGroups) {
    const d = makeDiff(g.total, g.budget > 0 ? g.budget : undefined, 'moreIsBad')
    steps.push({
      id: g.catId, label: g.catName, prev: running, next: running - g.total, displayValue: g.total, sign: '−', color: g.catColor, kind: 'delta',
      txs: g.txs, budget: g.budget > 0 ? g.budget : undefined, budgetSign: '−',
      diffLabel: d?.label, diffTone: d?.tone,
    })
    running -= g.total
  }

  const net = running
  const netBudget = plannedNet !== 0 ? Math.abs(plannedNet) : undefined
  const netDiff = makeDiff(net, netBudget !== undefined ? plannedNet : undefined, 'moreIsGood')
  steps.push({
    id: 'net', label: net >= 0 ? 'Överskott' : 'Underskott', prev: 0, next: net, displayValue: Math.abs(net), sign: net >= 0 ? '+' : '−',
    color: net >= 0 ? '#10b981' : '#ef4444', kind: 'total',
    budget: netBudget, budgetSign: plannedNet >= 0 ? '+' : '−',
    diffLabel: netDiff?.label, diffTone: netDiff?.tone,
  })

  // Axis spans every running value AND every ghost extent, so a budget bigger
  // than what actually happened doesn't get clipped off the scale.
  const allVals = steps.flatMap((s) => {
    const vals = [s.prev, s.next]
    if (s.budget !== undefined && s.budgetSign) {
      vals.push(s.prev + (s.budgetSign === '+' ? s.budget : -s.budget))
    }
    return vals
  })
  const axisMax = Math.max(...allVals, 0)
  const axisMin = Math.min(...allVals, 0)
  const span = axisMax - axisMin || 1
  const x = (v: number) => ((v - axisMin) / span) * 100
  const zeroPct = x(0)
  const hasNegative = axisMin < 0

  const detailCount = (s: WFStep) => s.txs?.length ?? s.balances?.length ?? 0
  const selected = steps.find((s) => s.id === selectedId && detailCount(s) > 0) ?? null
  const selectedTxs = selected?.txs
    ? [...selected.txs].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    : []

  return (
    <Card padding={false} className="p-4 md:p-5">
      <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest mb-4">Kassaflöde</div>

      <div className="space-y-1.5">
        {steps.map((s, i) => {
          const lo = Math.min(s.prev, s.next)
          const hi = Math.max(s.prev, s.next)
          const leftPct = x(lo)
          const widthPct = Math.max(x(hi) - x(lo), 0.6)
          const connectorPct = i > 0 ? x(steps[i - 1].next) : null
          const clickable = detailCount(s) > 0
          const isActive = selectedId === s.id
          const isResult = s.id === 'net'

          // Ghost (budget) bar — spans prev → prev±budget, independent of the
          // actual bar's own direction (see WFStep doc above).
          let ghostLeftPct: number | null = null
          let ghostWidthPct = 0
          let overLeftPct: number | null = null
          let overWidthPct = 0
          if (s.budget !== undefined && s.budgetSign) {
            const budgetEnd = s.prev + (s.budgetSign === '+' ? s.budget : -s.budget)
            const gLo = Math.min(s.prev, budgetEnd)
            const gHi = Math.max(s.prev, budgetEnd)
            ghostLeftPct = x(gLo)
            ghostWidthPct = Math.max(x(gHi) - x(gLo), 0.6)
            // Overrun accent: only meaningful when actual moved the same way as
            // the plan intended, and went further than it.
            const sameDirection = (s.next - s.prev >= 0) === (budgetEnd - s.prev >= 0)
            if (sameDirection && Math.abs(s.next - s.prev) > Math.abs(budgetEnd - s.prev)) {
              const oLo = Math.min(budgetEnd, s.next)
              const oHi = Math.max(budgetEnd, s.next)
              overLeftPct = x(oLo)
              overWidthPct = Math.max(x(oHi) - x(oLo), 0.6)
            }
          }

          return (
            <div key={s.id} className={`flex items-center gap-2 md:gap-3 ${isResult ? 'mt-1 pt-2 border-t border-warm-200' : ''}`}>
              <span className={`text-xs w-16 md:w-28 text-right flex-shrink-0 truncate ${isResult ? `font-semibold ${net < 0 ? 'text-red-600' : 'text-emerald-700'}` : 'text-gray-500'}`} title={s.label}>
                {s.label}
              </span>

              <div className="flex-1 relative h-7">
                {/* zero baseline (only meaningful when something dips below 0) */}
                {hasNegative && (
                  <div className="absolute inset-y-0 w-px bg-warm-300" style={{ left: `${zeroPct}%` }} />
                )}
                {/* connector from the previous step's running total */}
                {connectorPct !== null && (
                  <div
                    className="absolute border-l border-dashed border-gray-300"
                    style={{ left: `${connectorPct}%`, top: '-0.3rem', height: '0.3rem' }}
                  />
                )}
                {/* ghost bar — the plan, in a transparent version of the category colour */}
                {ghostLeftPct !== null && (
                  <div
                    className="absolute inset-y-0 rounded-[3px]"
                    style={{ left: `${ghostLeftPct}%`, width: `${ghostWidthPct}%`, backgroundColor: hexToRgba(s.color, 0.28) }}
                  />
                )}
                {/* the floating bar — the actual */}
                <button
                  type="button"
                  disabled={!clickable}
                  onClick={() => clickable && setSelectedId(isActive ? null : s.id)}
                  className={`absolute inset-y-0 rounded-[3px] transition-shadow ${clickable ? 'cursor-pointer hover:ring-2 hover:ring-gray-300' : 'cursor-default'} ${isActive ? 'ring-2 ring-gray-400' : ''}`}
                  style={{ left: `${leftPct}%`, width: `${widthPct}%`, backgroundColor: s.color }}
                  title={clickable ? 'Visa detaljer' : undefined}
                />
                {/* overrun accent — the sliver of actual bar past the plan */}
                {overLeftPct !== null && (
                  <div
                    className="absolute bottom-0 h-[3px] rounded-full bg-red-500/85 pointer-events-none"
                    style={{ left: `${overLeftPct}%`, width: `${overWidthPct}%` }}
                  />
                )}
              </div>

              <div className="w-24 md:w-32 text-right flex-shrink-0">
                <div className={`text-sm tabular-nums ${isResult ? `font-bold ${net < 0 ? 'text-red-600' : 'text-emerald-700'}` : 'font-medium text-gray-800'}`}>
                  {s.sign}{formatCurrency(s.displayValue)}
                </div>
                {s.diffLabel && (
                  <div className={`text-[10px] tabular-nums leading-tight truncate ${s.diffTone === 'bad' ? 'text-red-500' : 'text-emerald-600'}`} title={s.diffLabel}>
                    {s.diffLabel}
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {net < 0 && (
        <p className="text-xs text-gray-400 mt-3 ml-0 md:ml-[7.75rem]">
          Utgifter och sparande översteg inkomsten med {formatCurrency(Math.abs(net))} denna månad.
        </p>
      )}

      {selected && (
        <div className="mt-4 border border-warm-200 rounded-lg overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 bg-warm-50 border-b border-warm-200">
            <span className="text-xs font-semibold text-gray-700 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: selected.color }} />
              {selected.label}
              <span className="text-gray-400 font-normal">
                {selected.balances
                  ? `${selected.balances.length} ${selected.balances.length === 1 ? 'konto' : 'konton'} · ingående → utgående`
                  : `${selectedTxs.length} ${selectedTxs.length === 1 ? 'transaktion' : 'transaktioner'}`}
              </span>
            </span>
            <button onClick={() => setSelectedId(null)} className="text-gray-400 hover:text-gray-700 transition-colors" aria-label="Stäng">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="max-h-72 overflow-y-auto divide-y divide-warm-100">
            {selected.balances
              ? selected.balances.map((b) => (
                  <div key={b.accountId} className="flex items-center gap-3 px-3 py-2">
                    <span className="flex-1 min-w-0 truncate text-sm text-gray-700" title={b.accountName}>{b.accountName}</span>
                    <span className="hidden sm:inline text-xs text-gray-400 tabular-nums shrink-0">{formatCurrency(b.opening)} → {formatCurrency(b.closing)}</span>
                    <span className={`text-xs tabular-nums shrink-0 w-24 text-right font-medium ${b.delta < 0 ? 'text-gray-700' : 'text-emerald-600'}`}>{formatCurrency(b.delta, true)}</span>
                  </div>
                ))
              : selectedTxs.map((tx, i) => (
                  <div key={txKey(tx) + i} className="flex items-center gap-3 px-3 py-2">
                    <span className="text-xs text-gray-400 tabular-nums w-16 shrink-0 truncate">{tx.date.slice(0, 10)}</span>
                    <span className="flex-1 min-w-0 truncate text-sm text-gray-700" title={tx.description || undefined}>{tx.description || '—'}</span>
                    <span className={`text-xs tabular-nums shrink-0 ${tx.amount < 0 ? 'text-gray-700' : 'text-emerald-600'}`}>{formatCurrency(tx.amount)}</span>
                  </div>
                ))}
          </div>
        </div>
      )}
    </Card>
  )
}
