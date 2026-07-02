// Period utilities for custom month-start configuration.
//
// A "period" is labeled YYYY-MM but may start on a day other than the 1st.
// Example: monthStartDay=25 → period "2026-01" runs Jan 25–Feb 24.
// With monthStartBusinessDay=true, the actual start shifts to the weekday
// on or before the configured day (mirrors how salary is paid in Sweden).
//
// ─── Salary-anchored reconciliation periods (optional) ────────────────────────
//
// When enabled (a SalaryPeriodConfig is passed) the boundary between periods is
// TYPE-DEPENDENT and the label is shifted forward one month:
//   • the salary that lands in calendar month M opens the reconciliation month
//     labelled M+1 (so a salary on 22 May opens "June");
//   • ordinary transactions (expenses, transfers, other income) and date-only
//     lookups roll to the next label on/after the detected salary day of their
//     calendar month (fallback: expectedSalaryDay);
//   • "listed income" (salary + configured benefit/savings-withdrawal categories)
//     rolls on/after incomeCutDay (~20) instead — so benefits paid a few days
//     before payday still count toward the coming month, while expenses on those
//     same days stay in the current month.
// Net rule (feature on): label = calendar month, +1 if the date is on/after the
// kind's boundary day. This is exactly the legacy result + 1 month.
//
// When no config is passed the legacy calendar/monthStartDay behaviour applies
// with NO shift — so users who never enabled the feature are unaffected.

// Period id "YYYY-MM" → ISO "YYYY-MM-DD" date salary landed in that CALENDAR month.
// Detection keeps the invariant that anchors[M] lies within calendar month M.
export type SalaryAnchors = Record<string, string>

// What is being bucketed — picks which boundary day applies. 'neutral' (date-only
// lookups: current period, month-list generation, progress) behaves like 'other'.
export type BucketKind = 'listed-income' | 'other' | 'neutral'

export interface SalaryPeriodConfig {
  anchors: SalaryAnchors
  incomeCutDay: number       // listed income on/after this day → next reconciliation label
  expectedSalaryDay: number  // fallback boundary day for calendar months with no detected salary
}

// Income subcategories / raw categories treated as "listed income" — they use the
// early income-cut boundary. Confirmed set: salary, general + social benefits, and
// the two savings-withdrawal buckets + vacation savings. Excludes studiemedel and
// capital windfalls (interest/refund/sale), which follow the ordinary boundary.
const LISTED_INCOME_SUBS = new Set([
  'salary', 'other_bidrag', 'sjukpenning', 'foraldrapenning', 'aktivitetsstod',
  'savings_capex', 'savings_other', 'savings_vacation',
])
const LISTED_INCOME_RAW = new Set(['salary', 'subsidy'])

// Classify a resolved transaction category into a BucketKind. Only income that is
// a listed benefit/salary/withdrawal counts as 'listed-income'; everything else
// (expenses, transfers, interest/refund/sale, unmapped) is 'other'.
export function bucketKindForCategory(catId: string, subId: string, rawCat: string): BucketKind {
  if (catId === 'income' && (LISTED_INCOME_SUBS.has(subId) || LISTED_INCOME_RAW.has(rawCat))) {
    return 'listed-income'
  }
  return 'other'
}

