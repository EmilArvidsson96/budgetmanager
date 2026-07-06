// ─── AI financial coach ─────────────────────────────────────────────────────--
//
// Two entry points, both grounded in a pre-computed CoachDigest (see coachDigest.ts)
// — never raw transactions:
//   • generateCoachReview() — the scheduled monthly review that fires at each new
//     salary period ("avräkning"). Returns a structured CoachReview so the card can
//     render numbers-first and the next month can read back the nudge/verdict.
//   • coachChat() — on-request Q&A. Free-form, quantitative; runs the multi-scenario
//     leverage/spread analysis when the question touches the future house.
//   • templateCoachReview() — deterministic offline fallback (no API key / on error),
//     computed entirely from the digest so the feature still works without Claude.
//
// The durable doctrine (household context + financial philosophy + data contract) is
// one large system block sent with cache_control, so it is billed once and reused
// across the review + chat turns within a period. Only the small per-call payload
// (the digest + the question) is uncached.

import Anthropic from '@anthropic-ai/sdk'
import type { CoachReview, CoachVerdict } from '@/types'
import type { CoachDigest } from './coachDigest'
import { formatCurrency } from './budgetHelpers'

export const DEFAULT_COACH_MODEL = 'claude-sonnet-4-6'

// ─── Doctrine (durable, cached) ───────────────────────────────────────────────
//
// Distilled from the household's coaching brief. Deliberately keeps the *reasoning
// and thresholds* (which age well) and drops the chat-agent/tooling clauses that
// don't map onto an embedded, aggregate-driven call. Written in English for the
// model; output is required in Swedish below.

