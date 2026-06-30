import { useMemo, useState, useRef } from 'react'
import { Upload, CheckCircle, AlertTriangle, Info, ChevronDown, ChevronRight, Trash2, ArrowLeftRight, Plus } from 'lucide-react'
import { useAppStore } from '@/store'
import { Layout, PageHeader } from '@/components/layout/Layout'
import { Card, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { parseZlantarFiles, buildMonthlyActuals, deriveAccounts, deriveRecurringItems, findUnknownCategories, actualsEquivalent } from '@/utils/zlantarParser'
import { reconcileTransfers, reconciledKeysFromRecords, txKey } from '@/utils/transferReconciliation'
import { formatCurrency } from '@/utils/budgetHelpers'
import { uniqueSlug } from '@/utils/slug'
import type { MonthlyActuals, RecurringItem, ReconciliationRecord, TransferMatch, ZlantarImport, ZlantarTransaction, CategoryDef } from '@/types'

type Step = 'upload' | 'preview' | 'done'

export function ImportView() {
  const [step, setStep] = useState<Step>('upload')
  const [dataFile, setDataFile] = useState<File | null>(null)
  const [txFile, setTxFile] = useState<File | null>(null)
  const [parsedImport, setParsedImport] = useState<ZlantarImport | null>(null)
  const [newAccounts, setNewAccounts] = useState<ReturnType<typeof deriveAccounts>>([])
  const [newRecurring, setNewRecurring] = useState<RecurringItem[]>([])
  const [importing, setImporting] = useState(false)

  // Selection state for preview step
  const [selectedMonths, setSelectedMonths] = useState<Set<string>>(new Set())
  const [deselectedCatKeys, setDeselectedCatKeys] = useState<Set<string>>(new Set())
  const [expandedMonths, setExpandedMonths] = useState<Set<string>>(new Set())
  const [selectedAccountIds, setSelectedAccountIds] = useState<Set<string>>(new Set())
  const [selectedRecurringIds, setSelectedRecurringIds] = useState<Set<string>>(new Set())
  const [transferMatches, setTransferMatches] = useState<TransferMatch[]>([])
  const [acceptedMatchIds, setAcceptedMatchIds] = useState<Set<string>>(new Set())

  const dataRef = useRef<HTMLInputElement>(null)
  const txRef = useRef<HTMLInputElement>(null)

  const store = useAppStore()

  const parseFiles = async () => {
    if (!txFile && !dataFile) return
    setImporting(true)
    try {
      let dataJson: unknown = {}
      if (dataFile) {
        const text = await dataFile.text()
        dataJson = JSON.parse(text)
      }
      let txJson: unknown = []
      if (txFile) {
        const txText = await txFile.text()
        txJson = JSON.parse(txText)
      }

      const imp = parseZlantarFiles(dataJson, txJson)

      // Reconcile transfers between owners. Combine new transactions with the
      // existing pool (deduped by key) so cross-import pairs can match.
      const previouslyReconciled = reconciledKeysFromRecords(store.reconciliations)
      const combinedTxs: ZlantarTransaction[] = [...store.allTransactions]
      const seen = new Set(combinedTxs.map(txKey))
      for (const tx of imp.transactions) {
        if (!seen.has(txKey(tx))) {
          combinedTxs.push(tx)
          seen.add(txKey(tx))
        }
      }
      const matches = reconcileTransfers({
        transactions: combinedTxs,
        accounts: store.settings.accounts,
        partnerName: store.settings.partnerName,
        alreadyReconciledKeys: previouslyReconciled,
      })

      const accounts = deriveAccounts(imp.data)
      const recurring = deriveRecurringItems(imp.data)

      const existingAccountIds = new Set(store.settings.accounts.map((a) => a.id))
      const existingRecurringIds = new Set(store.settings.recurringItems.map((r) => r.id))
      const newAccs = accounts.filter((a) => !existingAccountIds.has(a.id))
      const newRec = recurring.filter((r) => !existingRecurringIds.has(r.id))

      setParsedImport(imp)
      setNewAccounts(newAccs)
      setNewRecurring(newRec)
      setSelectedAccountIds(new Set(newAccs.map((a) => a.id)))
      setSelectedRecurringIds(new Set(newRec.map((r) => r.id)))
      setDeselectedCatKeys(new Set())
      setExpandedMonths(new Set())
      setTransferMatches(matches)
      setAcceptedMatchIds(new Set(matches.map((m) => m.id)))

      // Seed selected months based on the initial (reconciled) filtered preview
      const initialAccepted = new Set<string>(previouslyReconciled)
      for (const m of matches) {
        initialAccepted.add(m.txAKey)
        initialAccepted.add(m.txBKey)
      }
      const fullActuals = buildMonthlyActuals(
        imp,
        store.settings.categories,
        store.settings.zlantarCategoryRules,
        store.settings.monthStartDay,
        store.settings.monthStartBusinessDay,
        initialAccepted
      )
      const initialMonths = new Set<string>()
      for (const [ym, candidate] of Object.entries(fullActuals)) {
        const existing = store.actuals[ym]
        if (existing && actualsEquivalent(existing, candidate)) continue
        initialMonths.add(ym)
      }
      setSelectedMonths(initialMonths)

      setStep('preview')
    } catch (err) {
      alert(`Fel vid inläsning: ${(err as Error).message}`)
    } finally {
      setImporting(false)
    }
  }

  // Live-updating actuals: depends on which transfer matches the user has
  // accepted. Reconciled tx keys are excluded from category aggregates, and
  // months whose aggregates are identical to what's already stored are hidden.
  const acceptedKeys = useMemo(() => {
    const keys = reconciledKeysFromRecords(store.reconciliations)
    for (const m of transferMatches) {
      if (acceptedMatchIds.has(m.id)) {
        keys.add(m.txAKey)
        keys.add(m.txBKey)
      }
    }
    return keys
  }, [store.reconciliations, transferMatches, acceptedMatchIds])

  const { preview, unchangedMonthCount } = useMemo(() => {
    if (!parsedImport) return { preview: null as Record<string, MonthlyActuals> | null, unchangedMonthCount: 0 }
    const full = buildMonthlyActuals(
      parsedImport,
      store.settings.categories,
      store.settings.zlantarCategoryRules,
      store.settings.monthStartDay,
      store.settings.monthStartBusinessDay,
      acceptedKeys
    )
    const filtered: Record<string, MonthlyActuals> = {}
    let unchanged = 0
    for (const [ym, candidate] of Object.entries(full)) {
      const existing = store.actuals[ym]
      if (existing && actualsEquivalent(existing, candidate)) {
        unchanged++
        continue
      }
      filtered[ym] = candidate
    }
    return { preview: filtered, unchangedMonthCount: unchanged }
  }, [parsedImport, store.settings.categories, store.settings.zlantarCategoryRules, store.settings.monthStartDay, store.settings.monthStartBusinessDay, acceptedKeys, store.actuals])

  // Unmapped categories among the new transactions, grouped by raw category, with a
  // suggested Swedish name. Recomputes as the user creates/maps categories below.
  const unknownByCategory = useMemo(() => {
    if (!parsedImport) return []
    const existingKeys = new Set(store.allTransactions.map(txKey))
    const newTxs = parsedImport.transactions.filter((tx) => !existingKeys.has(txKey(tx)))
    const unknown = findUnknownCategories(newTxs, store.settings.categories, store.settings.zlantarCategoryRules)
    const m = new Map<string, { rawCategory: string; suggestedName: string; suggestedType: CategoryDef['type']; count: number; totalAmount: number; subs: string[] }>()
    for (const u of unknown) {
      const g = m.get(u.rawCategory) ?? { rawCategory: u.rawCategory, suggestedName: u.suggestedName, suggestedType: u.suggestedType, count: 0, totalAmount: 0, subs: [] }
      g.count += u.count
      g.totalAmount += u.totalAmount
      if (u.rawSubcategory && !g.subs.includes(u.rawSubcategory)) g.subs.push(u.rawSubcategory)
      m.set(u.rawCategory, g)
    }
    return [...m.values()]
  }, [parsedImport, store.allTransactions, store.settings.categories, store.settings.zlantarCategoryRules])

  const handleCreateCategory = (rawCategory: string, name: string, type: CategoryDef['type']) => {
    const taken = new Set(store.settings.categories.map((c) => c.id))
    const id = uniqueSlug(name, taken)
    const newCat: CategoryDef = { id, name, type, subcategories: [], color: '#94a3b8', icon: 'MoreHorizontal' }
    store.setCategories([...store.settings.categories, newCat])
    store.upsertZlantarRule({ id: `z_${rawCategory}_${id}`, zlantarCategory: rawCategory, appCategoryId: id })
  }

  const handleMapCategory = (rawCategory: string, appCategoryId: string, appSubcategoryId?: string) => {
    store.upsertZlantarRule({ id: `z_${rawCategory}_${appCategoryId}`, zlantarCategory: rawCategory, appCategoryId, appSubcategoryId: appSubcategoryId || undefined })
  }

  const confirmImport = () => {
    if (!preview || !parsedImport) return
    store.setZlantarImport(parsedImport)
    for (const [ym, act] of Object.entries(preview)) {
      if (!selectedMonths.has(ym)) continue
      const filteredEntries = act.entries.filter(
        (e) => !deselectedCatKeys.has(`${ym}:${e.categoryId}`)
      )
      if (filteredEntries.length === 0) continue
      store.upsertActuals({ ...act, entries: filteredEntries })
    }
    for (const acc of newAccounts) {
      if (selectedAccountIds.has(acc.id)) store.upsertAccount(acc)
    }
    for (const rec of newRecurring) {
      if (selectedRecurringIds.has(rec.id)) store.upsertRecurring(rec)
    }

    // Persist accepted transfer matches as a reconciliation record
    const accepted = transferMatches.filter((m) => acceptedMatchIds.has(m.id))
    if (accepted.length > 0) {
      const record: ReconciliationRecord = {
        id: parsedImport.importedAt,
        importedAt: parsedImport.importedAt,
        matches: accepted,
      }
      store.addReconciliationRecord(record)
    }

    setStep('done')
  }

  const reset = () => {
    setStep('upload')
    setDataFile(null)
    setTxFile(null)
    setParsedImport(null)
    setNewAccounts([])
    setNewRecurring([])
    setSelectedMonths(new Set())
    setDeselectedCatKeys(new Set())
    setExpandedMonths(new Set())
    setSelectedAccountIds(new Set())
    setSelectedRecurringIds(new Set())
    setTransferMatches([])
    setAcceptedMatchIds(new Set())
  }

  const toggleMatch = (id: string) =>
    setAcceptedMatchIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })

  const toggleMonth = (ym: string) =>
    setSelectedMonths((prev) => {
      const next = new Set(prev)
      if (next.has(ym)) next.delete(ym); else next.add(ym)
      return next
    })

  const toggleCatKey = (key: string) =>
    setDeselectedCatKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })

  const toggleExpanded = (ym: string) =>
    setExpandedMonths((prev) => {
      const next = new Set(prev)
      if (next.has(ym)) next.delete(ym); else next.add(ym)
      return next
    })

  const toggleAccount = (id: string) =>
    setSelectedAccountIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })

  const toggleRecurring = (id: string) =>
    setSelectedRecurringIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })

  const months = preview ? Object.keys(preview).sort() : []
  const importedMonths = months.filter((m) => selectedMonths.has(m))
  const existingActuals = Object.keys(store.actuals).sort()

  return (
    <Layout>
      <PageHeader
        title="Importera från Zlantar"
        subtitle="Läs in din exporterade data från Zlantar-appen"
      />

      {/* Step indicator */}
      <div className="flex items-center gap-2 mb-6">
        {(['upload', 'preview', 'done'] as Step[]).map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold
              ${step === s ? 'bg-brand-600 text-white' : i < ['upload','preview','done'].indexOf(step) ? 'bg-green-500 text-white' : 'bg-gray-200 text-gray-500'}`}>
              {i + 1}
            </div>
            <span className={`text-sm ${step === s ? 'font-semibold text-gray-900' : 'text-gray-400'}`}>
              {s === 'upload' ? 'Välj filer' : s === 'preview' ? 'Granska' : 'Klart'}
            </span>
            {i < 2 && <div className="w-8 h-px bg-gray-200" />}
          </div>
        ))}
      </div>

      {/* Step 1: Upload */}
      {step === 'upload' && (
        <div className="space-y-4">
          <Card>
            <CardHeader title="Välj Zlantar-exportfiler" subtitle="Exportera din data från Zlantar via Profil → Inställningar → Exportera min data" />

            <div className="bg-brand-50 border border-brand-100 rounded-lg p-3 flex gap-2 mb-5">
              <Info className="w-4 h-4 text-brand-600 mt-0.5 shrink-0" />
              <p className="text-sm text-brand-800">
                Ladda upp <strong>transactions.json</strong> för transaktionsdata och/eller <strong>data.json</strong> för kontoinformation.
                Minst en av filerna krävs. Båda finns i ZIP-filen från Zlantar.
              </p>
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              <FileDropZone
                label="transactions.json"
                description="Transaktionsdata"
                file={txFile}
                accept=".json"
                inputRef={txRef}
                onFile={setTxFile}
              />
              <FileDropZone
                label="data.json"
                description="Kontoinformation"
                file={dataFile}
                accept=".json"
                inputRef={dataRef}
                onFile={setDataFile}
              />
            </div>
          </Card>

          <div className="flex justify-end">
            <Button onClick={parseFiles} disabled={!txFile && !dataFile} loading={importing}>
              Granska import
            </Button>
          </div>

          {/* Existing actuals — remove previous imports */}
          {existingActuals.length > 0 && (
            <Card padding={false}>
              <div className="p-4 border-b border-gray-100">
                <h3 className="font-semibold text-gray-900">Importerade utfall</h3>
                <p className="text-sm text-gray-500">{existingActuals.length} månader · klicka på papperskorgen för att ta bort</p>
              </div>
              {existingActuals.map((ym) => {
                const act = store.actuals[ym]
                const total = act.entries.reduce((s, e) => s + e.totalAmount, 0)
                return (
                  <div key={ym} className="flex items-center justify-between px-4 py-2.5 border-t border-gray-100">
                    <div>
                      <span className="text-sm font-medium text-gray-800">{ym}</span>
                      <span className="text-xs text-gray-400 ml-2">{act.entries.length} poster</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm text-gray-600">{formatCurrency(total)}</span>
                      <button
                        onClick={() => store.removeActuals(ym)}
                        className="p-1 text-gray-300 hover:text-red-500 rounded transition-colors"
                        title="Ta bort"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                )
              })}
            </Card>
          )}

          {/* Historical reconciliations */}
          {store.reconciliations.length > 0 && (
            <ReconciliationHistory
              records={store.reconciliations}
              onRemove={(id) => store.removeReconciliationRecord(id)}
            />
          )}
        </div>
      )}

      {/* Step 2: Preview */}
      {step === 'preview' && preview && (
        <div className="space-y-4">
          {/* Nothing new */}
          {months.length === 0 && newAccounts.length === 0 && newRecurring.length === 0 && transferMatches.length === 0 && (
            <Card>
              <div className="flex items-start gap-3">
                <Info className="w-5 h-5 text-brand-600 mt-0.5 shrink-0" />
                <div>
                  <h3 className="font-semibold text-gray-800 mb-1">Inget nytt att importera</h3>
                  <p className="text-sm text-gray-500">
                    {unchangedMonthCount > 0
                      ? `${unchangedMonthCount} ${unchangedMonthCount === 1 ? 'månad är' : 'månader är'} redan importerade och oförändrade.`
                      : 'Filen innehåller ingen ny information.'}
                  </p>
                </div>
              </div>
            </Card>
          )}

          {/* Unchanged months banner */}
          {unchangedMonthCount > 0 && (months.length > 0 || newAccounts.length > 0 || newRecurring.length > 0 || transferMatches.length > 0) && (
            <Card>
              <div className="flex items-start gap-3">
                <Info className="w-5 h-5 text-brand-600 mt-0.5 shrink-0" />
                <p className="text-sm text-gray-700">
                  <strong>{unchangedMonthCount}</strong> {unchangedMonthCount === 1 ? 'månad är' : 'månader är'} redan importerade och oförändrade — visas inte.
                </p>
              </div>
            </Card>
          )}

          {/* Transfer reconciliation between owners */}
          <ReconciliationCard
            matches={transferMatches}
            acceptedIds={acceptedMatchIds}
            onToggle={toggleMatch}
            ownersConfigured={
              new Set(
                store.settings.accounts
                  .map((a) => a.owner?.trim().toLowerCase())
                  .filter((o): o is string => Boolean(o))
              ).size >= 2
            }
          />

          {/* Unknown categories — suggest a Swedish name, create or map */}
          {unknownByCategory.length > 0 && (
            <Card>
              <div className="flex items-start gap-3 mb-4">
                <AlertTriangle className="w-5 h-5 text-amber-500 mt-0.5 shrink-0" />
                <div>
                  <h3 className="font-semibold text-gray-800 mb-1">
                    {unknownByCategory.length} omappade {unknownByCategory.length === 1 ? 'kategori' : 'kategorier'}
                  </h3>
                  <p className="text-sm text-gray-500">
                    Dessa kategorier från Zlantar saknar mappning. Skapa en ny kategori med föreslaget
                    namn, eller mappa till en befintlig. Tills dess hamnar de under "Övrigt".
                  </p>
                </div>
              </div>
              <div className="space-y-2">
                {unknownByCategory.map((u) => (
                  <UnknownCategoryRow
                    key={u.rawCategory}
                    rawCategory={u.rawCategory}
                    suggestedName={u.suggestedName}
                    suggestedType={u.suggestedType}
                    count={u.count}
                    totalAmount={u.totalAmount}
                    subs={u.subs}
                    categories={store.settings.categories}
                    onCreate={() => handleCreateCategory(u.rawCategory, u.suggestedName, u.suggestedType)}
                    onMap={(catId, subId) => handleMapCategory(u.rawCategory, catId, subId)}
                  />
                ))}
              </div>
            </Card>
          )}

          {/* New accounts */}
          {newAccounts.length > 0 && (
            <Card>
              <CardHeader title={`${newAccounts.length} nya konton hittades`} subtitle="Välj vilka som ska läggas till" />
              <div className="space-y-2">
                {newAccounts.map((a) => (
                  <label key={a.id} className="flex items-center justify-between p-2 bg-gray-50 rounded-lg cursor-pointer hover:bg-gray-100">
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={selectedAccountIds.has(a.id)}
                        onChange={() => toggleAccount(a.id)}
                        className="rounded"
                      />
                      <span className="text-sm font-medium text-gray-800">{a.name}</span>
                      {a.bankName && <span className="text-xs text-gray-400">{a.bankName}</span>}
                    </div>
                    <Badge variant={a.type === 'loan' ? 'red' : a.type === 'savings' || a.type === 'isk' ? 'blue' : 'gray'}>
                      {a.type}
                    </Badge>
                  </label>
                ))}
              </div>
            </Card>
          )}

          {/* Recurring items */}
          {newRecurring.length > 0 && (
            <Card>
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h3 className="font-semibold text-gray-900">{newRecurring.length} återkommande poster från Zlantar</h3>
                  <p className="text-sm text-gray-500">Hittades i dina avtal och prenumerationer</p>
                </div>
                <button
                  className="text-xs text-brand-600 hover:underline"
                  onClick={() => {
                    if (selectedRecurringIds.size === newRecurring.length) {
                      setSelectedRecurringIds(new Set())
                    } else {
                      setSelectedRecurringIds(new Set(newRecurring.map((r) => r.id)))
                    }
                  }}
                >
                  {selectedRecurringIds.size === newRecurring.length ? 'Avmarkera alla' : 'Markera alla'}
                </button>
              </div>
              <div className="space-y-1.5">
                {newRecurring.map((r) => (
                  <label key={r.id} className="flex items-center justify-between p-2 bg-gray-50 rounded-lg cursor-pointer hover:bg-gray-100">
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={selectedRecurringIds.has(r.id)}
                        onChange={() => toggleRecurring(r.id)}
                        className="rounded"
                      />
                      <span className="text-sm text-gray-800">{r.name}</span>
                    </div>
                    <span className="text-sm font-medium text-gray-700">{r.amount.toLocaleString('sv-SE')} kr/mån</span>
                  </label>
                ))}
              </div>
            </Card>
          )}

          {/* Month summaries with per-category selection */}
          {months.length > 0 && (
          <Card padding={false}>
            <div className="p-4 border-b border-gray-100 flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-gray-900">Månadsutfall</h3>
                <p className="text-sm text-gray-500">{importedMonths.length} av {months.length} månader valda</p>
              </div>
              <button
                className="text-xs text-brand-600 hover:underline"
                onClick={() => {
                  if (selectedMonths.size === months.length) {
                    setSelectedMonths(new Set())
                  } else {
                    setSelectedMonths(new Set(months))
                  }
                }}
              >
                {selectedMonths.size === months.length ? 'Avmarkera alla' : 'Markera alla'}
              </button>
            </div>

            {months.map((ym) => {
              const act = preview[ym]
              const total = act.entries.reduce((s, e) => s + e.totalAmount, 0)
              const isSelected = selectedMonths.has(ym)
              const isExpanded = expandedMonths.has(ym)

              // Group entries by category, summing subcategory amounts
              const catGroups = Object.values(
                act.entries.reduce((acc, e) => {
                  if (!acc[e.categoryId]) acc[e.categoryId] = { id: e.categoryId, name: e.categoryName, total: 0 }
                  acc[e.categoryId].total += e.totalAmount
                  return acc
                }, {} as Record<string, { id: string; name: string; total: number }>)
              ).sort((a, b) => Math.abs(b.total) - Math.abs(a.total))

              const deselectedCount = catGroups.filter((c) => deselectedCatKeys.has(`${ym}:${c.id}`)).length

              return (
                <div key={ym} className={`border-t border-gray-100 ${!isSelected ? 'opacity-50' : ''}`}>
                  <div className="flex items-center gap-3 px-4 py-3">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleMonth(ym)}
                      className="rounded shrink-0"
                    />
                    <button
                      className="flex-1 flex items-center justify-between text-left min-w-0"
                      onClick={() => isSelected && toggleExpanded(ym)}
                      disabled={!isSelected}
                    >
                      <div className="min-w-0">
                        <span className="font-medium text-gray-800">{ym}</span>
                        <span className="text-sm text-gray-400 ml-3">
                          {catGroups.length} kategorier
                          {deselectedCount > 0 && <span className="text-amber-600"> · {deselectedCount} avmarkerade</span>}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 shrink-0 ml-3">
                        <span className="font-medium text-gray-700">{formatCurrency(total)}</span>
                        {isSelected && (
                          isExpanded
                            ? <ChevronDown className="w-4 h-4 text-gray-400" />
                            : <ChevronRight className="w-4 h-4 text-gray-400" />
                        )}
                      </div>
                    </button>
                  </div>

                  {isSelected && isExpanded && (
                    <div className="px-4 pb-3 space-y-0.5 border-t border-gray-50 pt-2">
                      {catGroups.map((cat) => {
                        const catKey = `${ym}:${cat.id}`
                        const isChecked = !deselectedCatKeys.has(catKey)
                        return (
                          <label key={cat.id} className="flex items-center justify-between pl-7 py-1.5 rounded hover:bg-gray-50 cursor-pointer">
                            <div className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={() => toggleCatKey(catKey)}
                                className="rounded"
                              />
                              <span className={`text-sm ${isChecked ? 'text-gray-700' : 'text-gray-400 line-through'}`}>
                                {cat.name}
                              </span>
                            </div>
                            <span className={`text-sm ${isChecked ? 'text-gray-500' : 'text-gray-300'}`}>
                              {formatCurrency(cat.total)}
                            </span>
                          </label>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </Card>
          )}

          <div className="flex justify-between">
            <Button variant="secondary" onClick={reset}>Börja om</Button>
            <Button
              onClick={confirmImport}
              disabled={
                importedMonths.length === 0 &&
                selectedAccountIds.size === 0 &&
                selectedRecurringIds.size === 0 &&
                acceptedMatchIds.size === 0
              }
            >
              <CheckCircle className="w-4 h-4" />
              Bekräfta import ({importedMonths.length} {importedMonths.length === 1 ? 'månad' : 'månader'})
            </Button>
          </div>
        </div>
      )}

      {/* Step 3: Done */}
      {step === 'done' && (
        <Card className="text-center py-12">
          <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-4" />
          <h3 className="text-xl font-semibold text-gray-800 mb-2">Import klar!</h3>
          <p className="text-gray-500 mb-6">
            {importedMonths.length} {importedMonths.length === 1 ? 'månad' : 'månader'} med utfallsdata har importerats.
            Gå till månads- eller årsbudgeten för att jämföra med dina budgetar.
          </p>
          <div className="flex justify-center gap-3">
            <Button variant="secondary" onClick={reset}>Importera mer</Button>
          </div>
        </Card>
      )}
    </Layout>
  )
}

// ─── Unknown category row (suggest / create / map) ────────────────────────────

function UnknownCategoryRow({
  rawCategory, suggestedName, suggestedType, count, totalAmount, subs, categories, onCreate, onMap,
}: {
  rawCategory: string
  suggestedName: string
  suggestedType: CategoryDef['type']
  count: number
  totalAmount: number
  subs: string[]
  categories: CategoryDef[]
  onCreate: () => void
  onMap: (catId: string, subId?: string) => void
}) {
  const [mapCatId, setMapCatId] = useState('')
  const [mapSubId, setMapSubId] = useState('')
  const selectedCat = categories.find((c) => c.id === mapCatId)
  const typeLabel = suggestedType === 'income' ? 'Inkomst' : suggestedType === 'savings' ? 'Sparande' : suggestedType === 'transfer' ? 'Överföring' : 'Utgift'

  return (
    <div className="border border-amber-200 bg-amber-50/40 rounded-xl p-3">
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <code className="text-xs bg-white border border-amber-200 px-1.5 py-0.5 rounded text-gray-700">{rawCategory}</code>
        {subs.length > 0 && <span className="text-xs text-gray-400 truncate">{subs.join(', ')}</span>}
        <span className="text-xs text-gray-400">· {count} st · {formatCurrency(totalAmount)}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={onCreate}>
          <Plus className="w-4 h-4" /> Skapa "{suggestedName}"
        </Button>
        <Badge variant={suggestedType === 'income' ? 'green' : suggestedType === 'savings' ? 'blue' : 'gray'}>{typeLabel}</Badge>
        <span className="text-xs text-gray-400">eller mappa till</span>
        <select
          className="border border-gray-200 rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          value={mapCatId}
          onChange={(e) => { setMapCatId(e.target.value); setMapSubId('') }}
        >
          <option value="">Välj kategori…</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        {selectedCat && selectedCat.subcategories.length > 0 && (
          <select
            className="border border-gray-200 rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            value={mapSubId}
            onChange={(e) => setMapSubId(e.target.value)}
          >
            <option value="">(ingen underkategori)</option>
            {selectedCat.subcategories.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}
        <Button size="sm" variant="secondary" disabled={!mapCatId} onClick={() => onMap(mapCatId, mapSubId || undefined)}>
          Mappa
        </Button>
      </div>
    </div>
  )
}

// ─── File drop zone ───────────────────────────────────────────────────────────

function FileDropZone({
  label, description, required, file, accept, inputRef, onFile,
}: {
  label: string
  description: string
  required?: boolean
  file: File | null
  accept: string
  inputRef: React.RefObject<HTMLInputElement | null>
  onFile: (f: File) => void
}) {
  const [dragging, setDragging] = useState(false)

  return (
    <div
      className={`border-2 border-dashed rounded-xl p-6 text-center transition-colors cursor-pointer
        ${dragging ? 'border-brand-400 bg-brand-50' : file ? 'border-green-400 bg-green-50' : 'border-gray-200 hover:border-brand-300'}`}
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        const f = e.dataTransfer.files[0]
        if (f) onFile(f)
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f) }}
      />
      {file ? (
        <>
          <CheckCircle className="w-8 h-8 text-green-500 mx-auto mb-2" />
          <p className="font-medium text-green-800">{file.name}</p>
          <p className="text-xs text-green-600">{Math.round(file.size / 1024)} KB</p>
        </>
      ) : (
        <>
          <Upload className="w-8 h-8 text-gray-300 mx-auto mb-2" />
          <p className="font-medium text-gray-700">
            {label} {required && <span className="text-red-500">*</span>}
          </p>
          <p className="text-xs text-gray-400 mt-1">{description}</p>
          <p className="text-xs text-gray-300 mt-2">Klicka eller dra hit</p>
        </>
      )}
    </div>
  )
}

// ─── Reconciliation review (in-import preview) ────────────────────────────────

function ReconciliationCard({
  matches,
  acceptedIds,
  onToggle,
  ownersConfigured,
}: {
  matches: TransferMatch[]
  acceptedIds: Set<string>
  onToggle: (id: string) => void
  ownersConfigured: boolean
}) {
  if (!ownersConfigured) {
    return (
      <Card>
        <div className="flex items-start gap-3">
          <Info className="w-5 h-5 text-brand-600 mt-0.5 shrink-0" />
          <div>
            <h3 className="font-semibold text-gray-800 mb-1">Avstämning av överföringar</h3>
            <p className="text-sm text-gray-500">
              För att automatiskt nolla ut swish och bankgireringar mellan dig och din partner,
              sätt en <strong>ägare</strong> på dina konton i <em>Inställningar → Konton</em>.
              Minst två olika ägare krävs för att avstämning ska aktiveras.
            </p>
          </div>
        </div>
      </Card>
    )
  }

  if (matches.length === 0) {
    return (
      <Card>
        <div className="flex items-start gap-3">
          <ArrowLeftRight className="w-5 h-5 text-gray-300 mt-0.5 shrink-0" />
          <div>
            <h3 className="font-semibold text-gray-800 mb-1">Inga överföringar att stämma av</h3>
            <p className="text-sm text-gray-500">
              Inga matchande transaktioner mellan olika ägare hittades i den här importen.
            </p>
          </div>
        </div>
      </Card>
    )
  }

  const acceptedCount = matches.filter((m) => acceptedIds.has(m.id)).length
  const totalAmount = matches
    .filter((m) => acceptedIds.has(m.id))
    .reduce((s, m) => s + m.amount, 0)

  return (
    <Card padding={false}>
      <div className="p-4 border-b border-gray-100 flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <ArrowLeftRight className="w-5 h-5 text-brand-600 mt-0.5 shrink-0" />
          <div>
            <h3 className="font-semibold text-gray-900">
              {matches.length} överföringar mellan ägare
            </h3>
            <p className="text-sm text-gray-500">
              {acceptedCount} valda · totalt {formatCurrency(totalAmount)} nollas ut från kategorisummorna
            </p>
          </div>
        </div>
      </div>
      <div className="divide-y divide-gray-50">
        {matches.map((m) => {
          const checked = acceptedIds.has(m.id)
          return (
            <label
              key={m.id}
              className={`flex items-start gap-3 px-4 py-3 cursor-pointer hover:bg-gray-50 ${
                !checked ? 'opacity-50' : ''
              }`}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => onToggle(m.id)}
                className="mt-1 rounded shrink-0"
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <span className="text-sm font-medium text-gray-800">{formatCurrency(m.amount)}</span>
                  <span className="text-xs text-gray-400">
                    {m.dateA === m.dateB ? m.dateA : `${m.dateA} → ${m.dateB}`}
                  </span>
                  {m.keywordHit && (
                    <Badge variant="blue" size="sm">Swish/namnträff</Badge>
                  )}
                  {m.daysDiff > 0 && !m.keywordHit && (
                    <Badge variant="amber" size="sm">
                      {Math.round(m.daysDiff)} dag{Math.round(m.daysDiff) === 1 ? '' : 'ar'} mellan
                    </Badge>
                  )}
                </div>
                <div className="text-xs text-gray-500 space-y-0.5">
                  <div className="flex items-center gap-1.5">
                    <span className="text-red-500">−</span>
                    <span className="font-medium text-gray-700">{m.ownerA}</span>
                    <span className="text-gray-400">·</span>
                    <span>{m.accountAName}</span>
                    {m.descriptionA && <span className="text-gray-400 truncate">— {m.descriptionA}</span>}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-emerald-600">+</span>
                    <span className="font-medium text-gray-700">{m.ownerB}</span>
                    <span className="text-gray-400">·</span>
                    <span>{m.accountBName}</span>
                    {m.descriptionB && <span className="text-gray-400 truncate">— {m.descriptionB}</span>}
                  </div>
                </div>
              </div>
            </label>
          )
        })}
      </div>
    </Card>
  )
}

// ─── Reconciliation history (upload step) ─────────────────────────────────────

function ReconciliationHistory({
  records,
  onRemove,
}: {
  records: ReconciliationRecord[]
  onRemove: (id: string) => void
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })

  const sorted = [...records].sort((a, b) => (a.importedAt < b.importedAt ? 1 : -1))
  const totalMatches = records.reduce((s, r) => s + r.matches.length, 0)

  return (
    <Card padding={false}>
      <div className="p-4 border-b border-gray-100">
        <h3 className="font-semibold text-gray-900">Tidigare avstämningar</h3>
        <p className="text-sm text-gray-500">
          {records.length} importtillfällen · totalt {totalMatches} matchade överföringar
        </p>
      </div>
      {sorted.map((rec) => {
        const isOpen = expanded.has(rec.id)
        const totalAmount = rec.matches.reduce((s, m) => s + m.amount, 0)
        const date = new Date(rec.importedAt)
        const dateLabel = isNaN(date.getTime())
          ? rec.importedAt
          : date.toLocaleString('sv-SE', { dateStyle: 'short', timeStyle: 'short' })
        return (
          <div key={rec.id} className="border-t border-gray-100">
            <div className="flex items-center gap-3 px-4 py-2.5">
              <button
                className="flex-1 flex items-center justify-between text-left"
                onClick={() => toggle(rec.id)}
              >
                <div className="flex items-center gap-2">
                  {isOpen ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
                  <span className="text-sm font-medium text-gray-800">{dateLabel}</span>
                  <span className="text-xs text-gray-400">
                    {rec.matches.length} {rec.matches.length === 1 ? 'överföring' : 'överföringar'}
                  </span>
                </div>
                <span className="text-sm text-gray-600">{formatCurrency(totalAmount)}</span>
              </button>
              <button
                onClick={() => onRemove(rec.id)}
                className="p-1 text-gray-300 hover:text-red-500 rounded transition-colors"
                title="Ta bort avstämning (transaktioner räknas igen)"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
            {isOpen && (
              <div className="px-4 pb-3 pt-1 space-y-2 bg-gray-50/40">
                {rec.matches.map((m) => (
                  <div key={m.id} className="text-xs text-gray-600 px-2 py-2 bg-white rounded-lg border border-gray-100">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="font-medium text-gray-800">{formatCurrency(m.amount)}</span>
                      <span className="text-gray-400">
                        {m.dateA === m.dateB ? m.dateA : `${m.dateA} → ${m.dateB}`}
                      </span>
                      {m.keywordHit && <Badge variant="blue" size="sm">Swish/namn</Badge>}
                    </div>
                    <div className="text-xs text-gray-500 flex items-center gap-1.5 flex-wrap">
                      <span className="text-red-500">−</span>
                      <span className="font-medium text-gray-700">{m.ownerA}</span>
                      <span className="text-gray-400">→</span>
                      <span className="text-emerald-600">+</span>
                      <span className="font-medium text-gray-700">{m.ownerB}</span>
                      {(m.descriptionA || m.descriptionB) && (
                        <span className="text-gray-400 truncate">
                          — {m.descriptionA || m.descriptionB}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </Card>
  )
}
