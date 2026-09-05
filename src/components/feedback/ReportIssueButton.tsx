import { useState } from 'react'
import { useLocation } from 'react-router-dom'
import { MessageSquarePlus, Bug, Lightbulb, Check, CircleAlert } from 'lucide-react'
import { Dialog } from '../ui/Dialog'
import { APP_VERSION } from '../../version'
import { useAppStore } from '@/store'
import { extractAppStateForSync } from '@/utils/githubSync'

// Reports are posted to a small Cloudflare Worker (see worker/), which files
// them as GitHub issues on the private budgetmanager_data repo. The app itself
// has no backend, so the Worker is what lets a stranger without a GitHub
// account submit a report, on mobile, without ever leaving the app — and
// what keeps the GitHub token (needed to create the issue) off the client.
// Reports go to the PRIVATE data repo, not the public app repo, because they
// carry a full app-state snapshot that can include real financial data.
const REPORT_ENDPOINT = 'https://budgetmanager-report.emil-arvidsson.workers.dev'

// GitHub issue bodies cap out at 65536 characters total, and the raw store
// (years of imported transactions) can run into megabytes — sending it whole
// would mean shipping most of it over mobile data just to have it discarded
// server-side. Large arrays/maps (allTransactions, transactionOverrides, …)
// are collapsed to a count plus a small recent sample instead: still enough
// to say "how much data, and what did the last bit of it look like" without
// the entire history riding along.
const MAX_COLLECTION_ITEMS = 25
const SAMPLE_SIZE = 10
const MAX_APP_STATE_CHARS = 55_000

function summarizeForReport(state: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(state)) {
    if (Array.isArray(value) && value.length > MAX_COLLECTION_ITEMS) {
      out[key] = { _count: value.length, _recentSample: value.slice(-SAMPLE_SIZE) }
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      const entries = Object.entries(value as Record<string, unknown>)
      out[key] = entries.length > MAX_COLLECTION_ITEMS
        ? { _count: entries.length, _recentSample: Object.fromEntries(entries.slice(-SAMPLE_SIZE)) }
        : value
    } else {
      out[key] = value
    }
  }
  return out
}

function truncateJson(value: unknown, maxChars: number): string {
  const text = JSON.stringify(value)
  return text.length > maxChars ? `${text.slice(0, maxChars)}…[trunkerad]` : text
}

type ReportKind = 'bug' | 'enhancement'
type SubmitState = 'idle' | 'sending' | 'sent' | 'error'

interface ReportIssueButtonProps {
  /** True once the scroll container is at (or near) its bottom — used to lift the button clear of trailing content. */
  atBottom: boolean
}

export function ReportIssueButton({ atBottom }: ReportIssueButtonProps) {
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState<ReportKind>('bug')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [submitState, setSubmitState] = useState<SubmitState>('idle')
  const [errorMessage, setErrorMessage] = useState('')
  const location = useLocation()

  const canSubmit = title.trim().length > 0 && description.trim().length > 0 && submitState !== 'sending'

  const close = () => {
    setOpen(false)
    setKind('bug')
    setTitle('')
    setDescription('')
    setSubmitState('idle')
    setErrorMessage('')
  }

  const handleSubmit = async () => {
    if (!canSubmit) return
    setSubmitState('sending')
    setErrorMessage('')

    const context = {
      route: location.pathname,
      appVersion: APP_VERSION,
      timestamp: new Date().toISOString(),
      viewport: `${window.innerWidth}x${window.innerHeight}`,
      userAgent: navigator.userAgent,
    }
    const rawState = extractAppStateForSync(useAppStore.getState() as unknown as Record<string, unknown>)
    const appState = truncateJson(summarizeForReport(rawState), MAX_APP_STATE_CHARS)

    try {
      const res = await fetch(REPORT_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, title: title.trim(), description: description.trim(), context, appState }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}) as { error?: string })
        throw new Error(body.error ?? `Servern svarade ${res.status}`)
      }
      setSubmitState('sent')
    } catch (err) {
      setSubmitState('error')
      setErrorMessage(err instanceof Error ? err.message : 'Något gick fel')
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Rapportera bugg eller idé"
        title="Rapportera bugg eller idé"
        className={`fixed right-4 bottom-20 md:right-6 md:bottom-6 z-40 flex items-center justify-center
          w-12 h-12 rounded-full bg-brand-500 text-white shadow-lg shadow-brand-900/20
          hover:bg-brand-600 active:scale-95 transition-all duration-300 ease-out
          ${atBottom ? '-translate-y-16' : 'translate-y-0'}`}
      >
        <MessageSquarePlus className="w-5 h-5" />
      </button>

      {open && (
        <Dialog
          title="Rapportera bugg eller idé"
          description={
            submitState === 'sent'
              ? undefined
              : 'Skickas direkt — du lämnar inte appen. Skärmens innehåll och appens data skickas med som felsökningsunderlag.'
          }
          onClose={close}
        >
          {submitState === 'sent' ? (
            <div className="flex flex-col items-center text-center gap-3 py-2">
              <div className="w-10 h-10 rounded-full bg-emerald-50 flex items-center justify-center">
                <Check className="w-5 h-5 text-emerald-600" />
              </div>
              <p className="text-sm text-gray-600">Tack! Rapporten är skickad.</p>
              <button
                type="button"
                onClick={close}
                className="mt-1 px-4 py-2 rounded-xl bg-brand-500 text-white text-sm font-medium hover:bg-brand-600 transition-colors"
              >
                Stäng
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setKind('bug')}
                  className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-xl border text-sm font-medium transition-colors
                    ${kind === 'bug'
                      ? 'border-red-300 bg-red-50 text-red-700'
                      : 'border-gray-200 text-gray-500 hover:bg-gray-50'}`}
                >
                  <Bug className="w-4 h-4" /> Bugg
                </button>
                <button
                  type="button"
                  onClick={() => setKind('enhancement')}
                  className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-xl border text-sm font-medium transition-colors
                    ${kind === 'enhancement'
                      ? 'border-brand-300 bg-brand-50 text-brand-700'
                      : 'border-gray-200 text-gray-500 hover:bg-gray-50'}`}
                >
                  <Lightbulb className="w-4 h-4" /> Idé
                </button>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Rubrik</label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={kind === 'bug' ? 'T.ex. Saldot uppdateras inte efter import' : 'T.ex. Filtrera transaktioner på konto'}
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Beskrivning</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={4}
                  placeholder="Vad hände, eller vad vill du kunna göra?"
                  className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300 resize-none"
                />
              </div>

              {submitState === 'error' && (
                <div className="flex items-start gap-2 px-3 py-2 rounded-xl bg-red-50 text-red-700 text-xs">
                  <CircleAlert className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>Kunde inte skicka: {errorMessage}. Försök igen.</span>
                </div>
              )}

              <button
                type="button"
                onClick={handleSubmit}
                disabled={!canSubmit}
                className="w-full py-2.5 rounded-xl bg-brand-500 text-white text-sm font-medium hover:bg-brand-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {submitState === 'sending' ? 'Skickar…' : 'Skicka rapport'}
              </button>
            </div>
          )}
        </Dialog>
      )}
    </>
  )
}
