// ─── AI coach — on-request chat ───────────────────────────────────────────────
//
// A collapsible "Fråga coachen" panel under the monthly review. Grounded in the
// same digest + doctrine (so answers stay consistent with the review), it handles
// the deeper, on-request questions — including the multi-scenario leverage/spread
// analysis for the future-house decision. Messages are ephemeral (not persisted);
// the digest is rebuilt fresh on each send. Needs an API key — there is no offline
// answer for free-form questions.

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Sparkles } from 'lucide-react'
import { useAppStore } from '@/store'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { buildCoachDigest, isCoachReviewable } from '@/utils/coachDigest'
import { coachChat, DEFAULT_COACH_MODEL, type CoachChatMessage } from '@/utils/coach'

const SUGGESTIONS = [
  'Bör vi amortera extra eller köpa ISK med överskottet?',
  'Hur mycket hus har vi råd med om 3–5 år vid 75 % vs 90 % belåning?',
  'Är bufferten och likviditeten trygg de kommande månaderna?',
  'Var läcker sparkvoten mest, och vad ger störst effekt att ändra?',
]

export function CoachChat({ monthId }: { monthId: string }) {
  const store = useAppStore()
  const enabled = store.settings.coachEnabled
  const apiKey = store.settings.anthropicApiKey
  const model = store.settings.coachModel ?? DEFAULT_COACH_MODEL

  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<CoachChatMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!enabled || !isCoachReviewable(store, monthId)) return null

  async function send(question: string) {
    const q = question.trim()
    if (!q || loading || !apiKey) return
    setError(null)
    setInput('')
    const next: CoachChatMessage[] = [...messages, { role: 'user', content: q }]
    setMessages(next)
    setLoading(true)
    try {
      const digest = buildCoachDigest(store, monthId)
      const reply = await coachChat(digest, next, apiKey, model)
      setMessages([...next, { role: 'assistant', content: reply }])
    } catch {
      setError('Kunde inte nå Claude just nu. Försök igen om en stund.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card padding={false}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2.5 px-5 py-3.5 text-left"
      >
        <Sparkles className="w-4 h-4 text-brand-500 shrink-0" />
        <span className="font-semibold text-gray-900 text-sm flex-1">Fråga coachen</span>
        <span className="text-xs text-gray-400">{open ? 'Dölj' : 'Öppna'}</span>
      </button>

      {open && (
        <div className="px-5 pb-5 border-t border-warm-100 pt-4 space-y-4">
          {!apiKey && (
            <p className="text-sm text-gray-500">
              Chatten kräver en Anthropic-nyckel.{' '}
              <Link to="/installningar" className="text-brand-600 hover:underline">Lägg till i Inställningar.</Link>
            </p>
          )}

          {messages.length > 0 && (
            <div className="space-y-3 max-h-96 overflow-y-auto">
              {messages.map((m, i) => (
                <div key={i} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                  <div
                    className={`max-w-[85%] rounded-xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
                      m.role === 'user'
                        ? 'bg-brand-500 text-white'
                        : 'bg-warm-100 text-gray-800 border border-warm-200'
                    }`}
                  >
                    {m.content}
                  </div>
                </div>
              ))}
              {loading && <p className="text-xs text-gray-400">Coachen tänker…</p>}
            </div>
          )}

          {messages.length === 0 && apiKey && (
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => send(s)}
                  disabled={loading}
                  className="text-xs text-left text-gray-600 bg-warm-100 hover:bg-warm-200 border border-warm-200 rounded-lg px-3 py-2 transition-colors disabled:opacity-50"
                >
                  {s}
                </button>
              ))}
            </div>
          )}

          {error && <p className="text-xs text-brand-600">{error}</p>}

          <div className="flex items-end gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input) }
              }}
              rows={2}
              disabled={!apiKey || loading}
              placeholder="Ställ en fråga om er ekonomi…"
              className="flex-1 border border-warm-300 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-brand-400 disabled:bg-warm-50"
            />
            <Button size="md" onClick={() => send(input)} loading={loading} disabled={!apiKey || !input.trim()}>
              Skicka
            </Button>
          </div>
        </div>
      )}
    </Card>
  )
}
