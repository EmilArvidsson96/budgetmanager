import { useMemo, useState } from 'react'
import { ChevronRight, Sparkles, ListTree } from 'lucide-react'
import { useAppStore } from '@/store'
import { AmountInput } from '@/components/ui/AmountInput'
import { formatCurrency, makeMonthId } from '@/utils/budgetHelpers'
import { suggestForCategory } from '@/utils/budgetSuggestions'
import { baselineTarget } from '@/utils/projection'
import type { CategoryDef } from '@/types'

// The standing "normalmånad" plan. Edited here in Plan; drives the projection
// above and the month-vs-plan follow-up in Flöde. Income + expense only — saving
// is modelled via per-account contributions (see Innehav) to avoid double counting.
export function BaselineEditor() {
  const store = useAppStore()
  const { categories } = store.settings

  const today = new Date()
  const refMonthId = makeMonthId(today.getFullYear(), today.getMonth() + 1)

  const ordered = useMemo(() => {
    const budgetCats = categories.filter((c) => c.type === 'income' || c.type === 'expense')
    return [
      ...budgetCats.filter((c) => c.type === 'income'),
      ...budgetCats.filter((c) => c.type === 'expense'),
    ]
  }, [categories])

  const planned = useMemo(() => {
    let income = 0
    let expense = 0
    for (const cat of ordered) {
      const t = baselineTarget(store, cat.id) ?? 0
      if (cat.type === 'income') income += t
      else expense += Math.abs(t)
    }
    return { income, expense, net: income - expense }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ordered, store.budgetBaseline])

  return (
    <div>
      {/* Planned-month summary */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <SummaryStat label="Inkomst / mån" value={planned.income} tone="income" />
        <SummaryStat label="Utgifter / mån" value={-planned.expense} tone="expense" />
        <SummaryStat label="Kvar / mån" value={planned.net} tone={planned.net >= 0 ? 'income' : 'expense'} />
      </div>

      <div className="rounded-xl border border-warm-200 overflow-hidden">
        {ordered.map((cat) => (
          <BaselineRow key={cat.id} cat={cat} refMonthId={refMonthId} />
        ))}
      </div>

      <p className="text-xs text-gray-400 mt-3">
        Förslag bygger på din historik (importerade månader). Sparande planeras via kontonas
        månadsinsättning under <span className="font-medium">Innehav</span> — inte här — för att undvika dubbelräkning.
      </p>
    </div>
  )
}

function SummaryStat({ label, value, tone }: { label: string; value: number; tone: 'income' | 'expense' }) {
  return (
    <div className="bg-white border border-warm-200 rounded-xl px-3 py-2.5">
      <p className="text-[11px] text-gray-400 mb-0.5">{label}</p>
      <p className={`text-base font-semibold tabular-nums ${tone === 'income' ? 'text-emerald-700' : 'text-gray-900'}`}>
        {formatCurrency(value)}
      </p>
    </div>
  )
}

function BaselineRow({ cat, refMonthId }: { cat: CategoryDef; refMonthId: string }) {
  const store = useAppStore()
  const [expanded, setExpanded] = useState(false)

  const current = store.budgetBaseline.categories.find((c) => c.categoryId === cat.id)
  const bySub = !!current?.bySub
  const effective = baselineTarget(store, cat.id) ?? 0
  const isIncome = cat.type === 'income'
  const hasSubs = cat.subcategories.length > 0

  const suggestions = useMemo(
    () => suggestForCategory(store, refMonthId, cat.id),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [store.actuals, store.settings.recurringItems, refMonthId, cat.id]
  )

  const setFlat = (target: number) =>
    store.upsertBaselineCategory({ categoryId: cat.id, target, bySub: false, subTargets: current?.subTargets })

  const enableBySub = () => {
    const subTargets = cat.subcategories.map((s) => ({
      subcategoryId: s.id,
      target: current?.subTargets?.find((t) => t.subcategoryId === s.id)?.target ?? 0,
    }))
    const target = subTargets.reduce((s, t) => s + t.target, 0)
    store.upsertBaselineCategory({ categoryId: cat.id, target, bySub: true, subTargets })
    setExpanded(true)
  }
  const disableBySub = () =>
    store.upsertBaselineCategory({ categoryId: cat.id, target: current?.target ?? 0, bySub: false, subTargets: current?.subTargets })

  const setSub = (subId: string, target: number) => {
    const base = current?.subTargets ?? cat.subcategories.map((s) => ({ subcategoryId: s.id, target: 0 }))
    let subTargets = base.map((t) => (t.subcategoryId === subId ? { ...t, target } : t))
    if (!subTargets.some((t) => t.subcategoryId === subId)) subTargets = [...subTargets, { subcategoryId: subId, target }]
    const sum = subTargets.reduce((s, t) => s + t.target, 0)
    store.upsertBaselineCategory({ categoryId: cat.id, target: sum, bySub: true, subTargets })
  }

  // Suggestion chips (rounded, applied as a flat target on click).
  const chips: { label: string; value: number }[] = []
  if (suggestions.avg6 !== undefined && suggestions.avg6 !== 0) chips.push({ label: 'snitt 6m', value: suggestions.avg6 })
  if (suggestions.lastMonth !== undefined && suggestions.lastMonth !== 0) chips.push({ label: 'förra mån', value: Math.round(suggestions.lastMonth) })
  if (suggestions.recurring !== undefined) chips.push({ label: 'fast del', value: Math.round(suggestions.recurring) })

  return (
    <div className="border-b border-warm-100 last:border-0">
      <div className="flex items-center gap-2 px-3 md:px-4 py-2.5">
        {hasSubs ? (
          <button
            onClick={() => setExpanded((v) => !v)}
            className="text-gray-300 hover:text-gray-600 transition-colors shrink-0"
            aria-label="Visa underkategorier"
          >
            <ChevronRight className={`w-3.5 h-3.5 transition-transform ${expanded ? 'rotate-90' : ''}`} />
          </button>
        ) : (
          <span className="w-3.5 shrink-0" />
        )}
        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: cat.color ?? '#94a3b8' }} />
        <span className="text-sm font-medium text-gray-800 truncate flex-1 min-w-0">{cat.name}</span>

        {/* Suggestion chips */}
        <div className="hidden md:flex items-center gap-1 shrink-0">
          {chips.map((c) => (
            <button
              key={c.label}
              onClick={() => setFlat(c.value)}
              title={`Sätt till ${formatCurrency(c.value)}`}
              className="text-[11px] rounded-full border border-warm-200 bg-warm-50 px-2 py-0.5 text-gray-500 hover:border-brand-300 hover:text-brand-700 transition-colors tabular-nums"
            >
              {c.label} {formatCurrency(c.value)}
            </button>
          ))}
        </div>

        {/* Category target */}
        <div className="w-28 shrink-0">
          {bySub ? (
            <div className="text-right text-sm font-medium tabular-nums text-gray-800 pr-8 relative">
              {formatCurrency(effective)}
              <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] text-gray-300">kr</span>
            </div>
          ) : (
            <AmountInput value={effective} onChange={setFlat} defaultNegative={!isIncome} />
          )}
        </div>

        {/* Per-subcategory toggle */}
        {hasSubs && (
          <button
            onClick={bySub ? disableBySub : enableBySub}
            title={bySub ? 'Tillbaka till ett belopp' : 'Bygg från underkategorier'}
            className={`shrink-0 p-1 rounded-md transition-colors ${bySub ? 'text-brand-600 bg-brand-50' : 'text-gray-300 hover:text-gray-600'}`}
          >
            <ListTree className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Mobile chips */}
      {chips.length > 0 && (
        <div className="flex md:hidden items-center gap-1 flex-wrap px-3 pb-2 pl-9">
          <Sparkles className="w-3 h-3 text-gray-300" />
          {chips.map((c) => (
            <button
              key={c.label}
              onClick={() => setFlat(c.value)}
              className="text-[11px] rounded-full border border-warm-200 bg-warm-50 px-2 py-0.5 text-gray-500 active:border-brand-300 tabular-nums"
            >
              {c.label} {formatCurrency(c.value)}
            </button>
          ))}
        </div>
      )}

      {/* Subcategory inputs */}
      {hasSubs && expanded && (
        <div className="bg-warm-50/60 px-3 md:px-4 pb-2">
          {bySub ? (
            cat.subcategories.map((sub) => {
              const subTarget = current?.subTargets?.find((t) => t.subcategoryId === sub.id)?.target ?? 0
              return (
                <div key={sub.id} className="flex items-center gap-2 py-1.5 pl-6">
                  <span className="text-sm text-gray-500 flex-1 truncate">{sub.name}</span>
                  <div className="w-28 shrink-0">
                    <AmountInput value={subTarget} onChange={(v) => setSub(sub.id, v)} defaultNegative={!isIncome} />
                  </div>
                </div>
              )
            })
          ) : (
            <p className="text-xs text-gray-400 py-2 pl-6">
              Slå på <ListTree className="w-3 h-3 inline -mt-0.5" />-knappen för att budgetera per underkategori.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
