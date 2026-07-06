// ─── Månadsskiftets utrymme — "kvar att röra er med" ──────────────────────────
//
// The forward half of the reconciliation ritual. Shown only when the reviewed
// month sits at the current boundary (its next period is the one running now,
// or later): translates the new period's salary into "kvar efter räkningar"
// and a recommended personal allowance, coloured by how the reviewed month
// actually went — "förra månaden var tuff, håll igen den här".

import { useMemo } from 'react'
import { HandCoins, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { useAppStore } from '@/store'
import { Card, CardHeader } from '@/components/ui/Card'
import { formatCurrency } from '@/utils/budgetHelpers'
import { currentMonthId } from '@/utils/projection'
import {
  buildMonthOutcome,
  buildSpendingSpace,
  nextMonthIdOf,
  monthLabelOf,
  type MonthOutcome,
} from '@/utils/spendingSpace'

// One or two short sentences on why the reviewed month landed where it did.
function outcomeLines(o: MonthOutcome): string[] {
  const lines: string[] = []
  if (o.expenseDiff > 500) {
    const drivers = o.topOverruns.length
      ? ` — störst: ${o.topOverruns.map((d) => `${d.name} ${formatCurrency(d.diff, true)}`).join(', ')}`
      : ''
    lines.push(`Utgifterna blev ${formatCurrency(o.expenseDiff)} över plan${drivers}.`)
  } else if (o.expenseDiff < -500) {
    const best = o.biggestUnderrun
      ? ` — mest ${o.biggestUnderrun.name} (${formatCurrency(o.biggestUnderrun.diff, true)})`
      : ''
    lines.push(`Utgifterna höll sig ${formatCurrency(-o.expenseDiff)} under plan${best}.`)
  }
  if (Math.abs(o.incomeDiff) > 1000) {
    lines.push(`Inkomsten blev ${formatCurrency(o.incomeDiff, true)} mot plan.`)
  }
  if (o.savingsDrawdown > 0) {
    lines.push(`${formatCurrency(o.savingsDrawdown)} togs ur bufferten/sparandet.`)
  } else if (o.savingsDiff !== null && o.savingsDiff < -500) {
    lines.push(`Sparandet blev ${formatCurrency(-o.savingsDiff)} under plan.`)
  } else if (o.savingsDiff !== null && o.savingsDiff > 500) {
    lines.push(`Sparandet slog planen med ${formatCurrency(o.savingsDiff)}.`)
  }
  if (lines.length === 0) lines.push('Månaden landade nära plan.')
  return lines
}

interface RowProps {
  label: string
  amount: number
  sign?: '+' | '−'
  subtotal?: boolean
  perPerson?: number
  muted?: boolean
}

function Row({ label, amount, sign, subtotal, perPerson, muted }: RowProps) {
  return (
    <div
      className={`flex items-baseline gap-3 py-1.5 ${subtotal ? 'border-t border-warm-200 mt-1 pt-2' : ''}`}
    >
      <span className={`text-sm flex-1 ${subtotal ? 'font-medium text-gray-800' : muted ? 'text-gray-400' : 'text-gray-600'}`}>
        {label}
      </span>
      {perPerson !== undefined && (
        <span className="text-xs text-gray-400 tabular-nums">≈ {formatCurrency(perPerson)} var</span>
      )}
      <span
        className={`text-sm tabular-nums text-right w-28 ${
          subtotal
            ? `font-semibold ${amount < 0 ? 'text-red-600' : 'text-gray-900'}`
            : muted ? 'text-gray-400' : 'text-gray-700'
        }`}
      >
        {sign ? `${sign}${formatCurrency(Math.abs(amount))}` : formatCurrency(amount)}
      </span>
    </div>
  )
}

export function SpendingSpaceCard({ reviewedMonthId }: { reviewedMonthId: string }) {
  const store = useAppStore()
  const atBoundary = nextMonthIdOf(reviewedMonthId) >= currentMonthId(store)

  const data = useMemo(() => {
    if (!atBoundary) return null
    const outcome = buildMonthOutcome(store, reviewedMonthId)
    const space = buildSpendingSpace(store, reviewedMonthId, outcome)
    return space ? { outcome, space } : null
  }, [store, reviewedMonthId, atBoundary])

  if (!data) return null
  const { outcome, space } = data
  const tough = outcome?.tough ?? false

  // The one-line recommendation the ritual exists for.
  let suggestion: string
  if (space.margin <= 0) {
    suggestion =
      'Planen tilldelar redan hela inkomsten — det finns inget fritt utrymme att fördela. Justera budgeten om ni vill ha eget utrymme.'
  } else if (tough && space.suggestedPerPerson <= 0) {
    suggestion = `Förra månaden var tuff (${formatCurrency(space.holdBack)} mot plan) — tilldela er inget eget utrymme denna månad och låt marginalen läka sparandet.`
  } else if (tough) {
    suggestion = `Förra månaden var tuff — håll igen med ~${formatCurrency(space.holdBack)}. Tilldela er ~${formatCurrency(space.suggestedPerPerson)} var i eget utrymme i stället för ${formatCurrency(space.marginPerPerson)} var.`
  } else {
    suggestion = `Planen höll förra månaden — ett eget utrymme på ~${formatCurrency(space.suggestedPerPerson)} var ryms i marginalen.`
  }

  return (
    <Card>
      <CardHeader
        title={`Kvar att röra er med i ${space.monthLabel}`}
        subtitle={
          space.incomeSource === 'actual'
            ? 'Baserat på inkomsten som kommit in i nya perioden'
            : 'Baserat på planerad inkomst — nya periodens lön är inte importerad ännu'
        }
      />

      <div>
        <Row label="Inkomst" amount={space.income} sign="+" />
        <Row
          label="Räkningar & fasta poster"
          amount={space.bills}
          sign="−"
          muted={!space.billsKnown}
        />
        <Row
          label="Kvar efter räkningar"
          amount={space.afterBills}
          subtotal
          perPerson={space.afterBillsPerPerson}
        />
        <Row label="Rörlig budget (mat, nöje m.m.)" amount={space.variablePlanned} sign="−" />
        <Row label="Planerat sparande" amount={space.savingsPlanned} sign="−" />
        <Row label="Fritt utrymme" amount={space.margin} subtotal perPerson={space.marginPerPerson} />
      </div>

      {!space.billsKnown && (
        <p className="text-xs text-gray-400 mt-2">
          Inga fasta poster registrerade — "kvar efter räkningar" visar därför hela inkomsten. Lägg in
          räkningarna under Inställningar → Återkommande poster.
        </p>
      )}

      {outcome && (
        <div
          className={`mt-4 rounded-xl border px-4 py-3 ${
            tough ? 'bg-amber-50 border-amber-200' : 'bg-emerald-50 border-emerald-200'
          }`}
        >
          <div className="flex gap-2.5">
            {tough ? (
              <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
            ) : (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" />
            )}
            <div>
              <p className={`text-[11px] font-semibold uppercase tracking-wide ${tough ? 'text-amber-700' : 'text-emerald-700'}`}>
                Så gick {monthLabelOf(reviewedMonthId)}
              </p>
              <ul className={`text-sm leading-relaxed mt-0.5 space-y-0.5 ${tough ? 'text-amber-800' : 'text-emerald-800'}`}>
                {outcomeLines(outcome).map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      <div className="mt-3 flex gap-3 rounded-xl bg-brand-50 border border-brand-100 px-4 py-3">
        <HandCoins className="w-4 h-4 text-brand-600 mt-0.5 shrink-0" />
        <div>
          <p className="text-[11px] font-semibold text-brand-700 uppercase tracking-wide">
            Förslag inför {space.monthLabel}
          </p>
          <p className="text-sm text-gray-800 leading-relaxed">{suggestion}</p>
        </div>
      </div>
    </Card>
  )
}
