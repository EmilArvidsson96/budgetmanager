// ─── AI coach — monthly review card ───────────────────────────────────────────
//
// Sits at the top of Avstämning. When a new salary period has opened and the just-
// closed month has no review yet, it highlights a "Kör månadsöversikt" button (one
// API call, cached afterwards). Renders the saved structured review numbers-first.
// Works offline: with no API key (or on an API error) it produces the deterministic
// template review from the same digest.

import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Sparkles, TrendingUp, PiggyBank, Wallet, Coins, AlertTriangle, Target } from 'lucide-react'
import { useAppStore } from '@/store'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { buildCoachDigest, coachDueMonthId, isCoachReviewable } from '@/utils/coachDigest'
import { generateCoachReview, templateCoachReview, DEFAULT_COACH_MODEL } from '@/utils/coach'
import type { CoachVerdict, CoachReview } from '@/types'

const VERDICT: Record<CoachVerdict, { label: string; badge: 'green' | 'blue' | 'amber' | 'red'; dot: string }> = {
  strong:  { label: 'Stark',  badge: 'green', dot: 'bg-emerald-500' },
  ok:      { label: 'Ok',     badge: 'blue',  dot: 'bg-brand-500' },
  watch:   { label: 'Bevaka', badge: 'amber', dot: 'bg-amber-500' },
  concern: { label: 'Sårbar', badge: 'red',   dot: 'bg-red-500' },
}

function Section({ icon, label, text }: { icon: ReactNode; label: string; text: string }) {
  if (!text.trim()) return null
  return (
    <div className="flex gap-3">
      <div className="text-gray-400 mt-0.5 shrink-0">{icon}</div>
      <div>
        <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">{label}</p>
        <p className="text-sm text-gray-700 leading-relaxed">{text}</p>
      </div>
    </div>
  )
}

export function CoachReviewCard({ monthId }: { monthId: string }) {
  const store = useAppStore()
  const enabled = store.settings.coachEnabled
  const apiKey = store.settings.anthropicApiKey
  const model = store.settings.coachModel ?? DEFAULT_COACH_MODEL

  const review = store.coachReviews[monthId]
  const reviewable = isCoachReviewable(store, monthId)
  const dueMonth = coachDueMonthId(store)
  const isDue = dueMonth === monthId && !review

  const [loading, setLoading] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  // Nothing to do for a month with no imported activity.
  if (!reviewable) return null

  // Feature off — a slim discovery hint (only when a review would otherwise be due).
  if (!enabled) {
    if (!isDue) return null
    return (
      <Card className="border-dashed">
        <div className="flex items-center gap-3">
          <Sparkles className="w-4 h-4 text-brand-500 shrink-0" />
          <p className="text-sm text-gray-600 flex-1">
            AI-coachen kan göra en månadsöversikt vid varje avräkning.{' '}
            <Link to="/installningar" className="text-brand-600 hover:underline">Aktivera i Inställningar.</Link>
          </p>
        </div>
      </Card>
    )
  }

  async function handleGenerate() {
    setLoading(true)
    setNote(null)
    const digest = buildCoachDigest(store, monthId)
    try {
      let result: CoachReview
      if (apiKey) {
        result = await generateCoachReview(digest, apiKey, model)
      } else {
        result = templateCoachReview(digest)
        setNote('Ingen API-nyckel — visar en automatisk översikt. Lägg till din nyckel i Inställningar för Claudes analys.')
      }
      store.saveCoachReview(result)
    } catch {
      // Never leave the user empty-handed: fall back to the deterministic review.
      store.saveCoachReview(templateCoachReview(digest))
      setNote('Kunde inte nå Claude just nu – visar en automatisk översikt istället.')
    } finally {
      setLoading(false)
    }
  }

  // No review yet → the generate CTA (highlighted when it's the due month).
  if (!review) {
    return (
      <Card className={isDue ? 'border-brand-300 bg-brand-50/40' : ''}>
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-xl bg-brand-500 flex items-center justify-center shrink-0 shadow-sm">
            <Sparkles className="w-4 h-4 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-gray-900 text-sm">AI-månadsöversikt</h3>
              {isDue && <Badge variant="blue">Ny översikt väntar</Badge>}
            </div>
            <p className="text-sm text-gray-500 mt-0.5">
              {isDue
                ? 'En ny avräkning har börjat. Kör en kort, sifferdriven genomgång av månaden som stängdes.'
                : 'Kör en kvantitativ genomgång av den här månaden.'}
            </p>
            <div className="mt-3">
              <Button size="sm" onClick={handleGenerate} loading={loading}>
                <Sparkles className="w-4 h-4" /> Kör månadsöversikt
              </Button>
            </div>
            {note && <p className="text-xs text-brand-600 mt-2">{note}</p>}
          </div>
        </div>
      </Card>
    )
  }

  // Saved review.
  const v = VERDICT[review.verdict]
  const generated = new Date(review.generatedAt).toLocaleDateString('sv-SE')
  return (
    <Card padding={false}>
      <div className="px-5 py-4 border-b border-warm-100 flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${v.dot}`} />
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-semibold text-gray-900 text-sm">AI-månadsöversikt</h3>
              <Badge variant={v.badge}>{v.label}</Badge>
              {review.source === 'template' && <Badge variant="gray">automatisk</Badge>}
            </div>
            <p className="text-xs text-gray-400 mt-0.5">
              {review.source === 'ai' ? 'Claude' : 'Regelbaserad'} · {generated}
            </p>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={handleGenerate} loading={loading} title="Kör om översikten">
          <Sparkles className="w-3.5 h-3.5" /> Skriv om
        </Button>
      </div>

      <div className="px-5 py-4 space-y-4">
        {review.headline && (
          <p className="text-sm font-medium text-gray-900 leading-relaxed">{review.headline}</p>
        )}

        <div className="space-y-3.5">
          <Section icon={<PiggyBank className="w-4 h-4" />} label="Realiserat sparande" text={review.savings} />
          <Section icon={<Wallet className="w-4 h-4" />} label="Kassaflöde" text={review.cashflow} />
          <Section icon={<Coins className="w-4 h-4" />} label="Buffert" text={review.buffer} />
          <Section icon={<AlertTriangle className="w-4 h-4" />} label="Avvikelser mot plan" text={review.variances} />
          <Section icon={<TrendingUp className="w-4 h-4" />} label="Likviditet framåt" text={review.lookahead} />
        </div>

        {review.nudge && (
          <div className="flex gap-3 rounded-xl bg-brand-50 border border-brand-100 px-4 py-3">
            <Target className="w-4 h-4 text-brand-600 mt-0.5 shrink-0" />
            <div>
              <p className="text-[11px] font-semibold text-brand-700 uppercase tracking-wide">Månadens nudge</p>
              <p className="text-sm text-gray-800 leading-relaxed">{review.nudge}</p>
            </div>
          </div>
        )}

        {review.throughline && (
          <p className="text-xs text-gray-400 italic leading-relaxed border-t border-warm-100 pt-3">
            {review.throughline}
          </p>
        )}

        {note && <p className="text-xs text-brand-600">{note}</p>}

        <p className="text-[11px] text-gray-300 leading-relaxed">
          Inte licensierad finansiell rådgivning — en analys av dina egna siffror. Prognoser är intervall, inte
          säkerheter; största risken är räntebanan och den realiserade sparkvoten.
        </p>
      </div>
    </Card>
  )
}
