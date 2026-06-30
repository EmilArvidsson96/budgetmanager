// ─── The report itself ────────────────────────────────────────────────────────
//
// Presentational only — give it a built MonthlyReport + a summary line and it
// renders the page that gets shown / printed to PDF. Brief: minimal text, big
// bold numbers, graphs. Everything inside #manadsrapport is what the print CSS
// isolates onto the page (see index.css).

import { ArrowUpRight, ArrowDownRight, PiggyBank, Wallet, Coins, TrendingUp, Sparkles } from 'lucide-react'
import { formatCurrency } from '@/utils/budgetHelpers'
import type { MonthlyReport, ReportStat } from '@/utils/report'
import { Donut, MiniBars, Sparkline, FlowBar, type Slice } from './charts'

const INCOME = '#059669'
const SAVINGS = '#2563eb'
const LEFTOVER = '#0d9488'
const EXPENSE_BAR = '#C96332'

// Small "vs snitt / vs förra mån" delta line under a big number.
function Delta({ stat, goodWhenHigher }: { stat: ReportStat; goodWhenHigher: boolean }) {
  const ref = stat.avg ?? stat.prev
  const refLabel = stat.avg !== undefined ? 'mot snitt' : 'mot förra mån'
  if (ref === undefined) return <p className="text-[11px] text-gray-300 mt-1">&nbsp;</p>

  const diff = stat.actual - ref
  if (Math.abs(diff) < ref * 0.01 || Math.abs(diff) < 50) {
    return <p className="text-[11px] text-gray-400 mt-1 tabular-nums">i nivå med snittet</p>
  }
  const up = diff > 0
  const good = goodWhenHigher ? up : !up
  const Icon = up ? ArrowUpRight : ArrowDownRight
  return (
    <p className={`text-[11px] mt-1 flex items-center gap-0.5 tabular-nums ${good ? 'text-emerald-600' : 'text-brand-600'}`}>
      <Icon className="w-3 h-3" />
      {formatCurrency(Math.abs(diff))} {refLabel}
    </p>
  )
}

function StatCard({
  label,
  value,
  color,
  icon,
  delta,
}: {
  label: string
  value: string
  color: string
  icon: React.ReactNode
  delta?: React.ReactNode
}) {
  return (
    <div className="bg-white rounded-2xl border border-warm-300 px-4 py-3.5">
      <div className="flex items-center gap-1.5 text-gray-400 mb-1.5">
        {icon}
        <span className="text-xs font-medium">{label}</span>
      </div>
      <p className="text-2xl font-bold tabular-nums leading-none" style={{ color }}>
        {value}
      </p>
      {delta}
    </div>
  )
}

const HIGHLIGHT_TONE: Record<string, string> = {
  good: 'bg-emerald-50 text-emerald-800 border-emerald-100',
  milestone: 'bg-blue-50 text-blue-800 border-blue-100',
  bad: 'bg-brand-50 text-brand-800 border-brand-100',
  neutral: 'bg-warm-100 text-warm-800 border-warm-300',
}

