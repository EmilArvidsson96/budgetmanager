import { useRef, useState } from 'react'
import { Plus, Trash2, Edit2, X, Check, ArrowRight } from 'lucide-react'
import { useAppStore } from '@/store'
import { Layout, PageHeader } from '@/components/layout/Layout'
import { Card, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { RECEIPT_MODELS, DEFAULT_RECEIPT_MODEL } from '@/utils/receiptModels'
import type { Account, RecurringItem, AccountType, ZlantarCategoryRule, CategoryDef } from '@/types'

function newId() { return `id-${Date.now()}-${Math.random().toString(36).slice(2, 6)}` }

const ACCOUNT_TYPES: { value: AccountType; label: string }[] = [
  { value: 'checking',   label: 'Lönekonto' },
  { value: 'savings',    label: 'Sparkonto' },
  { value: 'credit',     label: 'Kreditkort' },
  { value: 'loan',       label: 'Lån' },
  { value: 'isk',        label: 'ISK' },
  { value: 'investment', label: 'Investeringskonto' },
  { value: 'other',      label: 'Övrigt' },
]

const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = Object.fromEntries(
  ACCOUNT_TYPES.map((t) => [t.value, t.label])
) as Record<AccountType, string>

export function SettingsView() {
  const [tab, setTab] = useState<'general' | 'accounts' | 'recurring' | 'categories' | 'mapping' | 'api'>('general')

  return (
    <Layout>
      <PageHeader title="Inställningar" />

      <div className="flex flex-wrap gap-1 mb-6 border-b border-gray-200">
        {([
          { key: 'general',    label: 'Allmänt' },
          { key: 'accounts',   label: 'Konton' },
          { key: 'recurring',  label: 'Återkommande poster' },
          { key: 'categories', label: 'Kategorier' },
          { key: 'mapping',    label: 'Zlantar-mappning' },
          { key: 'api',        label: 'API-nycklar' },
        ] as const).map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors
              ${tab === key ? 'border-brand-600 text-brand-700' : 'border-transparent text-gray-500 hover:text-gray-800'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'general'    && <GeneralTab />}
      {tab === 'accounts'   && <AccountsTab />}
      {tab === 'recurring'  && <RecurringTab />}
      {tab === 'categories' && <CategoriesTab />}
      {tab === 'mapping'    && <ZlantarMappingTab />}
      {tab === 'api'        && <ApiKeysTab />}
    </Layout>
  )
}

// ─── General tab ──────────────────────────────────────────────────────────────

function GeneralTab() {
  const store = useAppStore()
  const { monthStartDay, monthStartBusinessDay } = store.settings
  const [day, setDay] = useState(String(monthStartDay))
  const [saved, setSaved] = useState(false)

  const save = () => {
    const parsed = parseInt(day)
    if (!parsed || parsed < 1 || parsed > 28) return
    store.updateSettings({ monthStartDay: parsed, monthStartBusinessDay })
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const toggleBusinessDay = (checked: boolean) => {
    store.updateSettings({ monthStartBusinessDay: checked })
  }

  return (
    <div className="max-w-lg space-y-6">
      <Card>
        <CardHeader
          title="Månadsperiod"
          subtitle="Styr vilken kalenderdag som inleder varje period. Standardvärde är dag 1 (vanlig kalendermånad)."
        />
        <div className="space-y-5">
          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">
              Periodens startdag <span className="font-normal text-gray-400">(1–28)</span>
            </label>
            <div className="flex items-center gap-3">
              <input
                type="number"
                min={1}
                max={28}
                value={day}
                onChange={(e) => { setDay(e.target.value); setSaved(false) }}
                className="w-24 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
              />
              <Button onClick={save} variant={saved ? 'secondary' : 'primary'} size="md">
                {saved ? '✓ Sparat' : 'Spara'}
              </Button>
            </div>
            <p className="mt-2 text-xs text-gray-400">
              Dag {monthStartDay === 1 ? '1 – standard kalendermånad' : `${monthStartDay} – perioden löper ${monthStartDay}/${String(monthStartDay === 1 ? 1 : (new Date().getMonth() + 1)).padStart(2, '0')} t.o.m. dag ${monthStartDay - 1} nästa månad`}
            </p>
          </div>

          <div>
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={monthStartBusinessDay}
                onChange={(e) => toggleBusinessDay(e.target.checked)}
                className="mt-0.5 rounded accent-brand-600"
              />
              <div>
                <span className="text-sm font-medium text-gray-700">Använd närmaste vardag</span>
                <p className="text-xs text-gray-400 mt-0.5">
                  Om startdagen infaller på en lördag eller söndag används fredagen innan.
                  Speglar hur lön och betalningar normalt betalas ut.
                </p>
              </div>
            </label>
          </div>

          {monthStartDay !== 1 && (
            <div className="p-3 bg-amber-50 border border-amber-100 rounded-lg text-xs text-amber-700">
              Inställningen påverkar hur transaktioner från Zlantar grupperas i perioder.
              Importera om dina Zlantar-filer för att tillämpa den nya perioden på historisk data.
            </div>
          )}
        </div>
      </Card>
    </div>
  )
}

// ─── Accounts tab ─────────────────────────────────────────────────────────────

function AccountsTab() {
  const store = useAppStore()
  const { accounts } = store.settings
  const [editing, setEditing] = useState<Account | null>(null)
  const [form, setForm] = useState<Partial<Account>>({})

  const startNew = () => {
    setEditing({ id: newId(), name: '', type: 'checking', currency: 'SEK', includeInLiquidity: true })
    setForm({})
  }

  const startEdit = (a: Account) => {
    setEditing(a)
    setForm(a)
  }

  const save = () => {
    if (!editing || !form.name) return
    store.upsertAccount({ ...editing, ...form } as Account)
    setEditing(null)
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="Konton"
          subtitle="Konton från Zlantar importeras automatiskt. Du kan justera dem här."
          action={<Button size="sm" onClick={startNew}><Plus className="w-4 h-4" />Lägg till</Button>}
        />

        {/* Edit form */}
        {editing && (
          <div className="mb-4 p-4 bg-brand-50 rounded-xl border border-brand-100">
            <h4 className="font-medium text-gray-800 mb-3">{editing.id.startsWith('id-') ? 'Nytt konto' : 'Redigera konto'}</h4>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Namn</label>
                <input
                  className="w-full border border-gray-200 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                  value={form.name ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="t.ex. Swedbank Lönekonto"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Typ</label>
                <select
                  className="w-full border border-gray-200 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                  value={form.type ?? 'checking'}
                  onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as AccountType }))}
                >
                  {ACCOUNT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Bank</label>
                <input
                  className="w-full border border-gray-200 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                  value={form.bankName ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, bankName: e.target.value }))}
                  placeholder="t.ex. Swedbank"
                />
              </div>
              {(form.type === 'loan' || form.type === 'credit') && (
                <div>
                  <label className="text-xs font-medium text-gray-600 block mb-1">Ränta (%)</label>
                  <input
                    type="number"
                    step="0.01"
                    className="w-full border border-gray-200 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                    value={form.interestRate ?? ''}
                    onChange={(e) => setForm((f) => ({ ...f, interestRate: parseFloat(e.target.value) }))}
                    placeholder="t.ex. 3.25"
                  />
                </div>
              )}
              <div className="flex items-end pb-1">
                <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.includeInLiquidity ?? true}
                    onChange={(e) => setForm((f) => ({ ...f, includeInLiquidity: e.target.checked }))}
                    className="rounded"
                  />
                  Inkludera i likviditet
                </label>
              </div>
            </div>
            <div className="flex gap-2 mt-3">
              <Button size="sm" onClick={save}><Check className="w-4 h-4" /> Spara</Button>
              <Button size="sm" variant="secondary" onClick={() => setEditing(null)}><X className="w-4 h-4" /> Avbryt</Button>
            </div>
          </div>
        )}

        {accounts.length === 0 && (
          <p className="text-sm text-gray-400 text-center py-6">
            Inga konton ännu. Importera från Zlantar eller lägg till manuellt.
          </p>
        )}

        <div className="space-y-2">
          {accounts.map((a) => (
            <div key={a.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
              <div className="flex items-center gap-3">
                <div>
                  <p className="font-medium text-sm text-gray-800">{a.name}</p>
                  <p className="text-xs text-gray-400">{a.bankName ?? '–'} · {a.currency}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {a.interestRate !== undefined && (
                  <Badge variant="amber">{a.interestRate}%</Badge>
                )}
                <Badge variant={a.type === 'loan' ? 'red' : a.type === 'savings' || a.type === 'isk' ? 'blue' : 'gray'}>
                  {ACCOUNT_TYPE_LABELS[a.type]}
                </Badge>
                <button onClick={() => startEdit(a)} className="text-gray-400 hover:text-brand-600 p-1">
                  <Edit2 className="w-4 h-4" />
                </button>
                <button onClick={() => store.removeAccount(a.id)} className="text-gray-300 hover:text-red-500 p-1">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}

// ─── Recurring items tab ──────────────────────────────────────────────────────

function RecurringTab() {
  const store = useAppStore()
  const { recurringItems, categories } = store.settings
  const [form, setForm] = useState<Partial<RecurringItem>>({ type: 'expense' })
  const [showForm, setShowForm] = useState(false)

  const save = () => {
    if (!form.name || !form.amount || !form.categoryId) return
    store.upsertRecurring({ id: form.id ?? newId(), ...form } as RecurringItem)
    setForm({ type: 'expense' })
    setShowForm(false)
  }

  const selectedCat = categories.find((c) => c.id === form.categoryId)

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="Återkommande poster"
          subtitle="Förifylls automatiskt när du skapar en ny månadsbudget"
          action={<Button size="sm" onClick={() => setShowForm(true)}><Plus className="w-4 h-4" />Lägg till</Button>}
        />

        {showForm && (
          <div className="mb-4 p-4 bg-brand-50 rounded-xl border border-brand-100">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-3">
              <div className="md:col-span-2">
                <label className="text-xs font-medium text-gray-600 block mb-1">Namn</label>
                <input
                  className="w-full border border-gray-200 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                  value={form.name ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="t.ex. Hyra, Netflix, Lön..."
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Belopp (kr)</label>
                <input
                  type="number"
                  className="w-full border border-gray-200 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                  value={form.amount ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, amount: parseFloat(e.target.value) }))}
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Typ</label>
                <select
                  className="w-full border border-gray-200 rounded-md px-3 py-1.5 text-sm"
                  value={form.type ?? 'expense'}
                  onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as 'income' | 'expense' }))}
                >
                  <option value="expense">Utgift</option>
                  <option value="income">Inkomst</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Kategori</label>
                <select
                  className="w-full border border-gray-200 rounded-md px-3 py-1.5 text-sm"
                  value={form.categoryId ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, categoryId: e.target.value, subcategoryId: undefined }))}
                >
                  <option value="">Välj kategori...</option>
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              {selectedCat && selectedCat.subcategories.length > 0 && (
                <div>
                  <label className="text-xs font-medium text-gray-600 block mb-1">Underkategori</label>
                  <select
                    className="w-full border border-gray-200 rounded-md px-3 py-1.5 text-sm"
                    value={form.subcategoryId ?? ''}
                    onChange={(e) => setForm((f) => ({ ...f, subcategoryId: e.target.value }))}
                  >
                    <option value="">Ingen</option>
                    {selectedCat.subcategories.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
              )}
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Dag i månaden</label>
                <input
                  type="number"
                  min="1"
                  max="31"
                  className="w-full border border-gray-200 rounded-md px-3 py-1.5 text-sm"
                  value={form.dayOfMonth ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, dayOfMonth: parseInt(e.target.value) }))}
                  placeholder="t.ex. 25"
                />
              </div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={save}>Spara</Button>
              <Button size="sm" variant="secondary" onClick={() => setShowForm(false)}>Avbryt</Button>
            </div>
          </div>
        )}

        {recurringItems.length === 0 && (
          <p className="text-sm text-gray-400 text-center py-6">Inga återkommande poster ännu.</p>
        )}

        <div className="space-y-2">
          {recurringItems.map((item) => {
            const cat = categories.find((c) => c.id === item.categoryId)
            const sub = cat?.subcategories.find((s) => s.id === item.subcategoryId)
            return (
              <div key={item.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                <div>
                  <p className="font-medium text-sm text-gray-800">{item.name}</p>
                  <p className="text-xs text-gray-400">
                    {cat?.name}{sub ? ` / ${sub.name}` : ''}
                    {item.dayOfMonth ? ` · dag ${item.dayOfMonth}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-sm font-medium ${item.type === 'income' ? 'text-green-700' : 'text-gray-700'}`}>
                    {item.type === 'income' ? '+' : '−'}{item.amount.toLocaleString('sv-SE')} kr
                  </span>
                  <button onClick={() => store.removeRecurring(item.id)} className="text-gray-300 hover:text-red-500 p-1">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </Card>
    </div>
  )
}

// ─── Categories tab ───────────────────────────────────────────────────────────

// Subcategory IDs that are tied to Zlantar's fixed category values — renaming
// is fine, but these IDs must stay in sync with the Zlantar mapping rules.
const ZLANTAR_CORE_SUBCAT_IDS = new Set(['salary', 'interest', 'refund', 'sale'])

// Expense/savings category IDs whose top-level ID matches Zlantar directly;
// all their subcategories are therefore Zlantar-sourced.
const ZLANTAR_DIRECT_CAT_IDS = new Set(['food', 'household', 'transport', 'shopping', 'leisure', 'other', 'stocks'])

function isZlantarLinked(catId: string, subId: string): boolean {
  if (catId === 'income') return ZLANTAR_CORE_SUBCAT_IDS.has(subId)
  return ZLANTAR_DIRECT_CAT_IDS.has(catId)
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/å/g, 'a').replace(/ä/g, 'a').replace(/ö/g, 'o')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
}

function CategoriesTab() {
  const store = useAppStore()
  const { categories } = store.settings

  const incomeCat = categories.find((c) => c.id === 'income')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [addName, setAddName] = useState('')
  const [showAdd, setShowAdd] = useState(false)

  const updateIncomeSubcats = (fn: (subs: CategoryDef['subcategories']) => CategoryDef['subcategories']) => {
    if (!incomeCat) return
    store.setCategories(
      categories.map((c) =>
        c.id === 'income' ? { ...c, subcategories: fn(c.subcategories) } : c
      )
    )
  }

  const startEdit = (id: string, name: string) => { setEditingId(id); setEditName(name) }
  const saveEdit = () => {
    if (!editName.trim() || !editingId) return
    updateIncomeSubcats((subs) =>
      subs.map((s) => s.id === editingId ? { ...s, name: editName.trim() } : s)
    )
    setEditingId(null)
  }

  const deleteSub = (id: string) => {
    updateIncomeSubcats((subs) => subs.filter((s) => s.id !== id))
  }

  const addSub = () => {
    const name = addName.trim()
    if (!name) return
    const id = slugify(name) || `sub_${Date.now()}`
    updateIncomeSubcats((subs) => [
      ...subs,
      { id: `savings_${id}`, name, parentId: 'income' },
    ])
    setAddName('')
    setShowAdd(false)
  }

  return (
    <div className="space-y-4">
      {/* Income subcategory editor */}
      <Card>
        <CardHeader
          title="Inkomstunderkategorier"
          subtitle="Hantera underkategorier för inkomst. Underkategorier märkta Zlantar är kopplade till importmappningen och kan inte tas bort."
          action={<Button size="sm" onClick={() => setShowAdd(true)}><Plus className="w-4 h-4" />Lägg till</Button>}
        />

        {showAdd && (
          <div className="mb-4 p-3 bg-brand-50 rounded-xl border border-brand-100 flex gap-2 items-end">
            <div className="flex-1">
              <label className="text-xs font-medium text-gray-600 block mb-1">Namn</label>
              <input
                autoFocus
                className="w-full border border-gray-200 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                value={addName}
                onChange={(e) => setAddName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') addSub(); if (e.key === 'Escape') setShowAdd(false) }}
                placeholder="t.ex. Buffert-spar, Bil-spar..."
              />
            </div>
            <Button size="sm" onClick={addSub}><Check className="w-4 h-4" />Spara</Button>
            <Button size="sm" variant="secondary" onClick={() => setShowAdd(false)}><X className="w-4 h-4" /></Button>
          </div>
        )}

        {incomeCat ? (
          <div className="space-y-1">
            {incomeCat.subcategories.map((sub) => {
              const isCore = ZLANTAR_CORE_SUBCAT_IDS.has(sub.id)
              return (
                <div key={sub.id} className="flex items-center gap-2 py-1.5 px-2 rounded-lg group hover:bg-gray-50">
                  {editingId === sub.id ? (
                    <>
                      <input
                        autoFocus
                        className="flex-1 border border-brand-300 rounded px-2 py-0.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') setEditingId(null) }}
                      />
                      <button onClick={saveEdit} className="text-green-600 hover:text-green-700 p-1"><Check className="w-3.5 h-3.5" /></button>
                      <button onClick={() => setEditingId(null)} className="text-gray-400 hover:text-gray-600 p-1"><X className="w-3.5 h-3.5" /></button>
                    </>
                  ) : (
                    <>
                      <span className="flex-1 text-sm text-gray-700">{sub.name}</span>
                      {isCore && <Badge variant="blue" size="sm">Zlantar</Badge>}
                      <button
                        onClick={() => startEdit(sub.id, sub.name)}
                        className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-brand-600 p-1 transition-opacity"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      {!isCore && (
                        <button
                          onClick={() => deleteSub(sub.id)}
                          className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-500 p-1 transition-opacity"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </>
                  )}
                </div>
              )
            })}
          </div>
        ) : (
          <p className="text-sm text-gray-400 text-center py-4">Ingen inkomstkategori hittades.</p>
        )}
      </Card>

      {/* All categories overview (read-only) */}
      <Card>
        <CardHeader title="Alla kategorier" subtitle="Översikt. Redigera inkomstunderkategorier ovan." />
        <div className="space-y-1">
          {categories.map((cat) => (
            <div key={cat.id}>
              <div className="flex items-center gap-2 py-2 px-2 rounded-lg">
                <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: cat.color ?? '#94a3b8' }} />
                <span className="font-medium text-sm text-gray-800">{cat.name}</span>
                <Badge variant={cat.type === 'income' ? 'green' : cat.type === 'savings' ? 'blue' : 'gray'} size="sm">
                  {cat.type === 'income' ? 'Inkomst' : cat.type === 'savings' ? 'Sparande' : 'Utgift'}
                </Badge>
              </div>
              {cat.subcategories.length > 0 && (
                <div className="ml-5 space-y-0.5 mb-1">
                  {cat.subcategories.map((sub) => (
                    <div key={sub.id} className="text-xs text-gray-500 py-0.5 pl-3 border-l border-gray-100 flex items-center gap-1.5">
                      {sub.name}
                      {isZlantarLinked(cat.id, sub.id) && (
                        <Badge variant="blue" size="sm">Zlantar</Badge>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}

// ─── Zlantar mapping tab ──────────────────────────────────────────────────────

// Known Zlantar categories with their subcategory IDs (match Zlantar's export format exactly)
const KNOWN_ZLANTAR_CATS_WITH_SUBS: Array<{ cat: string; subcats: string[] }> = [
  { cat: 'salary',    subcats: [] },
  { cat: 'interest',  subcats: [] },
  { cat: 'refund',    subcats: [] },
  { cat: 'sale',      subcats: [] },
  { cat: 'food',      subcats: ['groceries', 'restaurant', 'cafe', 'alcohol', 'other'] },
  { cat: 'household', subcats: ['rent', 'operational', 'media_telecoms', 'maintenance', 'services', 'insurance', 'loans_taxes', 'alarm', 'other'] },
  { cat: 'transport', subcats: ['public', 'vehicle', 'train_bus', 'flights', 'other'] },
  { cat: 'shopping',  subcats: ['clothing', 'furnishing', 'multimedia', 'beauty', 'media_books', 'gardening', 'gifts', 'other'] },
  { cat: 'leisure',   subcats: ['sports', 'vacation', 'culture', 'gambling', 'other'] },
  { cat: 'other',     subcats: ['healthcare', 'children', 'cash', 'outlay', 'uncategorized', 'other'] },
  { cat: 'stocks',    subcats: [] },
]
const KNOWN_ZLANTAR_CAT_IDS = KNOWN_ZLANTAR_CATS_WITH_SUBS.map((e) => e.cat)

function ZlantarMappingTab() {
  const store = useAppStore()
  const { zlantarCategoryRules, categories } = store.settings

  const [editingId, setEditingId] = useState<string | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const emptyForm = (): Partial<ZlantarCategoryRule> => ({})
  const [form, setForm] = useState<Partial<ZlantarCategoryRule>>(emptyForm())
  const ruleCardRef = useRef<HTMLDivElement>(null)

  const selectedCat = categories.find((c) => c.id === form.appCategoryId)

  const saveRule = () => {
    if (!form.zlantarCategory || !form.appCategoryId) return
    const id = editingId ?? `rule_${Date.now()}`
    store.upsertZlantarRule({ ...form, id } as ZlantarCategoryRule)
    setEditingId(null)
    setShowAdd(false)
    setForm(emptyForm())
  }

  const startEdit = (rule: ZlantarCategoryRule) => {
    setEditingId(rule.id)
    setForm(rule)
    setShowAdd(false)
    setTimeout(() => ruleCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
  }

  const startAddForZlantar = (zlantarCategory: string, zlantarSubcategory?: string) => {
    setEditingId(null)
    setShowAdd(true)
    setForm({ zlantarCategory, zlantarSubcategory })
    setTimeout(() => ruleCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
  }

  const cancelForm = () => {
    setEditingId(null)
    setShowAdd(false)
    setForm(emptyForm())
  }

  const effectiveMap = (zlantarCat: string): { catName: string; subName?: string } | null => {
    const rule = zlantarCategoryRules.find((r) => r.zlantarCategory === zlantarCat && !r.zlantarSubcategory)
    if (rule) {
      const cat = categories.find((c) => c.id === rule.appCategoryId)
      const sub = cat?.subcategories.find((s) => s.id === rule.appSubcategoryId)
      return { catName: cat?.name ?? rule.appCategoryId, subName: sub?.name ?? rule.appSubcategoryId }
    }
    const directCat = categories.find((c) => c.id === zlantarCat)
    if (directCat) return { catName: directCat.name }
    return null
  }

  const effectiveSubMap = (
    zCat: string,
    zSub: string
  ): { catName: string; subName: string; ruleType: 'specific' | 'cat' | 'auto' } => {
    const specific = zlantarCategoryRules.find(
      (r) => r.zlantarCategory === zCat && r.zlantarSubcategory === zSub
    )
    if (specific) {
      const cat = categories.find((c) => c.id === specific.appCategoryId)
      const sub = cat?.subcategories.find((s) => s.id === specific.appSubcategoryId)
      return { catName: cat?.name ?? specific.appCategoryId, subName: sub?.name ?? specific.appSubcategoryId ?? zSub, ruleType: 'specific' }
    }
    const catRule = zlantarCategoryRules.find((r) => r.zlantarCategory === zCat && !r.zlantarSubcategory)
    if (catRule) {
      const cat = categories.find((c) => c.id === catRule.appCategoryId)
      const targetSubId = catRule.appSubcategoryId ?? zSub
      const sub = cat?.subcategories.find((s) => s.id === targetSubId)
      return { catName: cat?.name ?? catRule.appCategoryId, subName: sub?.name ?? targetSubId, ruleType: 'cat' }
    }
    const cat = categories.find((c) => c.id === zCat)
    const sub = cat?.subcategories.find((s) => s.id === zSub)
    return { catName: cat?.name ?? zCat, subName: sub?.name ?? zSub, ruleType: 'auto' }
  }

  const FormRow = ({ isNew }: { isNew: boolean }) => (
    <div className="p-4 bg-brand-50 rounded-xl border border-brand-100 space-y-3">
      <h4 className="text-sm font-medium text-gray-800">{isNew ? 'Ny regel' : 'Redigera regel'}</h4>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 items-end">
        <div>
          <label className="text-xs font-medium text-gray-600 block mb-1">Zlantar-kategori</label>
          <input
            list="zlantar-cats"
            className="w-full border border-gray-200 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            value={form.zlantarCategory ?? ''}
            onChange={(e) => setForm((f) => ({ ...f, zlantarCategory: e.target.value, zlantarSubcategory: undefined }))}
            placeholder="t.ex. salary, food..."
          />
          <datalist id="zlantar-cats">
            {KNOWN_ZLANTAR_CAT_IDS.map((c) => <option key={c} value={c} />)}
          </datalist>
        </div>
        <div>
          <label className="text-xs font-medium text-gray-600 block mb-1">Zlantar-underkategori <span className="font-normal text-gray-400">(valfri)</span></label>
          <input
            className="w-full border border-gray-200 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            value={form.zlantarSubcategory ?? ''}
            onChange={(e) => setForm((f) => ({ ...f, zlantarSubcategory: e.target.value || undefined }))}
            placeholder="t.ex. groceries..."
          />
        </div>
        <div>
          <label className="text-xs font-medium text-gray-600 block mb-1">App-kategori</label>
          <select
            className="w-full border border-gray-200 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            value={form.appCategoryId ?? ''}
            onChange={(e) => setForm((f) => ({ ...f, appCategoryId: e.target.value, appSubcategoryId: undefined }))}
          >
            <option value="">Välj...</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs font-medium text-gray-600 block mb-1">App-underkategori <span className="font-normal text-gray-400">(valfri)</span></label>
          <select
            className="w-full border border-gray-200 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            value={form.appSubcategoryId ?? ''}
            onChange={(e) => setForm((f) => ({ ...f, appSubcategoryId: e.target.value || undefined }))}
            disabled={!selectedCat || selectedCat.subcategories.length === 0}
          >
            <option value="">Bevara original</option>
            {selectedCat?.subcategories.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
      </div>
      <div className="flex gap-2">
        <Button size="sm" onClick={saveRule} disabled={!form.zlantarCategory || !form.appCategoryId}>
          <Check className="w-4 h-4" />Spara
        </Button>
        <Button size="sm" variant="secondary" onClick={cancelForm}><X className="w-4 h-4" />Avbryt</Button>
      </div>
    </div>
  )

  return (
    <div className="space-y-4">
      {/* Configured rules */}
      <div ref={ruleCardRef}>
        <Card>
          <CardHeader
            title="Kategori-regler"
            subtitle="Regler avgör hur Zlantar-kategorier mappas till appens kategorier. Kategorier utan regel matchas automatiskt om ID:n stämmer."
            action={!showAdd && editingId === null
              ? <Button size="sm" onClick={() => { setShowAdd(true); setForm(emptyForm()) }}><Plus className="w-4 h-4" />Lägg till regel</Button>
              : undefined
            }
          />

          {showAdd && <div className="mb-4"><FormRow isNew /></div>}

          {zlantarCategoryRules.length === 0 && !showAdd ? (
            <p className="text-sm text-gray-400 text-center py-6">Inga regler konfigurerade. Allt matchas automatiskt.</p>
          ) : (
            <div className="space-y-1">
              {zlantarCategoryRules.map((rule) => {
                const appCat = categories.find((c) => c.id === rule.appCategoryId)
                const appSub = appCat?.subcategories.find((s) => s.id === rule.appSubcategoryId)
                return editingId === rule.id ? (
                  <div key={rule.id} className="mb-2"><FormRow isNew={false} /></div>
                ) : (
                  <div key={rule.id} className="flex items-center gap-2 py-2 px-2 rounded-lg group hover:bg-gray-50">
                    <div className="flex-1 flex items-center gap-1.5 flex-wrap min-w-0">
                      <code className="text-xs bg-gray-100 px-1.5 py-0.5 rounded text-gray-700">{rule.zlantarCategory}</code>
                      {rule.zlantarSubcategory && (
                        <>
                          <span className="text-gray-400 text-xs">/</span>
                          <code className="text-xs bg-gray-100 px-1.5 py-0.5 rounded text-gray-700">{rule.zlantarSubcategory}</code>
                        </>
                      )}
                      <ArrowRight className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                      <span className="text-sm text-gray-800">{appCat?.name ?? rule.appCategoryId}</span>
                      {appSub && <span className="text-xs text-gray-500">/ {appSub.name}</span>}
                      {!appSub && rule.appSubcategoryId === undefined && (
                        <span className="text-xs text-gray-400 italic">bevara underkategori</span>
                      )}
                    </div>
                    <button onClick={() => startEdit(rule)} className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-brand-600 p-1 transition-opacity">
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => store.removeZlantarRule(rule.id)} className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-500 p-1 transition-opacity">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </Card>
      </div>

      {/* Effective mapping overview */}
      <Card>
        <CardHeader
          title="Effektiv mappning"
          subtitle="Alla kända Zlantar-kategorier och underkategorier med nuvarande mappning. Klicka + för att lägga till en regel."
        />
        <div className="divide-y divide-gray-50">
          {KNOWN_ZLANTAR_CATS_WITH_SUBS.map(({ cat: zCat, subcats }) => {
            const catEff = effectiveMap(zCat)
            const catHasRule = zlantarCategoryRules.some((r) => r.zlantarCategory === zCat && !r.zlantarSubcategory)

            if (subcats.length === 0) {
              return (
                <div key={zCat} className="flex items-center gap-3 py-2 px-2 group">
                  <code className="text-xs bg-gray-100 px-1.5 py-0.5 rounded text-gray-700 w-24 flex-shrink-0">{zCat}</code>
                  <ArrowRight className="w-3.5 h-3.5 text-gray-300 flex-shrink-0" />
                  {catEff ? (
                    <span className="text-sm text-gray-700">
                      {catEff.catName}{catEff.subName ? <span className="text-gray-400"> / {catEff.subName}</span> : null}
                    </span>
                  ) : (
                    <span className="text-sm text-red-400 italic">omappad → Övrigt</span>
                  )}
                  <div className="ml-auto flex items-center gap-1">
                    <Badge variant={catHasRule ? 'blue' : 'gray'} size="sm">{catHasRule ? 'Regel' : 'Automatisk'}</Badge>
                    <button
                      onClick={() => startAddForZlantar(zCat)}
                      title="Lägg till regel"
                      className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-brand-600 p-1 transition-opacity"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              )
            }

            return (
              <div key={zCat}>
                {/* Category header */}
                <div className="flex items-center gap-3 py-2 px-2 bg-gray-50/60 group">
                  <code className="text-xs bg-gray-200 px-1.5 py-0.5 rounded text-gray-600 font-semibold w-24 flex-shrink-0">{zCat}</code>
                  <span className="text-xs text-gray-400">{subcats.length} underkategorier</span>
                  <div className="ml-auto flex items-center gap-1">
                    {catHasRule && <Badge variant="blue" size="sm">Kategori-regel</Badge>}
                    <button
                      onClick={() => startAddForZlantar(zCat)}
                      title="Lägg till kategori-regel"
                      className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-brand-600 p-1 transition-opacity"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
                {/* Subcategory rows */}
                {subcats.map((zSub) => {
                  const eff = effectiveSubMap(zCat, zSub)
                  const specificRule = zlantarCategoryRules.find(
                    (r) => r.zlantarCategory === zCat && r.zlantarSubcategory === zSub
                  )
                  return (
                    <div key={zSub} className="flex items-center gap-3 py-1.5 px-2 pl-8 group hover:bg-gray-50/80">
                      <code className="text-xs bg-gray-100 px-1.5 py-0.5 rounded text-gray-500 w-32 flex-shrink-0">{zSub}</code>
                      <ArrowRight className="w-3 h-3 text-gray-300 flex-shrink-0" />
                      <span className="text-sm text-gray-600">
                        {eff.catName}
                        <span className="text-gray-400"> / {eff.subName}</span>
                      </span>
                      <div className="ml-auto flex items-center gap-1">
                        <Badge
                          variant={eff.ruleType === 'specific' ? 'blue' : eff.ruleType === 'cat' ? 'amber' : 'gray'}
                          size="sm"
                        >
                          {eff.ruleType === 'specific' ? 'Regel' : eff.ruleType === 'cat' ? 'Via kategori' : 'Automatisk'}
                        </Badge>
                        {specificRule ? (
                          <button
                            onClick={() => startEdit(specificRule)}
                            title="Redigera regel"
                            className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-brand-600 p-1 transition-opacity"
                          >
                            <Edit2 className="w-3 h-3" />
                          </button>
                        ) : (
                          <button
                            onClick={() => startAddForZlantar(zCat, zSub)}
                            title="Lägg till regel"
                            className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-brand-600 p-1 transition-opacity"
                          >
                            <Plus className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      </Card>
    </div>
  )
}

// ─── API keys tab ─────────────────────────────────────────────────────────────

function ApiKeysTab() {
  const store = useAppStore()
  const [key, setKey] = useState(store.settings.anthropicApiKey ?? '')
  const [saved, setSaved] = useState(false)
  const [show, setShow] = useState(false)
  const model = store.settings.anthropicModel ?? DEFAULT_RECEIPT_MODEL

  function save() {
    store.updateSettings({ anthropicApiKey: key.trim() || undefined })
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="max-w-lg space-y-6">
      <Card>
        <CardHeader
          title="Anthropic API-nyckel"
          subtitle="Används för att tolka matkvitton med Claude AI"
        />
        <div className="space-y-4">
          <p className="text-sm text-gray-500">
            Nyckeln sparas lokalt i webbläsaren och används enbart för att skicka kvitton till
            Anthropic för analys. Hämta din nyckel på{' '}
            <a
              href="https://console.anthropic.com/settings/keys"
              target="_blank"
              rel="noreferrer"
              className="text-brand-600 hover:underline"
            >
              console.anthropic.com
            </a>.
          </p>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <input
                type={show ? 'text' : 'password'}
                value={key}
                onChange={(e) => { setKey(e.target.value); setSaved(false) }}
                placeholder="sk-ant-…"
                className="w-full border border-warm-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-400 pr-10"
              />
              <button
                type="button"
                onClick={() => setShow((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs"
              >
                {show ? 'Dölj' : 'Visa'}
              </button>
            </div>
            <Button onClick={save} variant={saved ? 'secondary' : 'primary'} size="md">
              {saved ? '✓ Sparat' : 'Spara'}
            </Button>
          </div>
          {key && (
            <button
              className="text-xs text-red-500 hover:underline"
              onClick={() => { setKey(''); store.updateSettings({ anthropicApiKey: undefined }) }}
            >
              Ta bort nyckel
            </button>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Modell för kvittotolkning"
          subtitle="Billigare modeller är snabbare men kan missa kantfall"
        />
        <div className="space-y-2">
          {RECEIPT_MODELS.map((m) => (
            <label key={m.id} className="flex items-center gap-3 cursor-pointer group">
              <input
                type="radio"
                name="receipt-model"
                value={m.id}
                checked={model === m.id}
                onChange={() => store.updateSettings({ anthropicModel: m.id })}
                className="accent-brand-600"
              />
              <span className="text-sm text-gray-700 group-hover:text-gray-900">{m.label}</span>
            </label>
          ))}
        </div>
      </Card>
    </div>
  )
}
