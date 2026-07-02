// ─── AI financial briefing export ─────────────────────────────────────────────
//
// Produces a single, self-describing Markdown document meant to be handed to an
// AI assistant (Claude via chat / cowork) so it can assess the household economy
// and advise on how much to save where. It is purely derived from stored state —
// no new numbers are invented — and reuses the same engines the app renders from:
//   • current snapshot + forward projection ← buildProjection (projection.ts)
//   • month-by-month actual-vs-planned history ← getMonthlyHistory (history.ts)
//   • the standing monthly plan ← baselineTarget / budgetedAmount (projection.ts)
//
// Design choices (see the conversation that introduced this file):
//   • Markdown, not JSON/Excel — it is the most natural format for an assistant in
//     chat, stays human-auditable, and reads the derived insights (savings rate,
//     runway, trend) as labelled tables + prose rather than spreadsheet cells.
//   • Aggregates only — no raw transaction log, to keep the file compact and the
//     shared surface low-sensitivity.
//   • Sign/savings conventions are stated inline so the assistant never double-
//     counts (expenses negative, loan balances negative, savings = balance delta).

import type { AppState, Account, AccountBalance } from '@/types'
import { getMonthlyHistory, averageOf, type MonthHistoryPoint } from './history'
import {
  buildProjection,
  baselineTarget,
  budgetedAmount,
  currentMonthId,
  classifyAccount,
  type AccountRole,
} from './projection'
import { getSalaryAnchors } from './salaryDetection'
import { formatCurrency, MONTH_NAMES_SHORT } from './budgetHelpers'

const PROJECTION_HORIZON = 36

// ─── Formatting helpers ───────────────────────────────────────────────────────

const kr = (n: number): string => formatCurrency(n)
const krSigned = (n: number): string => formatCurrency(n, true)
const pct = (frac: number): string => `${Math.round(frac * 100)} %`

function stepMonthId(monthId: string, by: number): string {
  let year = parseInt(monthId.slice(0, 4))
  let month = parseInt(monthId.slice(5, 7)) + by
  while (month > 12) { month -= 12; year += 1 }
  while (month < 1) { month += 12; year -= 1 }
  return `${year}-${String(month).padStart(2, '0')}`
}

const ROLE_LABEL: Record<AccountRole, string> = {
  liquid: 'likvid',
  asset: 'tillgång',
  liability: 'skuld',
}

// Compact per-account assumption blurb (return / contribution / loan terms).
function assumptionText(acc: Account, role: AccountRole): string {
  const bits: string[] = []
  if (role === 'liability') {
    if (acc.interestRate) bits.push(`${String(acc.interestRate).replace('.', ',')} %`)
    if (acc.monthlyPayment) bits.push(`amort ${kr(acc.monthlyPayment)}/mån`)
  } else {
    if (acc.expectedReturn) bits.push(`${pct(acc.expectedReturn)}/år`)
    if (acc.monthlyContribution) {
      const flag = acc.contributionIsBudgeted ? ' (i budget)' : ''
      bits.push(`+${kr(acc.monthlyContribution)}/mån${flag}`)
    }
  }
  return bits.length ? bits.join(', ') : '–'
}

// Net worth from a set of imported account balances, respecting includeInNetWorth.
// Loans/credit are stored as negative balances, so this is a plain signed sum.
function netWorthOf(state: AppState, balances: AccountBalance[]): number {
  const excluded = new Set(
    state.settings.accounts.filter((a) => a.includeInNetWorth === false).map((a) => a.id)
  )
  return balances.reduce((s, b) => (excluded.has(b.accountId) ? s : s + b.balance), 0)
}

// ─── Section builders ─────────────────────────────────────────────────────────