export function MonthlyReportCard({ report, summary }: { report: MonthlyReport; summary: string }) {
  const positive = report.net.actual >= 0

  const donutData: Slice[] = report.categories.map((c) => ({ label: c.name, value: c.amount, color: c.color }))

  const flowSegments = [
    { label: 'Utgifter', frac: report.flow.expenseFrac, amount: report.expense.actual, color: EXPENSE_BAR },
    { label: 'Sparande', frac: report.flow.savingsFrac, amount: Math.max(0, report.savings.actual), color: SAVINGS },
    { label: 'Kvar', frac: report.flow.leftoverFrac, amount: report.flow.leftover, color: LEFTOVER },
  ]

  const nwDelta =
    report.netWorth && report.netWorth.prev !== undefined
      ? report.netWorth.value - report.netWorth.prev
      : undefined

  return (
    <div id="manadsrapport" className="report-print space-y-5">
      {/* ── Hero ── */}
      <div
        className="rounded-3xl border border-brand-100 px-6 py-7 md:px-8 md:py-8"
        style={{ background: 'linear-gradient(135deg, #FDF6F1 0%, #F9E8DA 100%)' }}
      >
        <p className="text-xs font-semibold uppercase tracking-widest text-brand-500 mb-1">Månadsrapport</p>
        <h1 className="text-3xl md:text-4xl font-bold text-warm-900 tracking-tight">{report.title}</h1>

        <p className="mt-4 text-base md:text-lg text-warm-800 leading-snug max-w-2xl flex gap-2">
          <Sparkles className="w-4 h-4 mt-1 shrink-0 text-brand-400" />
          <span>{summary}</span>
        </p>

        <div className="mt-6 flex items-end gap-3">
          <div>
            <p className="text-xs font-medium text-warm-600 mb-1">Resultat</p>
            <p
              className="text-4xl md:text-5xl font-extrabold tabular-nums leading-none"
              style={{ color: positive ? INCOME : '#dc2626' }}
            >
              {formatCurrency(report.net.actual, true)}
            </p>
          </div>
          <span
            className={`mb-1 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${
              positive ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
            }`}
          >
            {positive ? <TrendingUp className="w-3.5 h-3.5" /> : <ArrowDownRight className="w-3.5 h-3.5" />}
            {positive ? 'Överskott' : 'Underskott'}
          </span>
        </div>
      </div>

      {/* ── Highlights ── */}
      {report.highlights.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {report.highlights.map((h, i) => (
            <span
              key={i}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium ${HIGHLIGHT_TONE[h.tone]}`}
            >
              <span aria-hidden>{h.icon}</span>
              {h.text}
            </span>
          ))}
        </div>
      )}

      {/* ── Key numbers ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard
          label="Inkomst"
          value={formatCurrency(report.income.actual)}
          color={INCOME}
          icon={<Wallet className="w-3.5 h-3.5" />}
          delta={<Delta stat={report.income} goodWhenHigher />}
        />
        <StatCard
          label="Utgifter"
          value={formatCurrency(report.expense.actual)}
          color="#1f2937"
          icon={<Coins className="w-3.5 h-3.5" />}
          delta={<Delta stat={report.expense} goodWhenHigher={false} />}
        />
        <StatCard
          label="Sparande"
          value={report.savings.known ? formatCurrency(report.savings.actual, true) : '–'}
          color={SAVINGS}
          icon={<PiggyBank className="w-3.5 h-3.5" />}
          delta={
            report.savings.known ? (
              <Delta stat={report.savings} goodWhenHigher />
            ) : (
              <p className="text-[11px] text-gray-400 mt-1">saknar föregående månad</p>
            )
          }
        />
        <StatCard
          label="Sparkvot"
          value={report.savings.known && report.income.actual > 0 ? `${Math.round(report.savingsRate * 100)} %` : '–'}
          color={LEFTOVER}
          icon={<TrendingUp className="w-3.5 h-3.5" />}
          delta={<p className="text-[11px] text-gray-400 mt-1">av inkomsten</p>}
        />
      </div>

      {/* ── Where the money went + how income was used ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white rounded-2xl border border-warm-300 p-5">
          <h3 className="text-base font-semibold text-gray-900 mb-4">Vart pengarna gick</h3>
          {donutData.length > 0 ? (
            <div className="flex flex-col sm:flex-row items-center gap-5">
              <Donut data={donutData} size={168} thickness={26}>
                <span className="text-[11px] text-gray-400">Utgifter</span>
                <span className="text-lg font-bold text-gray-900 tabular-nums leading-tight">
                  {formatCurrency(report.expense.actual)}
                </span>
              </Donut>
              <ul className="flex-1 space-y-2 min-w-0">
                {report.categories.map((c) => (
                  <li key={c.id} className="flex items-center gap-2 text-sm min-w-0">
                    <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: c.color }} />
                    <span className="text-gray-600 truncate flex-1 min-w-0">{c.name}</span>
                    <span className="text-gray-900 font-medium tabular-nums shrink-0">{formatCurrency(c.amount)}</span>
                    <span className="text-gray-400 tabular-nums w-9 text-right shrink-0">{Math.round(c.share * 100)}%</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-sm text-gray-400 py-8 text-center">Inga utgifter registrerade.</p>
          )}
        </div>

        <div className="bg-white rounded-2xl border border-warm-300 p-5">
          <h3 className="text-base font-semibold text-gray-900 mb-1">Så användes inkomsten</h3>
          <p className="text-sm text-gray-400 mb-5">Av {formatCurrency(report.flow.base)} in</p>
          <FlowBar segments={flowSegments} />
          <ul className="mt-5 space-y-2.5">
            {flowSegments.map((s) => (
              <li key={s.label} className="flex items-center gap-2 text-sm">
                <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: s.color }} />
                <span className="text-gray-600 flex-1">{s.label}</span>
                <span className="text-gray-900 font-medium tabular-nums">{formatCurrency(s.amount)}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* ── Trend + net worth ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {report.trend.length > 1 && (
          <div className="bg-white rounded-2xl border border-warm-300 p-5">
            <h3 className="text-base font-semibold text-gray-900 mb-4">Resultat per månad</h3>
            <MiniBars data={report.trend.map((t) => ({ label: t.label, value: t.net }))} />
          </div>
        )}

        {report.netWorth && (
          <div className="bg-white rounded-2xl border border-warm-300 p-5">
            <h3 className="text-base font-semibold text-gray-900 mb-1">Förmögenhet</h3>
            <div className="flex items-baseline gap-2 mb-3">
              <span className="text-2xl font-bold text-gray-900 tabular-nums">{formatCurrency(report.netWorth.value)}</span>
              {nwDelta !== undefined && Math.abs(nwDelta) >= 1 && (
                <span className={`text-xs font-semibold tabular-nums flex items-center gap-0.5 ${nwDelta >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                  {nwDelta >= 0 ? <ArrowUpRight className="w-3.5 h-3.5" /> : <ArrowDownRight className="w-3.5 h-3.5" />}
                  {formatCurrency(Math.abs(nwDelta))}
                </span>
              )}
            </div>
            {report.netWorth.series.length > 1 ? (
              <Sparkline data={report.netWorth.series} color="#111827" />
            ) : (
              <p className="text-sm text-gray-400">Mer historik behövs för en trendkurva.</p>
            )}
          </div>
        )}
      </div>

      <p className="text-center text-[11px] text-gray-400 pt-1">Budgethanteraren · {report.title}</p>
    </div>
  )
}