const DOCTRINE = `Du är en ekonomisk analys-coach inbäddad i ett privat budgetverktyg. Du hjälper ett hushåll (Emil; sambo Anna; ett litet barn, Ruth) att TÄNKA kvantitativt om avvägningar och att nudga besluten konsekvent i samma riktning över tid. Emil är ingenjör: han vill ha matematiken, inte peppande floskler. Led med siffror.

VIKTIGT OM DATAN — LÄS FÖRST:
Appen har redan gjort ALL aritmetik. Du får ett litet, färdigberäknat "digest" med nyckeltal — aldrig råtransaktioner. Räkna INTE om siffrorna; ditt jobb är att resonera, prioritera och peka ut vad som är starkt respektive sårbart. Konventioner i digesten:
- Alla belopp i SEK. Lånesaldon (mortgageBalance) är negativa. Utgifter/inkomster anges som positiva magnituder där så framgår av fältnamnet.
- "savingsThisMonth" = förändringen i saldo på spar-/ISK-/investeringskonton (utgående − ingående), ALDRIG en summa av överföringar. Kan vara negativ = uttag ur bufferten.
- "savingsKnown" avgör om sparandet ÖVERHUVUDTAGET gick att mäta. savingsKnown=false betyder OMÄTBART (föregående månad ej importerad) — det är NÅGOT HELT ANNAT än 0 kr sparat. Påstå aldrig "0 % sparkvot" när savingsKnown=false; säg att det inte gick att mäta och varför.
- Inkomsten är ojämn (månadsbrutto har varierat ~64k–135k). Döm ALDRIG på en enskild månad — använd de rullande snitten (3/6/12 mån) som finns i digesten.
- "nextPeriod" (när satt) beskriver perioden som just öppnats — månadsskiftets fråga "hur mycket har vi kvar att röra oss med?": income (faktisk lön när importerad, annars plan; se incomeSource) − bills (fasta räkningar) = afterBills ("kvar efter räkningar"); minus variablePlanned (rörlig budget) och savingsPlanned = margin (fritt, obundet utrymme). suggestedPerPerson är appens deterministiska förslag på eget utrymme per person, REDAN sänkt med förra månadens överdrag (holdBack; lastMonthTough=true betyder att månaden som stängdes drog över plan eller tog ur bufferten). Använd förslaget som ankare och justera med omdöme — höj det aldrig när lastMonthTough är sann; sparandet går alltid före eget utrymme.

HUSHÅLLETS KONTEXT (varaktig):
- Äger sitt boende (BRF-radhus, köpt ~mitten av 2025). Bostaden är den dominerande tillgången; bolånet den dominerande skulden.
- Bolån på 3-månaders rörlig ränta. Efter det svenska 30-procentiga ränteavdraget är den reala räntekostnaden efter skatt ungefär nominell ränta × 0,7 (avdraget trappas ner över 100k ränta/år — nämn det om räntan är hög). En tvingad amorteringstranch (högt LTV) betalar redan av kapital varje månad.
- Mål på bordet: byta upp sig till ett större hus om ~3–5 år (storleksordning 10–12 MSEK) och avgöra hur aggressivt man ska belåna.
- Emil har aktieuppsida hos arbetsgivaren (teckningsoptioner). En känd optioner→aktier-konvertering i december förbrukar likviditet. Behandla arbetsgivaraktier som koncentrerat, illikvitt och INTE en ersättning för diversifierat sparande.

FINANSFILOSOFI (resonera utifrån detta — citera inte bara):
A) Hävstångsarbitraget och dess förutsättning. Billig, "klibbig" bolåneskuld (~real kostnad efter skatt) mot en lång horisont kan arbitreras mot diversifierad aktieavkastning (~7 % lång sikt nominellt). Spreaden är förmögenhetsmotorn — MEN bara om kapitalet som frigörs faktiskt investeras. Konsumeras överskottet i stället, adderar mer hävstång bara fast kostnad och risk utan avkastning. Detta är det viktigaste testet innan du förordar mer hävstång.
B) Realiserad sparkvot är huvudmåttet. Planerat överskott är irrelevant om savingsThisMonth ≈ 0. Fråga alltid först: ackumulerades faktiskt pengar på spar/ISK denna månad? Ett större hus eller mer hävstång är för tidigt tills det finns en verklig, positiv, automatiserad sparkvot. Nudga mot "spara först" (automatisk överföring på lönedagen) framför att spara "det som blir kvar".
C) Prioritering av överskott: 1) Buffert först — mål ~3 månaders utgifter likvidt (sträckmål 6). Med litet barn, stort bolån och ojämn inkomst är en tunn buffert den främsta sårbarheten. 2) Sedan ISK — framför FRIVILLIG extra amortering, eftersom tvångsamorteringen redan minskar belåningen och real skuldkostnad << förväntad aktieavkastning. Säg det med siffrorna. 3) Frivillig amortering endast om användaren uttryckligen vill ha garanterad avrisk/lägre LTV, eller om räntan stigit nog att pressa ihop spreaden.
D) Spreaden är räntekänslig — testa den. Stark vid låg real kostnad, komprimeras snabbt om 3-månadersräntan driver upp eller om aktier viker. Vid frågor om framtida huset: modellera minst optimistiskt (låg ränta, ~7 % aktier), bas (ränta upp ~1 pp) och stress (ränta upp + ~5 % aktier). Visa nettokostnaden för hävstången i varje. Ge aldrig en enpunktsprognos.
E) Bostad är inte längre en garanterad hiss. Svenska bostadspriser har planat ut/fallit realt efter 2021. Bostadens verkliga fördel är billig klibbig hävstång, bruksvärde och psykologin att hålla genom svängningar — inte säker värdestegring. Uppmuntra diversifiering.
F) Maximal belåning ≠ bör belåna. Behandla 90 % som ett tak, inte ett mål. Kvantifiera skillnaden i andrum (månadskostnad, likviditetsbotten, räntekänslighet) mellan ~75 % och ~90 % LTV.

NUDGING (forma tänkandet över tid):
- Håll EN röd tråd: hävstångs-/förmögenhetsplanen är sund i grunden och låser upp i samma stund som överskottet slutar läcka och börjar investeras. Återvänd till den; inför inte ett nytt ramverk varje månad. Om digesten ger prevThroughline/prevNudge: knyt an till den och notera framsteg eller glidning.
- Nudga mot automatisering framför viljestyrka. Fira en genuint positiv, investerad sparmånad — det beteendet betyder mest.
- Moralisera aldrig om spenderande. Kvantifiera avvägningen: "denna post ~15k/mån över plan är ~180k/år ≈ Z kr ISK-tillväxt på 5 år" — kostnad, inte tillrättavisning.

GARDER:
- Detta är inte licensierad finansiell rådgivning; du analyserar användarens egna siffror. Hänvisa till en kvalificerad svensk rådgivare för skatteupplägg eller sådant som kräver certifiering.
- Presentera aldrig prognoser som säkerheter; använd intervall och namnge den viktigaste risken (oftast räntebanan och den realiserade sparkvoten).
- Flagga, dölj inte, obekväma fynd (tunn buffert, 0 % realiserat sparande, koncentrerad arbetsgivaraktie).

SPRÅK & TON: Skriv all output på svenska. Kortfattat, siffror först, ingen peppande ton, inga emojis. Skriv "ni" (paret).`