// Manual liquidity entries have only a coarse type and no category. Treat them all
// as 'other' (salary boundary) so a planned one-off never silently jumps a month.
export function bucketKindForEntry(_type: 'income' | 'expense' | 'transfer' | 'loan_payment'): BucketKind {
  return 'other'
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate()
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

// Legacy (feature-off) nominal start of period "YYYY-MM": monthStartDay, adjusted
// to the weekday on/before it when monthStartBusinessDay is set.
function nominalStart(year: number, month: number, monthStartDay: number, monthStartBusinessDay: boolean): Date {
  const nomDay = Math.min(monthStartDay, daysInMonth(year, month))
  const nom = new Date(year, month - 1, nomDay)
  if (!monthStartBusinessDay) return nom
  const dow = nom.getDay() // 0=Sun, 6=Sat
  if (dow === 0) return new Date(nom.getTime() - 2 * 86400000) // Sunday → Friday
  if (dow === 6) return new Date(nom.getTime() - 86400000)     // Saturday → Friday
  return nom
}

// The 'other'/'neutral' boundary day within a given CALENDAR month: the detected
// salary day, else the (clamped) expected fallback day.
function salaryBoundaryDay(config: SalaryPeriodConfig, year: number, month: number): number {
  const iso = config.anchors[`${year}-${pad2(month)}`]
  if (iso) return parseInt(iso.slice(8, 10))
  return Math.min(config.expectedSalaryDay, daysInMonth(year, month))
}

// Returns the actual Date that period "YYYY-MM" begins.
// Feature on: the period LABELLED (year,month) is opened by the salary in the
// PREVIOUS calendar month, so its start is that month's salary/expected day.
export function getActualPeriodStartDate(
  year: number,
  month: number,
  monthStartDay: number,
  monthStartBusinessDay: boolean,
  config?: SalaryPeriodConfig
): Date {
  if (!config) return nominalStart(year, month, monthStartDay, monthStartBusinessDay)

  const prevYear = month === 1 ? year - 1 : year
  const prevMonth = month === 1 ? 12 : month - 1
  const iso = config.anchors[`${prevYear}-${pad2(prevMonth)}`]
  if (iso) {
    return new Date(parseInt(iso.slice(0, 4)), parseInt(iso.slice(5, 7)) - 1, parseInt(iso.slice(8, 10)))
  }
  const d = Math.min(config.expectedSalaryDay, daysInMonth(prevYear, prevMonth))
  return new Date(prevYear, prevMonth - 1, d)
}

// Fraction [0,1] of the given period that has elapsed as of `today`, plus whether
// the period is in the past, current, or future. Uses the salary ('other') frame
// as the canonical period span (see getActualPeriodStartDate).
export function getPeriodProgress(
  monthId: string,
  monthStartDay: number,
  monthStartBusinessDay: boolean,
  today: Date,
  config?: SalaryPeriodConfig
): { elapsed: number; state: 'past' | 'current' | 'future' } {
  const year = parseInt(monthId.slice(0, 4))
  const month = parseInt(monthId.slice(5, 7))
  const start = getActualPeriodStartDate(year, month, monthStartDay, monthStartBusinessDay, config)
  const nextYear = month === 12 ? year + 1 : year
  const nextMonth = month === 12 ? 1 : month + 1
  const end = getActualPeriodStartDate(nextYear, nextMonth, monthStartDay, monthStartBusinessDay, config)
  const t = today.getTime()
  if (t < start.getTime()) return { elapsed: 0, state: 'future' }
  if (t >= end.getTime()) return { elapsed: 1, state: 'past' }
  return { elapsed: (t - start.getTime()) / (end.getTime() - start.getTime()), state: 'current' }
}

// Returns the YYYY-MM reconciliation-period label a date belongs to.
// dateStr must start with ISO "YYYY-MM-DD" (extra time suffix is ignored).
export function getMonthIdForDate(
  dateStr: string,
  monthStartDay: number,
  monthStartBusinessDay: boolean,
  config?: SalaryPeriodConfig,
  kind: BucketKind = 'neutral'
): string {
  const year = parseInt(dateStr.slice(0, 4))
  const month = parseInt(dateStr.slice(5, 7))
  const day = parseInt(dateStr.slice(8, 10))

  if (!config) {
    // Feature OFF → legacy calendar/monthStartDay behaviour, no shift.
    if (monthStartDay === 1 && !monthStartBusinessDay) return dateStr.slice(0, 7)
    const start = nominalStart(year, month, monthStartDay, monthStartBusinessDay)
    const startInt = start.getFullYear() * 10000 + (start.getMonth() + 1) * 100 + start.getDate()
    const dateInt = year * 10000 + month * 100 + day
    if (dateInt >= startInt) return `${year}-${pad2(month)}`
    return month === 1 ? `${year - 1}-12` : `${year}-${pad2(month - 1)}`
  }

  // Feature ON → type-dependent boundary + one-month label shift.
  const boundaryDay = kind === 'listed-income'
    ? config.incomeCutDay
    : salaryBoundaryDay(config, year, month)

  if (day >= boundaryDay) {
    // On/after this month's boundary → belongs to the period this month's salary
    // opens → labelled M+1 (roll the year at December).
    return month === 12 ? `${year + 1}-01` : `${year}-${pad2(month + 1)}`
  }
  // Before the boundary → still in the period the previous month's salary opened,
  // which is labelled M.
  return `${year}-${pad2(month)}`
}
