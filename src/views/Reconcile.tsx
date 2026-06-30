import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, CheckCircle2, AlertTriangle, Lock, Unlock, Tag, ArrowLeftRight, X } from 'lucide-react'
import { useAppStore } from '@/store'
import { Layout, PageHeader } from '@/components/layout/Layout'
import { Card, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { MONTH_NAMES_LONG, makeMonthId, formatCurrency } from '@/utils/budgetHelpers'
import { getMonthIdForDate } from '@/utils/periodUtils'
import { budgetedAmount } from '@/utils/projection'
import { reconcileTransfers, reconciledKeysFromRecords, txKey } from '@/utils/transferReconciliation'
import { DEFAULT_ZLANTAR_RULES } from '@/store/defaultCategories'
import type { ZlantarTransaction, ZlantarCategoryRule, TxOverride } from '@/types'

type RuleTarget = { appCategoryId: string; appSubcategoryId?: string }

// Catch-all subcategories of 'other' (Övrigt) that don't count as a real
// categorization — see Transactions.tsx for the matching logic.
const UNCATEGORIZED_OTHER_SUBS = new Set(['uncategorized', 'other'])

function buildRuleLookup(rules: ZlantarCategoryRule[]): Map<string, RuleTarget> {
  const map = new Map<string, RuleTarget>()
  for (const r of rules) {
    const key = r.zlantarSubcategory
      ? `${r.zlantarCategory}|||${r.zlantarSubcategory}`
      : r.zlantarCategory
    map.set(key, { appCategoryId: r.appCategoryId, appSubcategoryId: r.appSubcategoryId })
  }
  return map
}

function resolveCategory(
  rawCat: string,
  rawSub: string,
  catIds: Set<string>,
  ruleMap: Map<string, RuleTarget>,
  override?: TxOverride
): { catId: string; subId: string } {
  if (override) return { catId: override.categoryId, subId: override.subcategoryId ?? '' }
  if (!rawCat) return { catId: 'other', subId: '' }
  const exactMatch = rawSub ? ruleMap.get(`${rawCat}|||${rawSub}`) : undefined
  if (exactMatch) {
    return { catId: exactMatch.appCategoryId, subId: exactMatch.appSubcategoryId ?? rawSub }
  }
  const catMatch = ruleMap.get(rawCat)
  if (catMatch) {
    return { catId: catMatch.appCategoryId, subId: catMatch.appSubcategoryId !== undefined ? catMatch.appSubcategoryId : rawSub }
  }
  if (catIds.has(rawCat)) return { catId: rawCat, subId: rawSub }
  return { catId: 'other', subId: rawSub }
}

export function ReconcileView() {
  const today = new Date()
  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth() + 1)
  const store = useAppStore()
  const { settings, actuals, monthCloses, reconciliations, allTransactions, transactionOverrides } = store
  const { categories, monthStartDay, monthStartBusinessDay, zlantarCategoryRules } = settings

  const monthId = makeMonthId(year, month)
  const actual = actuals[monthId]
  const close = monthCloses[monthId]

  // Note follows the selected month — reset during render when the month changes
  // (React's recommended alternative to a setState-in-effect).
  const [note, setNote] = useState(close?.note ?? '')
  const [noteMonth, setNoteMonth] = useState(monthId)
  if (noteMonth !== monthId) {
    setNoteMonth(monthId)
    setNote(close?.note ?? '')
  }

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

  // Cashflow data for the waterfall.
  //
  // Income and expenses come from the raw transactions (so each bar can list
  // the exact transactions behind it). Transfers are NEVER counted as income
  // or expense.
  //
  // Savings is measured as the balance change of the savings-type accounts
  // over the month — closing minus opening balance — NOT from transfer
  // transactions. Money is always routed through a spender account first, so
  // the transfers in/out would massively double-count; the net balance change
  // is the true amount set aside (or drawn from the buffer). The closing
  // balance is the latest value imported for this month; the opening balance
  // is the previous month's closing balance.
  const prevMonthId = makeMonthId(month === 1 ? year - 1 : year, month === 1 ? 12 : month - 1)
  const cashflowData = useMemo(() => {
    if (!actual) return null
    const catIds = new Set(categories.map((c) => c.id))
    const ruleMap = buildRuleLookup(zlantarCategoryRules ?? DEFAULT_ZLANTAR_RULES)

    let income = 0
    const incomeTxs: ZlantarTransaction[] = []
    const expenseByCat: Record<string, { total: number; txs: ZlantarTransaction[] }> = {}

    for (const tx of allTransactions) {
      if (!tx.date) continue
      if (getMonthIdForDate(tx.date, monthStartDay, monthStartBusinessDay) !== monthId) continue
      if (tx.transaction_type === 'transfer') continue   // never counted

      const { catId } = resolveCategory(
        tx.category ?? '', tx.subcategory ?? '',
        catIds, ruleMap, transactionOverrides[txKey(tx)]
      )
      const cat = categories.find((c) => c.id === catId)
      if (!cat) continue
      if (cat.type === 'income') { income += tx.amount; incomeTxs.push(tx) }
      else if (cat.type === 'expense') {
        const e = expenseByCat[catId] ?? { total: 0, txs: [] }
        e.total += tx.amount
        e.txs.push(tx)
        expenseByCat[catId] = e
      }
    }

    // Savings from balance change of savings-type accounts.
    const savingsTypes = new Set<string>(['savings', 'isk', 'investment'])
    const openingMap = new Map(
      (actuals[prevMonthId]?.accountBalances ?? []).map((ab) => [ab.accountId, ab.balance])
    )
    const savingsAccounts = actual.accountBalances
      .filter((ab) => savingsTypes.has(ab.accountType))
      .map((ab) => {
        const opening = openingMap.get(ab.accountId)
        const closing = ab.balance
        return {
          accountId: ab.accountId,
          accountName: ab.accountName,
          opening: opening ?? closing,
          closing,
          delta: opening === undefined ? 0 : closing - opening,
          known: opening !== undefined,
        }
      })
      .filter((a) => a.delta !== 0)
    const netSavings = savingsAccounts.reduce((s, a) => s + a.delta, 0)

    const expenseGroups = categories
      .filter((c) => c.type === 'expense' && expenseByCat[c.id])
      .map((c) => ({
        catId: c.id,
        catName: c.name,
        catColor: c.color ?? '#94a3b8',
        total: Math.abs(expenseByCat[c.id].total),
        txs: expenseByCat[c.id].txs,
      }))
    const totalExpenses = expenseGroups.reduce((s, g) => s + g.total, 0)

    return { income, incomeTxs, netSavings, savingsAccounts, totalExpenses, expenseGroups }
  }, [actual, actuals, prevMonthId, allTransactions, categories, zlantarCategoryRules, transactionOverrides, monthStartDay, monthStartBusinessDay, monthId])

  // Checklist signals.
  // Only entries in Övrigt WITHOUT a meaningful subcategory count as
  // uncategorized: the catch-all subs ('uncategorized', 'other') and any
  // unmatched/empty subId. Real Övrigt subcats (Hälsa, Barn, etc.) are
  // categorized. (Sum across all matching entries — there's one per subcategory.)
  const uncategorizedCount = useMemo(() => {
    const otherCat = categories.find((c) => c.id === 'other')
    const realSubIds = new Set((otherCat?.subcategories ?? []).map((s) => s.id))
    return (actual?.entries ?? [])
      .filter((e) => e.categoryId === 'other')
      .filter((e) => {
        const sub = e.subcategoryId
        const categorized = !!sub && realSubIds.has(sub) && !UNCATEGORIZED_OTHER_SUBS.has(sub)
        return !categorized
      })
      .reduce((sum, e) => sum + e.transactionCount, 0)
  }, [actual, categories])
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

          {/* Kassaflöde waterfall */}
          {cashflowData && (cashflowData.income > 0 || cashflowData.totalExpenses > 0) && (
            <WaterfallCard data={cashflowData} />
          )}

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

// ─── Kassaflöde ────────────────────────────────────────────────────────────────

interface SavingsAccountDelta {
  accountId: string
  accountName: string
  opening: number
  closing: number
  delta: number
  known: boolean
}

interface CFRow {
  id: string
  label: string
  value: number
  color: string
  sign: '+' | '−'
  txs?: ZlantarTransaction[]
  balances?: SavingsAccountDelta[]
}

interface CashflowExpenseGroup {
  catId: string
  catName: string
  catColor: string
  total: number
  txs: ZlantarTransaction[]
}

interface CashflowData {
  income: number
  incomeTxs: ZlantarTransaction[]
  netSavings: number
  savingsAccounts: SavingsAccountDelta[]
  totalExpenses: number
  expenseGroups: CashflowExpenseGroup[]
}

function WaterfallCard({ data }: { data: CashflowData }) {
  const { income, incomeTxs, netSavings, savingsAccounts, expenseGroups } = data
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const bufferAmt = netSavings < 0 ? Math.abs(netSavings) : 0
  const savingsAmt = netSavings > 0 ? netSavings : 0
  const totalExpenses = expenseGroups.reduce((s, g) => s + g.total, 0)
  const net = income - netSavings - totalExpenses

  // Money coming in this month.
  const inRows: CFRow[] = [
    { id: 'income', label: 'Inkomst', value: income, color: '#6479b3', sign: '+', txs: incomeTxs },
    ...(bufferAmt > 0
      ? [{ id: 'buffer', label: 'Från buffert', value: bufferAmt, color: '#94a3b8', sign: '+' as const, balances: savingsAccounts }]
      : []),
  ]
  // Where it went.
  const outRows: CFRow[] = [
    ...(savingsAmt > 0
      ? [{ id: 'savings', label: 'Sparande', value: savingsAmt, color: '#52a871', sign: '−' as const, balances: savingsAccounts }]
      : []),
    ...expenseGroups.map((g) => ({ id: g.catId, label: g.catName, value: g.total, color: g.catColor, sign: '−' as const, txs: g.txs })),
  ]

  // Scale so the largest single bar fills the track.
  const scale = Math.max(income, bufferAmt, savingsAmt, ...expenseGroups.map((g) => g.total), Math.abs(net), 1)
  const toPct = (v: number) => Math.max(2, Math.min(100, (v / scale) * 100))

  const detailCount = (row: CFRow) => row.txs?.length ?? row.balances?.length ?? 0
  const allRows = [...inRows, ...outRows]
  const selected = allRows.find((r) => r.id === selectedId && detailCount(r) > 0) ?? null
  const selectedTxs = selected?.txs
    ? [...selected.txs].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    : []

  const Row = ({ row }: { row: CFRow }) => {
    const clickable = detailCount(row) > 0
    const isActive = selectedId === row.id
    return (
      <div className="flex items-center gap-3">
        <span className="text-xs w-24 md:w-28 text-right flex-shrink-0 text-gray-500 truncate" title={row.label}>{row.label}</span>
        <button
          type="button"
          disabled={!clickable}
          onClick={() => clickable && setSelectedId(isActive ? null : row.id)}
          className={`flex-1 relative h-6 bg-warm-50 rounded-md overflow-hidden transition-shadow ${clickable ? 'cursor-pointer hover:ring-2 hover:ring-gray-200' : 'cursor-default'} ${isActive ? 'ring-2 ring-gray-400' : ''}`}
          title={clickable ? 'Visa detaljer' : undefined}
        >
          <div
            className="absolute inset-y-0 left-0 rounded-md transition-all duration-300"
            style={{ width: `${toPct(row.value)}%`, backgroundColor: row.color }}
          />
        </button>
        <span className="text-sm w-24 text-right flex-shrink-0 tabular-nums font-medium text-gray-800">
          {row.sign}{formatCurrency(row.value)}
        </span>
      </div>
    )
  }

  return (
    <Card padding={false} className="p-4 md:p-5">
      <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest mb-4">Kassaflöde</div>

      <div className="space-y-1.5">
        {inRows.map((row) => <Row key={row.id} row={row} />)}
      </div>

      <div className="my-2.5 border-t border-warm-100" />

      <div className="space-y-1.5">
        {outRows.map((row) => <Row key={row.id} row={row} />)}
      </div>

      {/* Result */}
      <div className="mt-3 pt-3 border-t border-warm-200">
        <div className="flex items-center gap-3">
          <span className={`text-xs w-24 md:w-28 text-right flex-shrink-0 font-semibold ${net < 0 ? 'text-red-600' : 'text-emerald-700'}`}>
            {net < 0 ? 'Underskott' : 'Överskott'}
          </span>
          <div className="flex-1 relative h-6 bg-warm-50 rounded-md overflow-hidden">
            <div
              className="absolute inset-y-0 left-0 rounded-md"
              style={{ width: `${toPct(Math.abs(net))}%`, backgroundColor: net < 0 ? '#ef4444' : '#10b981' }}
            />
          </div>
          <span className={`text-sm w-24 text-right flex-shrink-0 tabular-nums font-bold ${net < 0 ? 'text-red-600' : 'text-emerald-700'}`}>
            {net < 0 ? '−' : '+'}{formatCurrency(Math.abs(net))}
          </span>
        </div>
        {net < 0 && (
          <p className="text-xs text-gray-400 mt-2 ml-[6.75rem] md:ml-[7.75rem]">
            Utgifter och sparande översteg inkomsten med {formatCurrency(Math.abs(net))} denna månad.
          </p>
        )}
      </div>

      {selected && (
        <div className="mt-4 border border-warm-200 rounded-lg overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 bg-warm-50 border-b border-warm-200">
            <span className="text-xs font-semibold text-gray-700 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: selected.color }} />
              {selected.label}
              <span className="text-gray-400 font-normal">
                {selected.balances
                  ? `${selected.balances.length} ${selected.balances.length === 1 ? 'konto' : 'konton'} · ingående → utgående`
                  : `${selectedTxs.length} transaktioner`}
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
                    <span className="flex-1 truncate text-sm text-gray-700" title={b.accountName}>{b.accountName}</span>
                    <span className="text-xs text-gray-400 tabular-nums shrink-0">{formatCurrency(b.opening)} → {formatCurrency(b.closing)}</span>
                    <span className={`text-xs tabular-nums shrink-0 w-24 text-right font-medium ${b.delta < 0 ? 'text-gray-700' : 'text-emerald-600'}`}>{formatCurrency(b.delta, true)}</span>
                  </div>
                ))
              : selectedTxs.map((tx, i) => (
                  <div key={txKey(tx) + i} className="flex items-center gap-3 px-3 py-2">
                    <span className="text-xs text-gray-400 tabular-nums w-20 shrink-0">{tx.date}</span>
                    <span className="flex-1 truncate text-sm text-gray-700" title={tx.description || undefined}>{tx.description || '—'}</span>
                    <span className={`text-xs tabular-nums shrink-0 ${tx.amount < 0 ? 'text-gray-700' : 'text-emerald-600'}`}>{formatCurrency(tx.amount)}</span>
                  </div>
                ))}
          </div>
        </div>
      )}
    </Card>
  )
}