// ─── Structured monthly review ────────────────────────────────────────────────

const REVIEW_CONTRACT = `LÄGE: MÅNADSÖVERSIKT.
Producera översikten för perioden i digesten. Svara med ENBART giltig JSON (ingen markdown, inga kodblock) på EXAKT detta format:
{
  "verdict": "strong" | "ok" | "watch" | "concern",   // helhetsläget denna månad
  "throughline": "den röda tråden du återvänder till, 1 mening",
  "headline": "nettoförmögenhet nu + förändring sedan förra importerade månaden och ~6 mån (kr och kr/mån). netWorthPerMonth6mo är redan per kalendermånad.",
  "savings": "realiserad sparkvot: faktiskt sparat denna månad + rullande 3/6-mån snitt, i kr och % av inkomst. Skilj uttryckligen 0 kr från omätbart.",
  "cashflow": "inkomst vs utgift denna månad + rullande snitt (inkomsten är ojämn)",
  "buffer": "likvid buffert i månaders utgifter; flagga om under 3",
  "variances": "de största avvikelserna plan mot utfall, störst först; flagga en Övrigt-post som drar iväg",
  "spendingSpace": "kvar att röra er med i nya perioden (från nextPeriod): inkomst − räkningar = X (≈ Y var); efter rörlig budget och sparande återstår fritt utrymme Z. Avsluta med hur mycket ni bör tilldela er själva VAR — utgå från suggestedPerPerson och håll igen om förra månaden var tuff (säg varför, koppla till största avvikelsen). Om nextPeriod är null: tom sträng.",
  "lookahead": "projicerad likviditetsbotten kommande 6–12 mån och vad som driver den; är botten trygg?",
  "nudge": "EN konkret, kvantifierad åtgärd för kommande månad (t.ex. 'styr X kr till ISK på lönedagen')"
}
Varje värde är en kort svensk sträng, siffror först. Fält som saknar data: skriv kort varför (t.ex. sparande omätbart). Ge exakt EN nudge.`

interface ParsedReview {
  verdict?: string
  throughline?: string
  headline?: string
  savings?: string
  cashflow?: string
  buffer?: string
  variances?: string
  spendingSpace?: string
  lookahead?: string
  nudge?: string
}

const VERDICTS: CoachVerdict[] = ['strong', 'ok', 'watch', 'concern']

function makeClient(apiKey: string) {
  return new Anthropic({ apiKey, dangerouslyAllowBrowser: true })
}

// Cached durable doctrine + a stable per-period digest block. Both are stable within
// a period, so chat turns and a review→chat sequence hit the prompt cache.
function systemBlocks(digest: CoachDigest): Anthropic.TextBlockParam[] {
  return [
    { type: 'text', text: DOCTRINE, cache_control: { type: 'ephemeral' } },
    {
      type: 'text',
      text: `DIGEST (färdigberäknat, period ${digest.periodLabel}):\n${JSON.stringify(digest, null, 1)}`,
      cache_control: { type: 'ephemeral' },
    },
  ]
}

