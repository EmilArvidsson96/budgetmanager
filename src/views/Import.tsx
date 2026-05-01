import { useState, useRef } from 'react'
import { Upload, CheckCircle, AlertTriangle, Info } from 'lucide-react'
import { useAppStore } from '@/store'
import { Layout, PageHeader } from '@/components/layout/Layout'
import { Card, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { parseZlantarFiles, buildMonthlyActuals, deriveAccounts, deriveRecurringItems, findUnknownCategories } from '@/utils/zlantarParser'
import { formatCurrency } from '@/utils/budgetHelpers'
import type { RecurringItem } from '@/types'

type Step = 'upload' | 'preview' | 'done'

export function ImportView() {
  const [step, setStep] = useState<Step>('upload')
  const [dataFile, setDataFile] = useState<File | null>(null)
  const [txFile, setTxFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<ReturnType<typeof buildMonthlyActuals> | null>(null)
  const [unknownCats, setUnknownCats] = useState<ReturnType<typeof findUnknownCategories>>([])
  const [newAccounts, setNewAccounts] = useState<ReturnType<typeof deriveAccounts>>([])
  const [newRecurring, setNewRecurring] = useState<RecurringItem[]>([])
  const [importRecurring, setImportRecurring] = useState(true)
  const [importing, setImporting] = useState(false)
  const dataRef = useRef<HTMLInputElement>(null)
  const txRef = useRef<HTMLInputElement>(null)

  const store = useAppStore()

  const parseFiles = async () => {
    if (!txFile) return
    setImporting(true)
    try {
      let dataJson: unknown = {}
      if (dataFile) {
        const text = await dataFile.text()
        dataJson = JSON.parse(text)
      }
      const txText = await txFile.text()
      const txJson = JSON.parse(txText)

      const imp = parseZlantarFiles(dataJson, txJson)
      const actuals = buildMonthlyActuals(imp, store.settings.categories)
      const unknown = findUnknownCategories(imp.transactions, store.settings.categories)
      const accounts = deriveAccounts(imp.data)
      const recurring = deriveRecurringItems(imp.data)

      const existingAccountIds = new Set(store.settings.accounts.map((a) => a.id))
      const existingRecurringIds = new Set(store.settings.recurringItems.map((r) => r.id))
      const newAccs = accounts.filter((a) => !existingAccountIds.has(a.id))
      const newRec = recurring.filter((r) => !existingRecurringIds.has(r.id))

      store.setZlantarImport(imp)
      setPreview(actuals)
      setUnknownCats(unknown)
      setNewAccounts(newAccs)
      setNewRecurring(newRec)
      setStep('preview')
    } catch (err) {
      alert(`Fel vid inläsning: ${(err as Error).message}`)
    } finally {
      setImporting(false)
    }
  }

  const confirmImport = () => {
    if (!preview) return
    for (const actuals of Object.values(preview)) {
      store.upsertActuals(actuals)
    }
    for (const acc of newAccounts) {
      store.upsertAccount(acc)
    }
    if (importRecurring) {
      for (const rec of newRecurring) {
        store.upsertRecurring(rec)
      }
    }
    setStep('done')
  }

  const reset = () => {
    setStep('upload')
    setDataFile(null)
    setTxFile(null)
    setPreview(null)
    setUnknownCats([])
    setNewAccounts([])
    setNewRecurring([])
  }

  const months = preview ? Object.keys(preview).sort() : []

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
                Du behöver <strong>transactions.json</strong> (krävs) och <strong>data.json</strong> (valfritt, för kontoinformation).
                Båda finns i ZIP-filen från Zlantar.
              </p>
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              <FileDropZone
                label="transactions.json"
                description="Transaktionsdata (krävs)"
                required
                file={txFile}
                accept=".json"
                inputRef={txRef}
                onFile={setTxFile}
              />
              <FileDropZone
                label="data.json"
                description="Kontoinformation (valfritt)"
                file={dataFile}
                accept=".json"
                inputRef={dataRef}
                onFile={setDataFile}
              />
            </div>
          </Card>

          <div className="flex justify-end">
            <Button onClick={parseFiles} disabled={!txFile} loading={importing}>
              Granska import
            </Button>
          </div>
        </div>
      )}

      {/* Step 2: Preview */}
      {step === 'preview' && preview && (
        <div className="space-y-4">
          {/* Unknown categories warning */}
          {unknownCats.length > 0 && (
            <Card>
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-500 mt-0.5 shrink-0" />
                <div>
                  <h3 className="font-semibold text-gray-800 mb-1">
                    {unknownCats.length} okända kategorier
                  </h3>
                  <p className="text-sm text-gray-500 mb-3">
                    Följande kategorier från Zlantar matchade inte exakt mot dina inställningar.
                    De importeras under närmast matchande kategori, eller "Övrigt".
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {unknownCats.slice(0, 15).map((c) => (
                      <span key={`${c.rawCategory}|${c.rawSubcategory}`}
                        className="text-xs bg-amber-50 border border-amber-200 text-amber-800 rounded-full px-2.5 py-1">
                        {c.rawCategory}{c.rawSubcategory ? ` / ${c.rawSubcategory}` : ''} ({c.count} st)
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </Card>
          )}

          {/* New accounts */}
          {newAccounts.length > 0 && (
            <Card>
              <CardHeader title={`${newAccounts.length} nya konton hittades`} subtitle="Dessa läggs till i dina kontoinställningar" />
              <div className="space-y-2">
                {newAccounts.map((a) => (
                  <div key={a.id} className="flex items-center justify-between p-2 bg-gray-50 rounded-lg">
                    <div>
                      <span className="text-sm font-medium text-gray-800">{a.name}</span>
                      {a.bankName && <span className="text-xs text-gray-400 ml-2">{a.bankName}</span>}
                    </div>
                    <Badge variant={a.type === 'loan' ? 'red' : a.type === 'savings' || a.type === 'isk' ? 'blue' : 'gray'}>
                      {a.type}
                    </Badge>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Recurring items from agreements */}
          {newRecurring.length > 0 && (
            <Card>
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h3 className="font-semibold text-gray-900">{newRecurring.length} återkommande poster från Zlantar</h3>
                  <p className="text-sm text-gray-500">Hittades i dina avtal och prenumerationer</p>
                </div>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={importRecurring}
                    onChange={(e) => setImportRecurring(e.target.checked)}
                    className="rounded"
                  />
                  Importera
                </label>
              </div>
              <div className="space-y-1.5">
                {newRecurring.map((r) => (
                  <div key={r.id} className="flex items-center justify-between p-2 bg-gray-50 rounded-lg">
                    <span className="text-sm text-gray-800">{r.name}</span>
                    <span className="text-sm font-medium text-gray-700">{r.amount.toLocaleString('sv-SE')} kr/mån</span>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Month summaries */}
          <Card padding={false}>
            <div className="p-5 border-b border-gray-100">
              <h3 className="font-semibold text-gray-900">Månadsutfall som importeras</h3>
              <p className="text-sm text-gray-500">{months.length} månader med transaktionsdata</p>
            </div>

            {months.map((ym) => {
              const act = preview[ym]
              const total = act.entries.reduce((s, e) => s + e.totalAmount, 0)
              const catCount = new Set(act.entries.map((e) => e.categoryId)).size
              return (
                <div key={ym} className="flex items-center justify-between px-5 py-3 border-t border-gray-100">
                  <div>
                    <span className="font-medium text-gray-800">{ym}</span>
                    <span className="text-sm text-gray-400 ml-3">{act.entries.length} poster · {catCount} kategorier</span>
                  </div>
                  <span className="font-medium text-gray-700">{formatCurrency(total)}</span>
                </div>
              )
            })}
          </Card>

          <div className="flex justify-between">
            <Button variant="secondary" onClick={reset}>Börja om</Button>
            <Button onClick={confirmImport}>
              <CheckCircle className="w-4 h-4" /> Bekräfta import
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
            {months.length} månader med utfallsdata har importerats.
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