function summarySection(
  state: AppState,
  nowNetWorth: number,
  nowLiquidity: number,
  nowLiabilities: number,
  history: MonthHistoryPoint[],
  troughLiquidity: number,
  troughLabel: string
): string[] {
  const last6 = history.slice(-6)
  const avgIncome = averageOf(last6, (p) => p.income.actual)
  const avgExpense = averageOf(last6, (p) => p.expense.actual)
  const avgSavings = averageOf(last6, (p) => (p.savingsKnown ? p.savings.actual : null))
  const avgNet = averageOf(last6, (p) => p.net.actual)
  const savingsRate = avgIncome > 0 ? avgSavings / avgIncome : 0

  // Net-worth change over the imported span (earliest → latest actuals).
  const monthsWithBalances = Object.keys(state.actuals)
    .sort()
    .filter((id) => (state.actuals[id].accountBalances ?? []).length > 0)
  let trendLine = ''
  if (monthsWithBalances.length >= 2) {
    const firstId = monthsWithBalances[0]
    const lastId = monthsWithBalances[monthsWithBalances.length - 1]
    const delta =
      netWorthOf(state, state.actuals[lastId].accountBalances) -
      netWorthOf(state, state.actuals[firstId].accountBalances)
    const span = monthsWithBalances.length
    trendLine = `- **Nettoförmögenhet, förändring** (${labelOf(firstId)}→${labelOf(lastId)}, ${span} mån): ${krSigned(delta)} (${krSigned(delta / Math.max(1, span - 1))}/mån)`
  }

  return [
    '## Sammanfattning',
    `- **Nettoförmögenhet (nu):** ${kr(nowNetWorth)}`,
    trendLine,
    `- **Likviditet (nu):** ${kr(nowLiquidity)} · **skulder:** ${kr(nowLiabilities)}`,
    `- **Snitt senaste 6 mån:** inkomst ${kr(avgIncome)} · utgift ${kr(avgExpense)} · faktiskt sparat ${kr(avgSavings)}/mån · netto ${krSigned(avgNet)}`,
    `- **Sparkvot (6 mån):** ~${pct(savingsRate)} av inkomsten`,
    `- **Lägsta projicerade likviditet (${PROJECTION_HORIZON} mån):** ${kr(troughLiquidity)} (${troughLabel})`,
  ].filter(Boolean)
}

function conventionsSection(state: AppState): string[] {
  const anchored = state.settings.salaryAnchoredMonths
  return [
    '## Konventioner (läs först)',
    '- Alla belopp i SEK. **Utgifter och lånesaldon är negativa**, inkomst positiv.',
    '- **"Sparat" = förändringen i saldo** på spar-/ISK-/investeringskonton (utgående − ingående för månaden), **aldrig** en summa av överföringstransaktioner — pengar slussas via ett spenderkonto först, så transaktioner skulle dubbelräknas.',
    '- **Nettoförmögenhet** = summan av alla kontosaldon (lån räknas redan som negativa).',
    '- "Plan" = den stående månadsbudgeten (baseline) med eventuella avvikelser per månad.',
    `- Budgetperioden börjar ${anchored ? 'när lönen faktiskt landar (lönedatum-ankrad)' : `dag ${state.settings.monthStartDay} i månaden`}.`,
  ]
}

function snapshotSection(
  state: AppState,
  values: Record<string, number>,
  totals: { liquidity: number; assets: number; liabilities: number; netWorth: number },
  asOf: string | undefined
): string[] {
  const lines: string[] = [
    `## Nuläge${asOf ? ` (per senaste import ${asOf})` : ''}`,
    '',
    '| Konto | Typ | Roll | Saldo | Antagande |',
    '|-------|-----|------|------:|-----------|',
  ]
  // Stable order: liquid, asset, liability.
  const order: AccountRole[] = ['liquid', 'asset', 'liability']
  const accts = state.settings.accounts.filter((a) => a.includeInNetWorth !== false)
  for (const role of order) {
    for (const acc of accts.filter((a) => classifyAccount(a) === role)) {
      const v = values[acc.id] ?? acc.manualValue ?? 0
      lines.push(
        `| ${acc.name} | ${acc.type} | ${ROLE_LABEL[role]} | ${kr(v)} | ${assumptionText(acc, role)} |`
      )
    }
  }
  lines.push('')
  lines.push(
    `**Likviditet: ${kr(totals.liquidity)} · Tillgångar: ${kr(totals.assets)} · Skulder: ${kr(totals.liabilities)} · Nettoförmögenhet: ${kr(totals.netWorth)}**`
  )
  return lines
}