function textOf(response: Anthropic.Message): string {
  return response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim()
}

function parseReview(text: string): ParsedReview {
  const json = text.replace(/```json\n?|\n?```/g, '').trim()
  // Tolerate a leading/trailing prose wrapper by extracting the outermost object.
  const start = json.indexOf('{')
  const end = json.lastIndexOf('}')
  const slice = start >= 0 && end > start ? json.slice(start, end + 1) : json
  return JSON.parse(slice) as ParsedReview
}

// Ask Claude for the structured monthly review. Throws on network/parse failure so
// the caller can fall back to templateCoachReview().
export async function generateCoachReview(
  digest: CoachDigest,
  apiKey: string,
  model: string = DEFAULT_COACH_MODEL
): Promise<CoachReview> {
  const client = makeClient(apiKey)
  const response = await client.messages.create({
    model,
    max_tokens: 1200,
    system: systemBlocks(digest),
    messages: [{ role: 'user', content: REVIEW_CONTRACT }],
  })

  const parsed = parseReview(textOf(response))
  const verdict = (VERDICTS as string[]).includes(parsed.verdict ?? '')
    ? (parsed.verdict as CoachVerdict)
    : 'ok'

  // Require the load-bearing fields; otherwise treat as a failed parse.
  if (!parsed.headline?.trim() || !parsed.savings?.trim() || !parsed.nudge?.trim()) {
    throw new Error('Ofullständigt svar från coachen')
  }

  const s = (v: string | undefined): string => (v ?? '').trim()
  return {
    monthId: digest.monthId,
    generatedAt: new Date().toISOString(),
    source: 'ai',
    model,
    verdict,
    throughline: s(parsed.throughline) || defaultThroughline(),
    headline: s(parsed.headline),
    savings: s(parsed.savings),
    cashflow: s(parsed.cashflow),
    buffer: s(parsed.buffer),
    variances: s(parsed.variances),
    spendingSpace: s(parsed.spendingSpace),
    lookahead: s(parsed.lookahead),
    nudge: s(parsed.nudge),
  }
}

// ─── On-request chat ──────────────────────────────────────────────────────────

export interface CoachChatMessage {
  role: 'user' | 'assistant'
  content: string
}

// Answer an on-request question grounded in the same digest + doctrine. Free-form
// Swedish prose (the multi-scenario spread analysis lives here, not in the review).
export async function coachChat(
  digest: CoachDigest,
  messages: CoachChatMessage[],
  apiKey: string,
  model: string = DEFAULT_COACH_MODEL
): Promise<string> {
  const client = makeClient(apiKey)
  const response = await client.messages.create({
    model,
    max_tokens: 2000,
    system: systemBlocks(digest),
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
  })
  const text = textOf(response)
  // Treat an empty completion as a failure so the UI's error path engages instead
  // of rendering a blank assistant bubble.
  if (!text) throw new Error('Tomt svar från coachen')
  return text
}

// ─── Deterministic offline fallback ───────────────────────────────────────────

const kr = (n: number): string => formatCurrency(n)
const krSigned = (n: number): string => formatCurrency(n, true)
const pct = (frac: number): string => `${Math.round(frac * 100)} %`

function defaultThroughline(): string {
  return 'Hävstångsplanen är sund i grunden — den låser upp i samma stund som överskottet slutar läcka och börjar investeras.'
}

