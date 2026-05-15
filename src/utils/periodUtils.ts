// Period utilities for custom month-start configuration.
//
// A "period" is labeled YYYY-MM but may start on a day other than the 1st.
// Example: monthStartDay=25 → period "2026-01" runs Jan 25–Feb 24.
// With monthStartBusinessDay=true, the actual start shifts to the weekday
// on or before the configured day (mirrors how salary is paid in Sweden).

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate()
}

// Returns the actual Date that begins period "YYYY-MM".
export function getActualPeriodStartDate(
  year: number,
  month: number,
  monthStartDay: number,
  monthStartBusinessDay: boolean
): Date {
  const nomDay = Math.min(monthStartDay, daysInMonth(year, month))
  const nom = new Date(year, month - 1, nomDay)
  if (!monthStartBusinessDay) return nom

  const dow = nom.getDay() // 0=Sun, 6=Sat
  if (dow === 0) return new Date(nom.getTime() - 2 * 86400000) // Sunday → Friday
  if (dow === 6) return new Date(nom.getTime() - 86400000)     // Saturday → Friday
  return nom
}

// Returns the YYYY-MM period label a transaction date belongs to.
// dateStr must be ISO format "YYYY-MM-DD".
export function getMonthIdForDate(
  dateStr: string,
  monthStartDay: number,
  monthStartBusinessDay: boolean
): string {
  if (monthStartDay === 1 && !monthStartBusinessDay) return dateStr.slice(0, 7)

  const year = parseInt(dateStr.slice(0, 4))
  const month = parseInt(dateStr.slice(5, 7))
  const day = parseInt(dateStr.slice(8, 10))

  const start = getActualPeriodStartDate(year, month, monthStartDay, monthStartBusinessDay)
  const startInt = start.getFullYear() * 10000 + (start.getMonth() + 1) * 100 + start.getDate()
  const dateInt = year * 10000 + month * 100 + day

  if (dateInt >= startInt) return `${year}-${String(month).padStart(2, '0')}`

  // Date falls before this month's period start → belongs to the previous period
  if (month === 1) return `${year - 1}-12`
  return `${year}-${String(month - 1).padStart(2, '0')}`
}
