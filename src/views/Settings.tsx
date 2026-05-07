import { useState } from 'react'
import { Plus, Trash2, Edit2, X, Check, ArrowRight } from 'lucide-react'
import { useAppStore } from '@/store'
import { Layout, PageHeader } from '@/components/layout/Layout'
import { Card, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
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
  const [tab, setTab] = useState<'accounts' | 'recurring' | 'categories' | 'mapping'>('accounts')

  return (
    <Layout>
      <PageHeader title="Inställningar" />

      <div className="flex gap-1 mb-6 border-b border-gray-200">
        {([
          { key: 'accounts',   label: 'Konton' },
          { key: 'recurring',  label: 'Återkommande poster' },
          { key: 'categories', label: 'Kategorier' },
          { key: 'mapping',    label: 'Zlantar-mappning' },
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

      {tab === 'accounts'   && <AccountsTab />}
      {tab === 'recurring'  && <RecurringTab />}
      {tab === 'categories' && <CategoriesTab />}
      {tab === 'mapping'    && <ZlantarMappingTab />}
    </Layout>
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

// Known Zlantar top-level category IDs (fixed by Zlantar's export format)
const KNOWN_ZLANTAR_CATS = [
  'salary', 'interest', 'refund', 'sale',
  'food', 'household', 'transport', 'shopping', 'leisure', 'other', 'stocks',
]

function ZlantarMappingTab() {
  const store = useAppStore()
  const { zlantarCategoryRules, categories } = store.settings

  const [editingId, setEditingId] = useState<string | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const emptyForm = (): Partial<ZlantarCategoryRule> => ({})
  const [form, setForm] = useState<Partial<ZlantarCategoryRule>>(emptyForm())

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
  }

  const cancelForm = () => {
    setEditingId(null)
    setShowAdd(false)
    setForm(emptyForm())
  }

  // Compute effective mapping for the known Zlantar category IDs
  const effectiveMap = (zlantarCat: string): { catName: string; subName?: string } | null => {
    const rule = zlantarCategoryRules.find((r) => r.zlantarCategory === zlantarCat && !r.zlantarSubcategory)
    if (rule) {
      const cat = categories.find((c) => c.id === rule.appCategoryId)
      const sub = cat?.subcategories.find((s) => s.id === rule.appSubcategoryId)
      return { catName: cat?.name ?? rule.appCategoryId, subName: sub?.name ?? rule.appSubcategoryId }
    }
    // No rule — falls back to direct ID match
    const directCat = categories.find((c) => c.id === zlantarCat)
    if (directCat) return { catName: directCat.name }
    return null
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
            {KNOWN_ZLANTAR_CATS.map((c) => <option key={c} value={c} />)}
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

      {/* Effective mapping overview */}
      <Card>
        <CardHeader
          title="Effektiv mappning"
          subtitle="Kända Zlantar-kategorier och deras nuvarande mappning (regel eller automatisk)."
        />
        <div className="divide-y divide-gray-50">
          {KNOWN_ZLANTAR_CATS.map((zCat) => {
            const eff = effectiveMap(zCat)
            const hasRule = zlantarCategoryRules.some((r) => r.zlantarCategory === zCat && !r.zlantarSubcategory)
            return (
              <div key={zCat} className="flex items-center gap-3 py-2 px-2">
                <code className="text-xs bg-gray-100 px-1.5 py-0.5 rounded text-gray-700 w-24 flex-shrink-0">{zCat}</code>
                <ArrowRight className="w-3.5 h-3.5 text-gray-300 flex-shrink-0" />
                {eff ? (
                  <span className="text-sm text-gray-700">
                    {eff.catName}{eff.subName ? <span className="text-gray-400"> / {eff.subName}</span> : null}
                  </span>
                ) : (
                  <span className="text-sm text-red-400 italic">omappad → Övrigt</span>
                )}
                <div className="ml-auto">
                  {hasRule
                    ? <Badge variant="blue" size="sm">Regel</Badge>
                    : <Badge variant="gray" size="sm">Automatisk</Badge>
                  }
                </div>
              </div>
            )
          })}
        </div>
      </Card>
    </div>
  )
}
