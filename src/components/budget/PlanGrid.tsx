import { useMemo, useState } from 'react'
import { Plus, X, RotateCcw } from 'lucide-react'
import { useAppStore } from '@/store'
import { Card } from '@/components/ui/Card'
import { Select } from '@/components/ui/Select'
import { MONTH_NAMES_SHORT } from '@/utils/budgetHelpers'
import { baselineTarget, budgetedAmount } from '@/utils/projection'
import { getMonthIdForDate } from '@/utils/periodUtils'
import type { CategoryDef } from '@/types'

// Adjustable "coming months" grid. Rows = categories, columns = months — both can
// be added/removed. A cell shows the rolling baseline (grey) until you type a
// value, which becomes a per-month override (dark). Empty on blur reverts to base.

function nextMonthId(monthId: string): string {
  const y = parseInt(monthId.slice(0, 4))
  const m = parseInt(monthId.slice(5, 7))
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`
}
function monthLabel(monthId: string): string {
  const m = parseInt(monthId.slice(5, 7))
  return `${MONTH_NAMES_SHORT[m - 1]} ${monthId.slice(2, 4)}`
}
function sameMonthLastYear(monthId: string): string {
  return `${parseInt(monthId.slice(0, 4)) - 1}-${monthId.slice(5, 7)}`
}
const fmt = (v: number) => Math.round(v).toLocaleString('sv-SE')

export function PlanGrid() {
  const store = useAppStore()
  const { categories, monthStartDay, monthStartBusinessDay } = store.settings
  const [addCat, setAddCat] = useState('')

  const defaultMonths = useMemo(() => {
    const today = new Date()
    const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
    let m = getMonthIdForDate(iso, monthStartDay, monthStartBusinessDay)
    const arr = [m]
    for (let i = 0; i < 11; i++) { m = nextMonthId(m); arr.push(m) }
    return arr
  }, [monthStartDay, monthStartBusinessDay])

  const budgetCats = useMemo(
    () => categories.filter((c) => c.type === 'income' || c.type === 'expense'),
    [categories]
  )

  const months = store.planGrid?.months ?? defaultMonths
  const catIds = store.planGrid?.categoryIds ?? budgetCats.map((c) => c.id)
  const customized = !!store.planGrid

  const rows = catIds
    .map((id) => categories.find((c) => c.id === id))
    .filter((c): c is CategoryDef => !!c)

  const availableCats = budgetCats.filter((c) => !catIds.includes(c.id))

  const save = (next: { months?: string[]; categoryIds?: string[] }) =>
    store.setPlanGrid({ months: next.months ?? months, categoryIds: next.categoryIds ?? catIds })

  const addMonth = () => save({ months: [...months, nextMonthId(months[months.length - 1] ?? defaultMonths[0])] })
  const removeMonth = (id: string) => save({ months: months.filter((m) => m !== id) })
  const addCategory = (id: string) => { if (id && !catIds.includes(id)) save({ categoryIds: [...catIds, id] }) }
  const removeCategory = (id: string) => save({ categoryIds: catIds.filter((c) => c !== id) })

  const netByMonth = months.map((mid) => rows.reduce((s, cat) => s + budgetedAmount(store, mid, cat.id), 0))

  const lastYearActual = (mid: string, catId: string): number | undefined => {
    const a = store.actuals[sameMonthLastYear(mid)]
    if (!a) return undefined
    return a.entries.filter((e) => e.categoryId === catId).reduce((s, e) => s + e.totalAmount, 0)
  }

  return (
    <Card padding={false}>
      <div className="flex items-center justify-between p-5 border-b border-gray-100">
        <div>
          <h3 className="font-semibold text-gray-900">Kommande månader</h3>
          <p className="text-sm text-gray-500">Cellerna visar din bas — skriv bara i månader som ska avvika.</p>
        </div>
        {customized && (
          <button
            onClick={() => store.setPlanGrid(null)}
            className="text-xs text-gray-400 hover:text-gray-700 inline-flex items-center gap-1 transition-colors shrink-0"
            title="Återställ till rullande 12 månader och alla kategorier"
          >
            <RotateCcw className="w-3.5 h-3.5" /> Återställ tabell
          </button>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="border-collapse text-sm" style={{ minWidth: 160 + months.length * 80 + 44 }}>
          <thead>
            <tr>
              <th className="sticky left-0 z-20 bg-gray-50 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wide px-4 py-2.5 w-[160px] border-b border-warm-200">
                Kategori
              </th>
              {months.map((mid) => (
                <th key={mid} className="group bg-gray-50 px-1 py-2 w-[80px] border-b border-warm-200">
                  <div className="flex flex-col items-center gap-0.5">
                    <span className="text-xs font-medium text-gray-600 tabular-nums">{monthLabel(mid)}</span>
                    <button
                      onClick={() => removeMonth(mid)}
                      className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-500 transition-all"
                      title="Ta bort månad"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                </th>
              ))}
              <th className="bg-gray-50 px-1 w-[44px] border-b border-warm-200">
                <button onClick={addMonth} className="p-1.5 rounded-md text-gray-400 hover:text-brand-600 hover:bg-warm-100 transition-colors" title="Lägg till månad">
                  <Plus className="w-4 h-4" />
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((cat) => (
              <tr key={cat.id} className="group border-b border-warm-100 last:border-0">
                <td className="sticky left-0 z-10 bg-white group-hover:bg-warm-50 px-4 py-1.5 transition-colors">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: cat.color ?? '#94a3b8' }} />
                    <span className="text-sm text-gray-800 truncate flex-1 min-w-0">{cat.name}</span>
                    <button
                      onClick={() => removeCategory(cat.id)}
                      className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-500 transition-all shrink-0"
                      title="Ta bort rad"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                </td>
                {months.map((mid) => (
                  <GridCell
                    key={mid}
                    catId={cat.id}
                    monthId={mid}
                    isIncome={cat.type === 'income'}
                    lastYear={lastYearActual(mid, cat.id)}
                  />
                ))}
                <td className="bg-white group-hover:bg-warm-50 transition-colors" />
              </tr>
            ))}

            {/* Net per month over the shown rows */}
            <tr className="border-t-2 border-warm-200">
              <td className="sticky left-0 z-10 bg-warm-50 px-4 py-2 text-xs font-semibold text-gray-600">Netto</td>
              {netByMonth.map((n, i) => (
                <td key={months[i]} className={`px-1 py-2 text-right text-xs font-semibold tabular-nums ${n >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                  {fmt(n)}
                </td>
              ))}
              <td className="bg-warm-50" />
            </tr>
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-3 p-4 border-t border-gray-100">
        {availableCats.length > 0 ? (
          <Select
            className="w-56"
            value={addCat}
            onChange={(e) => { addCategory(e.target.value); setAddCat('') }}
            options={[{ value: '', label: '+ Lägg till kategori…' }, ...availableCats.map((c) => ({ value: c.id, label: c.name }))]}
          />
        ) : (
          <span className="text-xs text-gray-400">Alla kategorier visas redan.</span>
        )}
        <span className="text-xs text-gray-400">Grå = bas · mörk = justerad för den månaden</span>
      </div>
    </Card>
  )
}