function baselineSection(state: AppState): string[] {
  // Far-future month with no overrides reflects the standing "normal month" plan
  // resolved through baseline → legacy yearly/monthly (budgetedAmount), so even a
  // sparse baseline still yields a meaningful plan.
  const farMonth = stepMonthId(currentMonthId(state), 18)
  const planFor = (catId: string): number =>
    baselineTarget(state, catId) ?? budgetedAmount(state, farMonth, catId)

  const cats = state.settings.categories
  const rows: string[] = []
  let income = 0
  let expense = 0
  let savings = 0
  for (const cat of cats) {
    if (cat.type === 'transfer') continue
    const amt = planFor(cat.id)
    if (amt === 0) continue
    rows.push(`| ${cat.name} | ${cat.type} | ${krSigned(amt)} |`)
    if (cat.type === 'income') income += amt
    else if (cat.type === 'savings') savings += Math.abs(amt)
    else expense += Math.abs(amt)
  }
  const surplus = income - expense - savings

  return [
    '## Budgetbas (normalmånad)',
    `Planerad inkomst ${kr(income)} · planerade utgifter ${kr(-expense)}${savings ? ` · planerat sparande ${kr(-savings)}` : ''} · **planerat överskott ${krSigned(surplus)}/mån**`,
    '',
    '| Kategori | Typ | Mål/mån |',
    '|----------|-----|--------:|',
    ...rows,
  ]
}

function historySection(state: AppState, history: MonthHistoryPoint[]): string[] {
  if (history.length === 0) {
    return ['## Historik — utfall mot plan', '', '_Ingen importerad historik ännu._']
  }

  const shown = history.slice(-18)
  const rows = shown.map((p) => {
    const savingsCell = p.savingsKnown ? krSigned(p.savings.actual) : '–'
    return `| ${p.label} | ${kr(p.income.actual)} | ${kr(-p.expense.actual)} | ${savingsCell} | ${krSigned(p.net.actual)} | ${krSigned(p.net.planned)} |`
  })

  // Averages over trailing windows.
  const avgRow = (n: number): string => {
    const w = history.slice(-n)
    if (w.length === 0) return ''
    const inc = averageOf(w, (p) => p.income.actual)
    const exp = averageOf(w, (p) => p.expense.actual)
    const sav = averageOf(w, (p) => (p.savingsKnown ? p.savings.actual : null))
    const rate = inc > 0 ? ` · sparkvot ~${pct(sav / inc)}` : ''
    return `- **${n} mån:** inkomst ${kr(inc)} · utgift ${kr(-exp)} · sparat ${krSigned(sav)}/mån${rate}`
  }

  // Per-category expense averages over the last 6 months (where data exists).
  const last6 = history.slice(-6)
  const expenseCats = state.settings.categories.filter((c) => c.type === 'expense')
  const catAvgs = expenseCats
    .map((c) => ({
      name: c.name,
      avg: averageOf(last6, (p) => p.byCat[c.id]?.actual ?? 0),
      plan: averageOf(last6, (p) => p.byCat[c.id]?.planned ?? 0),
    }))
    .filter((c) => c.avg > 0)
    .sort((a, b) => b.avg - a.avg)

  const catLines = catAvgs.length
    ? [
        '',
        '### Utgifter per kategori — snitt senaste 6 mån',
        '',
        '| Kategori | Snitt utfall/mån | Snitt plan/mån |',
        '|----------|-----------------:|---------------:|',
        ...catAvgs.map((c) => `| ${c.name} | ${kr(c.avg)} | ${kr(c.plan)} |`),
      ]
    : []

  return [
    '## Historik — utfall mot plan',
    `Visar de senaste ${shown.length} av ${history.length} importerade månaderna.`,
    '',
    '| Mån | Inkomst | Utgift | Sparat (saldoΔ) | Netto | Plan netto |',
    '|-----|--------:|-------:|----------------:|------:|-----------:|',
    ...rows,
    '',
    '**Snitt:**',
    avgRow(3),
    avgRow(6),
    avgRow(12),
    ...catLines,
  ].filter(Boolean)
}

function projectionSection(
  months: { monthId: string; label: string; liquidity: number; netWorth: number; netCashflow: number }[]
): string[] {
  // Every 6th future month, plus the final month if not already on the grid.
  const future = months.slice(1)
  const picks = new Set<number>()
  for (let i = 5; i < future.length; i += 6) picks.add(i)
  if (future.length > 0) picks.add(future.length - 1)

  const rows = [...picks]
    .sort((a, b) => a - b)
    .map((i) => {
      const m = future[i]
      return `| ${m.label} (+${i + 1}) | ${kr(m.liquidity)} | ${kr(m.netWorth)} | ${krSigned(m.netCashflow)} |`
    })

  return [
    `## Projektion (${PROJECTION_HORIZON} mån, nuvarande antaganden)`,
    '_Drivs av budgetbasen som prognos + kontoantaganden (avkastning, insättningar, amortering). Sparande modelleras via kontoinsättningar, inte budgetens sparkategorier._',
    '',
    '| Mån | Likviditet | Nettoförmögenhet | Netto-kassaflöde |',
    '|-----|-----------:|-----------------:|-----------------:|',
    ...rows,
  ]
}