// Rule-based review from the digest alone. Same shape as the AI review, so the card
// renders identically; source:'template' lets the UI note it's the offline text.
export function templateCoachReview(digest: CoachDigest): CoachReview {
  const d = digest

  // Verdict ladder — savings is the master metric, buffer the top vulnerability.
  // null = unmeasurable, NOT bad: never let a null buffer / savings-rate trip
  // 'concern' (that would conflate unknown with zero — the trap the digest exists
  // to avoid). Only non-null, below-threshold values count against the household.
  const bufferBad = d.bufferMonths !== null && d.bufferMonths < d.bufferTargetMonths
  const bufferOk = d.bufferMonths !== null && d.bufferMonths >= d.bufferTargetMonths
  const savingsBad = d.savingsRate6mo !== null && d.savingsRate6mo <= 0
  const savingsStrong = d.savingsRate6mo !== null && d.savingsRate6mo >= 0.15
  let verdict: CoachVerdict
  if (!d.savingsKnown) verdict = 'watch'
  else if (bufferBad || savingsBad) verdict = 'concern'
  else if (savingsStrong && bufferOk) verdict = 'strong'
  else verdict = 'ok'

  // Headline.
  const nwParts: string[] = []
  if (d.netWorth !== null) nwParts.push(`Nettoförmögenhet ${kr(d.netWorth)}`)
  if (d.netWorthDeltaMonth !== null) nwParts.push(`${krSigned(d.netWorthDeltaMonth)} sedan förra importen`)
  if (d.netWorthDelta6mo !== null && d.netWorthPerMonth6mo !== null)
    nwParts.push(`${krSigned(d.netWorthDelta6mo)} på ~6 mån (${krSigned(d.netWorthPerMonth6mo)}/mån)`)
  const headline = nwParts.length ? nwParts.join(' · ') : 'Nettoförmögenhet okänd — saldon saknas i importen.'

  // Savings — distinguish 0 from unmeasurable.
  let savings: string
  if (!d.savingsKnown) {
    savings = 'Sparandet gick inte att mäta denna månad (föregående månad saknar importerade saldon). 0 ≠ omätbart — importera föregående månad för att låsa siffran.'
  } else {
    const rate = d.savingsRateThisMonth !== null ? ` (${pct(d.savingsRateThisMonth)} av inkomsten)` : ''
    const avg = d.savingsAvg6mo !== null ? ` Snitt 6 mån: ${krSigned(d.savingsAvg6mo)}/mån` : ''
    const avg3 = d.savingsAvg3mo !== null ? `, 3 mån: ${krSigned(d.savingsAvg3mo)}/mån` : ''
    savings = `Faktiskt sparat ${krSigned(d.savingsThisMonth ?? 0)}${rate}.${avg}${avg3}.`
  }

  // Cash flow.
  const cashflow = `Inkomst ${kr(d.incomeThisMonth)} (snitt 6 mån ${kr(d.incomeAvg6mo)}), utgift ${kr(d.expenseThisMonth)} (snitt 6 mån ${kr(d.expenseAvg6mo)}). Netto ${krSigned(d.netThisMonth)}. Inkomsten är ojämn — väg mot snittet.`

  // Buffer.
  let buffer: string
  if (d.bufferMonths === null) {
    buffer = `Likvid buffert ${kr(d.liquidNow)}. Kan inte beräkna månaders täckning utan utgiftssnitt.`
  } else {
    const flag = d.bufferMonths < d.bufferTargetMonths ? ` — under målet ${d.bufferTargetMonths} mån. Fyll på först.` : ` — över ${d.bufferTargetMonths}-månadersmålet.`
    buffer = `Likvid buffert ${kr(d.liquidNow)} ≈ ${d.bufferMonths.toFixed(1)} månaders utgifter${flag}`
  }

  // Variances — biggest over-plan first.
  const over = [...d.variances].filter((v) => v.diff > 0).sort((a, b) => b.diff - a.diff)
  let variances: string
  if (over.length === 0) {
    variances = 'Inga kategorier drog nämnvärt över plan.'
  } else {
    const top = over.slice(0, 3).map((v) => `${v.category} ${krSigned(v.diff)}`).join(', ')
    const catchAll = d.catchAllOverPlan !== null ? ` Övrigt ligger ${kr(d.catchAllOverPlan)} över plan — specificera den posten, där läcker sparkvoten.` : ''
    variances = `Störst över plan: ${top}.${catchAll}`
  }

  // Spending space — "kvar att röra er med" in the period that just opened.
  let spendingSpace = ''
  if (d.nextPeriod) {
    const n = d.nextPeriod
    const src = n.incomeSource === 'actual' ? 'inkomst som kommit in' : 'inkomst enligt plan'
    const ladder = `${n.monthLabel}: ${kr(n.income)} (${src}) − ${kr(n.bills)} räkningar = ${kr(n.afterBills)} kvar att röra er med (≈ ${kr(n.afterBillsPerPerson)} var). Efter rörlig budget ${kr(n.variablePlanned)} och planerat sparande ${kr(n.savingsPlanned)} återstår ${krSigned(n.margin)} fritt.`
    let rec: string
    if (n.margin <= 0) {
      rec = ' Planen tilldelar redan hela inkomsten — inget eget utrymme att fördela.'
    } else if (n.lastMonthTough && n.suggestedPerPerson <= 0) {
      rec = ` Förra månaden drog ${kr(n.holdBack)} över — hoppa över eget utrymme denna månad och låt marginalen läka sparandet.`
    } else if (n.lastMonthTough) {
      rec = ` Förra månaden drog ${kr(n.holdBack)} över — håll igen: tilldela er högst ${kr(n.suggestedPerPerson)} var (inte ${kr(n.marginPerPerson)}).`
    } else {
      rec = ` Planen höll — ~${kr(n.suggestedPerPerson)} var i eget utrymme ryms.`
    }
    spendingSpace = ladder + rec
  }

  // Look-ahead.
  let lookahead: string
  if (d.troughLiquidity === null) {
    lookahead = 'Ingen framåtblickande likviditetsprognos tillgänglig.'
  } else {
    const driver = d.troughDrivers[0]
      ? ` Främst drivet av ${d.troughDrivers[0].description} (${kr(d.troughDrivers[0].amount)}, ${d.troughDrivers[0].monthLabel}).`
      : ''
    const safe = d.troughLiquidity < 0 ? ' Botten går NEGATIV — planera.' : ''
    lookahead = `Lägsta projicerade likviditet ${kr(d.troughLiquidity)}${d.troughLabel ? ` (${d.troughLabel})` : ''}.${driver}${safe}`
  }

  // Nudge — one concrete step, priority buffer → ISK.
  let nudge: string
  if (!d.savingsKnown) {
    nudge = 'Importera föregående månads saldon så sparkvoten blir mätbar — utan den siffran flyger vi blint.'
  } else if (d.bufferMonths !== null && d.bufferMonths < d.bufferTargetMonths && d.expenseAvg6mo > 0) {
    const gap = Math.max(0, d.bufferTargetMonths * d.expenseAvg6mo - d.liquidNow)
    nudge = `Toppa bufferten till ${d.bufferTargetMonths} månader ≈ ${kr(gap)}. Automatisera en överföring på lönedagen så det inte beror på viljestyrka.`
  } else if (d.catchAllOverPlan !== null) {
    nudge = `Specificera Övrigt-posten (${kr(d.catchAllOverPlan)} över plan) — en oförklarad femsiffrig lucka är där sparkvoten läcker.`
  } else {
    const amt = d.savingsAvg6mo !== null && d.savingsAvg6mo > 0 ? kr(Math.round(d.savingsAvg6mo)) : 'överskottet'
    nudge = `Automatisera ${amt} till ISK på lönedagen. Vid ~real skuldkostnad << ~7 % förväntad aktieavkastning jobbar marginalkronor hårdare investerade än i frivillig amortering.`
  }

  return {
    monthId: d.monthId,
    generatedAt: new Date().toISOString(),
    source: 'template',
    verdict,
    throughline: d.prevThroughline || defaultThroughline(),
    headline,
    savings,
    cashflow,
    buffer,
    variances,
    spendingSpace,
    lookahead,
    nudge,
  }
}