function GridCell({ catId, monthId, isIncome, lastYear }: {
  catId: string
  monthId: string
  isIncome: boolean
  lastYear?: number
}) {
  const store = useAppStore()
  const override = store.budgetOverrides[monthId]?.[catId]
  const base = baselineTarget(store, catId) ?? 0
  const isOverride = override !== undefined
  const value = isOverride ? override : base

  const [editing, setEditing] = useState(false)
  const [raw, setRaw] = useState('')

  const commit = () => {
    setEditing(false)
    const cleaned = raw.replace(',', '.').replace(/[^\d.-]/g, '').trim()
    if (cleaned === '') { store.setMonthOverride(monthId, catId, null); return }
    const parsed = parseFloat(cleaned)
    if (isNaN(parsed)) { store.setMonthOverride(monthId, catId, null); return }
    store.setMonthOverride(monthId, catId, isIncome ? Math.abs(parsed) : -Math.abs(parsed))
  }

  const title = `Bas ${fmt(base)}${lastYear !== undefined ? ` · i fjol ${fmt(lastYear)}` : ''}`

  return (
    <td className="px-0.5 py-0.5">
      <input
        title={title}
        value={editing ? raw : fmt(value)}
        placeholder={fmt(Math.abs(base))}
        onFocus={() => { setEditing(true); setRaw(isOverride ? String(Math.abs(override)) : '') }}
        onChange={(e) => setRaw(e.target.value)}
        onBlur={commit}
        className={`w-full text-right text-xs tabular-nums rounded px-1.5 py-1.5 bg-transparent border border-transparent
          hover:border-warm-200 focus:outline-none focus:ring-1 focus:ring-brand-400 focus:bg-white focus:border-transparent
          ${isOverride ? 'text-gray-900 font-semibold' : 'text-gray-300'}`}
      />
    </td>
  )
}
