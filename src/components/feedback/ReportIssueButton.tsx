import { useState } from 'react'
import { useLocation } from 'react-router-dom'
import { MessageSquarePlus, Bug, Lightbulb } from 'lucide-react'
import { Dialog } from '../ui/Dialog'
import { APP_VERSION } from '../../version'

// Reports are filed as GitHub issues on the app's own repo — there's no backend
// to store them in, and this avoids embedding any API token in the client bundle.
// The user finishes submitting on GitHub itself, under their own account.
const REPO = 'EmilArvidsson96/budgetmanager'

type ReportKind = 'bug' | 'enhancement'

interface ReportIssueButtonProps {
  /** True once the scroll container is at (or near) its bottom — used to lift the button clear of trailing content. */
  atBottom: boolean
}

export function ReportIssueButton({ atBottom }: ReportIssueButtonProps) {
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState<ReportKind>('bug')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const location = useLocation()

  const canSubmit = title.trim().length > 0 && description.trim().length > 0

  const close = () => {
    setOpen(false)
    setKind('bug')
    setTitle('')
    setDescription('')
  }

  const handleSubmit = () => {
    if (!canSubmit) return

    const context = [
      `**Vy:** \`${location.pathname}\``,
      `**Version:** ${APP_VERSION}`,
      `**Tidpunkt:** ${new Date().toLocaleString('sv-SE')}`,
      `**Skärm:** ${window.innerWidth}×${window.innerHeight}`,
      `**Webbläsare:** ${navigator.userAgent}`,
    ].join('\n')

    const params = new URLSearchParams({
      title: title.trim(),
      body: `${description.trim()}\n\n---\n${context}`,
      labels: `in-app-report,${kind}`,
    })
    window.open(`https://github.com/${REPO}/issues/new?${params.toString()}`, '_blank', 'noopener,noreferrer')
    close()
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
          description="Öppnas som ett förifyllt GitHub-ärende som du skickar in själv."
          onClose={close}
        >
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

            <button
              type="button"
              onClick={handleSubmit}
              disabled={!canSubmit}
              className="w-full py-2.5 rounded-xl bg-brand-500 text-white text-sm font-medium hover:bg-brand-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Öppna i GitHub
            </button>
          </div>
        </Dialog>
      )}
    </>
  )
}
