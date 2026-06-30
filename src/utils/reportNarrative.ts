// ─── Report summary line ──────────────────────────────────────────────────────
//
// A short, warm Swedish summary of the month for someone who wants to be informed
// but won't read much. Two sources:
//   • generateReportSummary() — asks Sonnet to write 1–3 sentences from the
//     month's AGGREGATES (no raw transactions ever leave the device);
//   • templateSummary() — a deterministic fallback used when no API key is set,
//     the call fails, or the user prefers offline.
// Reuses the same browser-side Anthropic client pattern as the receipt parser.

import Anthropic from '@anthropic-ai/sdk'
import type { MonthlyReport } from './report'
import { formatCurrency } from './budgetHelpers'

// Sonnet specifically — the brief asked for warm, natural writing over speed/cost.
export const REPORT_MODEL = 'claude-sonnet-4-6'

const SYSTEM_PROMPT = `Du skriver en kort, varm sammanfattning på svenska av ett pars privatekonomi för en månad. Mottagaren är inte särskilt intresserad av ekonomi men vill veta läget på 5 sekunder.

Regler:
- 1–3 korta meningar, max ca 45 ord totalt.
- Ledig, vänlig och konkret ton. Skriv "ni" (paret), aldrig "du".
- Lyft det viktigaste: gick månaden plus eller minus, sparande, och om utgifterna var högre/lägre än vanligt.
- Var ärlig men aldrig dömande eller oroande. Hitta det positiva när det går.
- Använd inga emojis och inga symboler – endast vanlig text.
- Inga rubriker, inga punktlistor, ingen inledning som "Här är". Bara själva sammanfattningen.`

interface Aggregates {
  månad: string
  inkomst: number
  utgifter: number
  utgifter_snitt: number | null
  sparande: number | null
  sparkvot_procent: number | null
  resultat: number
  största_kategori: string | null
  största_kategori_belopp: number | null
  förmögenhet: number | null
  förmögenhet_förändring: number | null
}

function aggregatesFor(report: MonthlyReport): Aggregates {
  return {
    månad: report.title,
    inkomst: Math.round(report.income.actual),
    utgifter: Math.round(report.expense.actual),
    utgifter_snitt: report.expense.avg !== undefined ? Math.round(report.expense.avg) : null,
    sparande: report.savings.known ? Math.round(report.savings.actual) : null,
    sparkvot_procent: report.income.actual > 0 && report.savings.known
      ? Math.round(report.savingsRate * 100)
      : null,
    resultat: Math.round(report.net.actual),
    största_kategori: report.categories[0]?.name ?? null,
    största_kategori_belopp: report.categories[0] ? Math.round(report.categories[0].amount) : null,
    förmögenhet: report.netWorth ? Math.round(report.netWorth.value) : null,
    förmögenhet_förändring:
      report.netWorth && report.netWorth.prev !== undefined
        ? Math.round(report.netWorth.value - report.netWorth.prev)
        : null,
  }
}

export async function generateReportSummary(
  report: MonthlyReport,
  apiKey: string,
  model: string = REPORT_MODEL
): Promise<string> {
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true })
  const data = aggregatesFor(report)

  const response = await client.messages.create({
    model,
    max_tokens: 300,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: `Skriv månadens sammanfattning utifrån dessa siffror (alla i kronor om inget annat anges):\n\n${JSON.stringify(data, null, 2)}`,
      },
    ],
  })

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim()

  return text || templateSummary(report)
}

// Deterministic, offline fallback — still warm, just rule-based.
export function templateSummary(report: MonthlyReport): string {
  const parts: string[] = []

  if (report.net.actual >= 0) {
    parts.push(`Fin månad – ni gick plus med ${formatCurrency(report.net.actual)}.`)
  } else {
    parts.push(`Lite tajtare månad – ni gick back ${formatCurrency(Math.abs(report.net.actual))}.`)
  }

  if (report.savings.known) {
    if (report.savings.actual >= 0) {
      const rate = report.income.actual > 0 ? ` (${Math.round(report.savingsRate * 100)}% av inkomsten)` : ''
      parts.push(`Ni la undan ${formatCurrency(report.savings.actual)}${rate}.`)
    } else {
      parts.push(`Ni använde ${formatCurrency(Math.abs(report.savings.actual))} av sparbufferten.`)
    }
  }

  if (report.expense.avg && report.expense.avg > 0) {
    const diff = report.expense.actual - report.expense.avg
    if (diff <= -0.05 * report.expense.avg) {
      parts.push(`Utgifterna var ${formatCurrency(Math.abs(diff))} lägre än vanligt.`)
    } else if (diff >= 0.05 * report.expense.avg) {
      parts.push(`Utgifterna var ${formatCurrency(diff)} högre än vanligt.`)
    }
  }

  return parts.slice(0, 3).join(' ')
}
