import { useState } from 'react'
import { Plus, Trash2, Edit2, X, Check } from 'lucide-react'
import { useAppStore } from '@/store'
import { Layout, PageHeader } from '@/components/layout/Layout'
import { Card, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import type { Account, RecurringItem, AccountType } from '@/types'

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
  const [tab, setTab] = useState<'accounts' | 'recurring' | 'categories'>('accounts')

  return (
    <Layout>
      <PageHeader title="Inställningar" />

      <div className="flex gap-1 mb-6 border-b border-gray-200">
        {([
          { key: 'accounts',   label: 'Konton' },
          { key: 'recurring',  label: 'Återkommande poster' },
          { key: 'categories', label: 'Kategorier' },
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

function CategoriesTab() {
  const { settings } = useAppStore()
  const { categories } = settings

  return (
    <Card>
      <CardHeader
        title="Kategorier"
        subtitle="Kategorier importeras automatiskt från Zlantar. Kontakta support för att anpassa dem."
      />
      <div className="space-y-1">
        {categories.map((cat) => (
          <div key={cat.id}>
            <div className="flex items-center gap-2 py-2 px-2 rounded-lg">
              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: cat.color ?? '#94a3b8' }} />
              <span className="font-medium text-sm text-gray-800">{cat.name}</span>
              <Badge variant={cat.type === 'income' ? 'green' : cat.type === 'savings' ? 'blue' : 'gray'} size="sm">
                {cat.type === 'income' ? 'Inkomst' : cat.type === 'savings' ? 'Sparande' : 'Utgift'}
              </Badge>
            </div>
            <div className="ml-5 space-y-0.5 mb-1">
              {cat.subcategories.map((sub) => (
                <div key={sub.id} className="text-xs text-gray-500 py-0.5 pl-3 border-l border-gray-100">
                  {sub.name}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Card>
  )
}
