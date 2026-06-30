// Period utilities for custom month-start configuration.
//
// A "period" is labeled YYYY-MM but may start on a day other than the 1st.
// Example: monthStartDay=25 → period "2026-01" runs Jan 25–Feb 24.
// With monthStartBusinessDay=true, the actual start shifts to the weekday
// on or before the configured day (mirrors how salary is paid in Sweden).
//
// Salary anchoring (optional): instead of a fixed nominal day, the actual start
// of a period can be pinned to the date salary really landed that month. The
// caller detects those dates (see utils/salaryDetection) and passes them in as
// `anchors`. Each entry maps a period id "YYYY-MM" → the ISO date that period
// begins. INVARIANT: anchors[M] must fall within calendar month M — detection
// clamps the search window so this always holds, which keeps the per-date
// bucketing below (compare against this calendar month's start) correct.

// Period id "YYYY-MM" → ISO "YYYY-MM-DD" date that period actually begins.
export type SalaryAnchors = Record<string, string>

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate()
}

// Returns the actual Date that begins period "YYYY-MM".
export function getActualPeriodStartDate(
  year: number,
  month: number,
  monthStartDay: number,
  monthStartBusinessDay: boolean,
  anchors?: SalaryAnchors
): Date {
  const anchored = anchors?.[`${year}-${String(month).padStart(2, '0')}`]
  if (anchored) {
    return new Date(
      parseInt(anchored.slice(0, 4)),
      parseInt(anchored.slice(5, 7)) - 1,
      parseInt(anchored.slice(8, 10))
    )
  }

  const nomDay = Math.min(monthStartDay, daysInMonth(year, month))
  const nom = new Date(year, month - 1, nomDay)
  if (!monthStartBusinessDay) return nom

  const dow = nom.getDay() // 0=Sun, 6=Sat
  if (dow === 0) return new Date(nom.getTime() - 2 * 86400000) // Sunday → Friday
  if (dow === 6) return new Date(nom.getTime() - 86400000)     // Saturday → Friday
  return nom
}

// Fraction [0,1] of the given period that has elapsed as of `today`, plus
// whether the period is in the past, current, or future. Used to judge
// spending pace against how much of the month has gone by.
export function getPeriodProgress(
  monthId: string,
  monthStartDay: number,
  monthStartBusinessDay: boolean,
  today: Date,
  anchors?: SalaryAnchors
): { elapsed: number; state: 'past' | 'current' | 'future' } {
  const year = parseInt(monthId.slice(0, 4))
  const month = parseInt(monthId.slice(5, 7))
  const start = getActualPeriodStartDate(year, month, monthStartDay, monthStartBusinessDay, anchors)
  const nextYear = month === 12 ? year + 1 : year
  const nextMonth = month === 12 ? 1 : month + 1
  const end = getActualPeriodStartDate(nextYear, nextMonth, monthStartDay, monthStartBusinessDay, anchors)
  const t = today.getTime()
  if (t < start.getTime()) return { elapsed: 0, state: 'future' }
  if (t >= end.getTime()) return { elapsed: 1, state: 'past' }
  return { elapsed: (t - start.getTime()) / (end.getTime() - start.getTime()), state: 'current' }
}

// Returns the YYYY-MM period label a transaction date belongs to.
// dateStr must be ISO format "YYYY-MM-DD".
export function getMonthIdForDate(
  dateStr: string,
  monthStartDay: number,
  monthStartBusinessDay: boolean,
  anchors?: SalaryAnchors
): string {
  // Fast path only when there's nothing that could move the boundary off the 1st.
  if (monthStartDay === 1 && !monthStartBusinessDay && !anchors) return dateStr.slice(0, 7)

  const year = parseInt(dateStr.slice(0, 4))
  const month = parseInt(dateStr.slice(5, 7))
  const day = parseInt(dateStr.slice(8, 10))

  const start = getActualPeriodStartDate(year, month, monthStartDay, monthStartBusinessDay, anchors)
  const startInt = start.getFullYear() * 10000 + (start.getMonth() + 1) * 100 + start.getDate()
  const dateInt = year * 10000 + month * 100 + day

  if (dateInt >= startInt) return `${year}-${String(month).padStart(2, '0')}`

  // Date falls before this month's period start → belongs to the previous period
  if (month === 1) return `${year - 1}-12`
  return `${year}-${String(month - 1).padStart(2, '0')}`
}