function openItemsSection(state: AppState, todayIso: string): string[] {
  const lines: string[] = ['## Öppna poster & kontext']

  // Future-dated one-off liquidity entries.
  const oneOffs = Object.values(state.liquidityPlans)
    .flatMap((p) => p.entries)
    .filter((e) => e.date && e.date >= todayIso)
    .sort((a, b) => a.date.localeCompare(b.date))
  if (oneOffs.length) {
    lines.push('', '**Planerade engångsposter (framåt):**')
    for (const e of oneOffs.slice(0, 30)) {
      const excluded = e.includeInProjection === false ? ' (ingår ej i likviditetsprognosen)' : ''
      lines.push(`- ${e.date}: ${e.description || '(utan beskrivning)'} ${krSigned(e.amount)}${excluded}`)
    }
  }

  // Recurring items.
  if (state.settings.recurringItems.length) {
    lines.push('', '**Återkommande poster:**')
    for (const r of state.settings.recurringItems) {
      const signed = r.type === 'income' ? Math.abs(r.amount) : -Math.abs(r.amount)
      lines.push(`- ${r.name}: ${krSigned(signed)}/mån`)
    }
  }

  // Months flagged as missing a detected salary (only when anchoring is on).
  const { flaggedMonths } = getSalaryAnchors(state)
  if (flaggedMonths.length) {
    lines.push(
      '',
      `**Månader utan upptäckt lön** (föll tillbaka på nominell lönedag): ${flaggedMonths.map(labelOf).join(', ')}`
    )
  }

  return lines.length > 1 ? lines : []
}

function questionsSection(): string[] {
  return [
    '## Frågor till assistenten',
    'Exempel på vad jag vill ha hjälp med — utgå från siffrorna ovan:',
    '- Hur ser min ekonomiska situation ut just nu? Vad är starkt respektive sårbart?',
    '- Givet bufferten och överskottet — hur bör jag fördela månadssparandet mellan buffert, ISK och amortering?',
    '- Är min likviditet trygg över de kommande månaderna, eller finns det en svacka att planera för?',
    '- Var avviker mitt faktiska utfall mest från planen, och vad bör jag justera?',
  ]
}

function labelOf(monthId: string): string {
  const month = parseInt(monthId.slice(5, 7))
  return `${MONTH_NAMES_SHORT[month - 1]} ${monthId.slice(2, 4)}`
}

// ─── Main builder ─────────────────────────────────────────────────────────────

export function buildAiBriefing(state: AppState): string {
  const today = new Date()
  const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`

  const startMonthId = currentMonthId(state)
  const projection = buildProjection({ state, startMonthId, horizon: PROJECTION_HORIZON })
  const now = projection.months[0]

  // Latest import date, for the "as of" label.
  const latestImport =
    state.importSnapshots.length > 0
      ? state.importSnapshots.reduce((a, b) => (a.importedAt > b.importedAt ? a : b)).importedAt.slice(0, 10)
      : undefined

  const history = getMonthlyHistory(state)

  // Liquidity trough over the horizon (skip the "now" anchor).
  const future = projection.months.slice(1)
  const trough = future.reduce((lo, m) => (m.liquidity < lo.liquidity ? m : lo), future[0] ?? now)

  const greeting = state.lastZlantarImport?.data?.user?.first_name
  const title = greeting ? `# Ekonomisk översikt — ${greeting}` : '# Ekonomisk översikt'

  const sections: string[][] = [
    [
      title,
      `_Exporterad ${todayIso} · Budgethanteraren · SEK_`,
    ],
    summarySection(state, now.netWorth, now.liquidity, now.totalLiabilities, history, trough.liquidity, trough.label),
    conventionsSection(state),
    snapshotSection(
      state,
      now.values,
      { liquidity: now.liquidity, assets: now.totalAssets, liabilities: now.totalLiabilities, netWorth: now.netWorth },
      latestImport
    ),
    baselineSection(state),
    historySection(state, history),
    projectionSection(projection.months),
    openItemsSection(state, todayIso),
    questionsSection(),
  ]

  return sections
    .filter((s) => s.length > 0)
    .map((s) => s.join('\n'))
    .join('\n\n')
    .concat('\n')
}
