import ExcelJS from 'exceljs'
import type {
  AppState,
  MonthlyBudget,
  YearlyBudget,
  LiquidityPlan,
  MonthlyActuals,
  CategoryDef,
} from '@/types'

const MONTH_NAMES = [
  'Januari', 'Februari', 'Mars', 'April', 'Maj', 'Juni',
  'Juli', 'Augusti', 'September', 'Oktober', 'November', 'December',
]

const HEADER_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FF0E90E3' },
}
const HEADER_FONT: Partial<ExcelJS.Font> = { color: { argb: 'FFFFFFFF' }, bold: true }
const SUBHEADER_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFE0EFFE' },
}
const INCOME_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFD1FAE5' },
}
const EXPENSE_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFFFF7ED' },
}

function setCurrencyFormat(cell: ExcelJS.Cell) {
  cell.numFmt = '#,##0.00 "kr"'
}

function styleHeaderRow(row: ExcelJS.Row) {
  row.eachCell((cell) => {
    cell.fill = HEADER_FILL
    cell.font = HEADER_FONT
    cell.alignment = { vertical: 'middle', horizontal: 'center' }
    cell.border = {
      bottom: { style: 'thin', color: { argb: 'FF0272C2' } },
    }
  })
  row.height = 20
}

// ─── Monthly budget sheet ─────────────────────────────────────────────────────

function addMonthlySheet(
  wb: ExcelJS.Workbook,
  budget: MonthlyBudget,
  actuals: MonthlyActuals | undefined,
  categories: CategoryDef[]
) {
  const name = `Budget_${budget.year}_${String(budget.month).padStart(2, '0')}`
  const ws = wb.addWorksheet(name)

  ws.columns = [
    { header: '', key: 'category', width: 28 },
    { header: '', key: 'subcategory', width: 26 },
    { header: '', key: 'budget', width: 16 },
    { header: '', key: 'actual', width: 16 },
    { header: '', key: 'variance', width: 16 },
    { header: '', key: 'notes', width: 30 },
  ]

  // Title
  ws.mergeCells('A1:F1')
  const title = ws.getCell('A1')
  title.value = `Månadsbudget – ${MONTH_NAMES[budget.month - 1]} ${budget.year}`
  title.font = { size: 14, bold: true, color: { argb: 'FF0E90E3' } }
  title.alignment = { horizontal: 'left', vertical: 'middle' }
  ws.getRow(1).height = 28

  // Header row
  const hRow = ws.getRow(2)
  hRow.values = ['Kategori', 'Underkategori', 'Budget (kr)', 'Utfall (kr)', 'Avvikelse (kr)', 'Noteringar']
  styleHeaderRow(hRow)

  let rowIndex = 3

  const catBudgetMap = new Map(budget.categories.map((c) => [c.categoryId, c]))
  const actualsMap = new Map<string, number>()
  if (actuals) {
    for (const e of actuals.entries) {
      const key = `${e.categoryId}|||${e.subcategoryId ?? ''}`
      actualsMap.set(key, (actualsMap.get(key) ?? 0) + e.totalAmount)
    }
  }

  for (const cat of categories) {
    const cb = catBudgetMap.get(cat.id)
    const catTotal = cb?.amount ?? 0
    const catActual = actuals
      ? actuals.entries
          .filter((e) => e.categoryId === cat.id)
          .reduce((s, e) => s + e.totalAmount, 0)
      : null

    // Category row
    const catRow = ws.getRow(rowIndex++)
    catRow.values = [cat.name, '', catTotal, catActual ?? '', catActual !== null ? catActual - catTotal : '', '']
    catRow.getCell(1).font = { bold: true }
    catRow.getCell(3).numFmt = '#,##0.00 "kr"'
    if (catActual !== null) {
      setCurrencyFormat(catRow.getCell(4))
      const vCell = catRow.getCell(5)
      setCurrencyFormat(vCell)
      const v = catActual - catTotal
      vCell.font = { color: { argb: v >= 0 ? 'FF22C55E' : 'FFEF4444' } }
    }
    const fill = cat.type === 'income' ? INCOME_FILL : EXPENSE_FILL
    catRow.eachCell((c) => { c.fill = fill })

    // Subcategory rows
    for (const sub of cat.subcategories) {
      const sb = cb?.subcategories.find((s) => s.subcategoryId === sub.id)
      const subBudget = sb?.amount ?? ''
      const subActual = actualsMap.get(`${cat.id}|||${sub.id}`) ?? null
      const subRow = ws.getRow(rowIndex++)
      subRow.values = ['', `  ${sub.name}`, subBudget, subActual ?? '', subActual !== null && subBudget !== '' ? subActual - (subBudget as number) : '', '']
      subRow.getCell(3).numFmt = '#,##0.00 "kr"'
      if (subActual !== null) {
        setCurrencyFormat(subRow.getCell(4))
        if (subBudget !== '') {
          const vCell = subRow.getCell(5)
          setCurrencyFormat(vCell)
          const v = subActual - (subBudget as number)
          vCell.font = { color: { argb: v >= 0 ? 'FF22C55E' : 'FFEF4444' } }
        }
      }
      subRow.eachCell((c) => { c.fill = SUBHEADER_FILL })
    }
  }

  // Summary rows
  rowIndex++
  const sumRow = ws.getRow(rowIndex++)
  const totalBudget = budget.categories.reduce((s, c) => s + (c.amount ?? 0), 0)
  const totalActual = actuals ? actuals.entries.reduce((s, e) => s + e.totalAmount, 0) : null
  sumRow.values = ['TOTALT', '', totalBudget, totalActual ?? '', totalActual !== null ? totalActual - totalBudget : '', '']
  sumRow.font = { bold: true }
  sumRow.getCell(3).numFmt = '#,##0.00 "kr"'
  if (totalActual !== null) {
    setCurrencyFormat(sumRow.getCell(4))
    setCurrencyFormat(sumRow.getCell(5))
  }
  styleHeaderRow(sumRow)

  ws.addConditionalFormatting({
    ref: `E3:E${rowIndex}`,
    rules: [
      {
        type: 'cellIs',
        operator: 'greaterThan',
        formulae: ['0'],
        priority: 1,
        style: { font: { color: { argb: 'FF22C55E' } } },
      },
      {
        type: 'cellIs',
        operator: 'lessThan',
        formulae: ['0'],
        priority: 2,
        style: { font: { color: { argb: 'FFEF4444' } } },
      },
    ],
  })

  ws.getRow(2).height = 20
  ws.views = [{ state: 'frozen', xSplit: 0, ySplit: 2 }]
}

// ─── Yearly budget sheet ──────────────────────────────────────────────────────

function addYearlySheet(
  wb: ExcelJS.Workbook,
  yearly: YearlyBudget,
  monthlyBudgets: Record<string, MonthlyBudget>,
  actuals: Record<string, MonthlyActuals>,
  categories: CategoryDef[]
) {
  const ws = wb.addWorksheet(`Budget_${yearly.year}`)

  const months = Array.from({ length: 12 }, (_, i) => i + 1)
  const monthCols = months.map((m) => ({ header: MONTH_NAMES[m - 1].slice(0, 3), key: `m${m}`, width: 13 }))

  ws.columns = [
    { header: '', key: 'category', width: 26 },
    { header: '', key: 'subcategory', width: 24 },
    { header: '', key: 'annual', width: 15 },
    ...monthCols,
    { header: '', key: 'ytd_actual', width: 15 },
    { header: '', key: 'ytd_variance', width: 15 },
  ]

  ws.mergeCells('A1:R1')
  const title = ws.getCell('A1')
  title.value = `Årsbudget ${yearly.year}`
  title.font = { size: 14, bold: true, color: { argb: 'FF0E90E3' } }
  title.alignment = { horizontal: 'left', vertical: 'middle' }
  ws.getRow(1).height = 28

  const hRow = ws.getRow(2)
  const hVals: string[] = ['Kategori', 'Underkategori', 'Årsbudget (kr)']
  months.forEach((m) => hVals.push(MONTH_NAMES[m - 1].slice(0, 3)))
  hVals.push('YTD Utfall (kr)', 'YTD Avvikelse (kr)')
  hRow.values = hVals
  styleHeaderRow(hRow)

  let rowIndex = 3

  for (const cat of categories) {
    const yc = yearly.categories.find((c) => c.categoryId === cat.id)
    const annualBudget = yc?.annualAmount ?? 0

    const monthlyValues = months.map((m) => {
      const key = `${yearly.year}-${String(m).padStart(2, '0')}`
      const mb = monthlyBudgets[key]
      if (mb) {
        return mb.categories.find((c) => c.categoryId === cat.id)?.amount ?? ''
      }
      if (yc && annualBudget > 0) {
        if (yc.monthlyAllocation === 'custom' && yc.customMonthAmounts?.[m] !== undefined) {
          return yc.customMonthAmounts[m]
        }
        return Math.round((annualBudget / 12) * 100) / 100
      }
      return ''
    })

    const ytdActual = months.reduce((sum, m) => {
      const key = `${yearly.year}-${String(m).padStart(2, '0')}`
      const act = actuals[key]
      if (!act) return sum
      return sum + act.entries.filter((e) => e.categoryId === cat.id).reduce((s, e) => s + e.totalAmount, 0)
    }, 0)

    const catRow = ws.getRow(rowIndex++)
    const rowVals: (string | number)[] = [cat.name, '', annualBudget, ...monthlyValues, ytdActual, ytdActual - annualBudget]
    catRow.values = rowVals
    catRow.getCell(1).font = { bold: true }
    ;[3, ...months.map((_, i) => i + 4), 16, 17].forEach((col) => {
      catRow.getCell(col).numFmt = '#,##0.00 "kr"'
    })
    const fill = cat.type === 'income' ? INCOME_FILL : EXPENSE_FILL
    catRow.eachCell((c) => { c.fill = fill })
  }

  ws.views = [{ state: 'frozen', xSplit: 2, ySplit: 2 }]
}

// ─── Liquidity sheet ──────────────────────────────────────────────────────────

function addLiquiditySheet(
  wb: ExcelJS.Workbook,
  plan: LiquidityPlan
) {
  const ws = wb.addWorksheet(`Likviditet_${plan.year}`)

  ws.columns = [
    { header: 'Datum', key: 'date', width: 14 },
    { header: 'Beskrivning', key: 'desc', width: 32 },
    { header: 'Typ', key: 'type', width: 14 },
    { header: 'Belopp (kr)', key: 'amount', width: 16 },
    { header: 'Saldo (kr)', key: 'balance', width: 16 },
    { header: 'Konto', key: 'account', width: 18 },
    { header: 'Bekräftad', key: 'confirmed', width: 12 },
    { header: 'Noteringar', key: 'notes', width: 28 },
  ]

  ws.mergeCells('A1:H1')
  const t = ws.getCell('A1')
  t.value = `Likviditetsplanering ${plan.year}`
  t.font = { size: 14, bold: true, color: { argb: 'FF0E90E3' } }
  t.alignment = { horizontal: 'left', vertical: 'middle' }
  ws.getRow(1).height = 28

  const hRow = ws.getRow(2)
  hRow.values = ['Datum', 'Beskrivning', 'Typ', 'Belopp (kr)', 'Saldo (kr)', 'Konto', 'Bekräftad', 'Noteringar']
  styleHeaderRow(hRow)

  // Starting balances section
  let rowIdx = 3
  if (plan.startingBalances.length > 0) {
    const sbRow = ws.getRow(rowIdx++)
    sbRow.getCell(1).value = 'Ingående saldon'
    sbRow.getCell(1).font = { bold: true, italic: true }
    for (const b of plan.startingBalances) {
      const r = ws.getRow(rowIdx++)
      r.values = ['', b.accountName, 'Ingående saldo', b.balance, '', '', '', '']
      setCurrencyFormat(r.getCell(4))
    }
    rowIdx++
  }

  // Sort entries by date
  const sorted = [...plan.entries].sort((a, b) => a.date.localeCompare(b.date))
  let runningBalance = plan.startingBalances.reduce((s, b) => s + b.balance, 0)

  for (const entry of sorted) {
    runningBalance += entry.amount
    const r = ws.getRow(rowIdx++)
    const typeLabel = {
      income: 'Inkomst',
      expense: 'Utgift',
      transfer: 'Överföring',
      loan_payment: 'Lånebetal.',
    }[entry.type] ?? entry.type

    r.values = [
      entry.date,
      entry.description,
      typeLabel,
      entry.amount,
      runningBalance,
      '',
      entry.isConfirmed ? 'Ja' : 'Nej',
      '',
    ]
    setCurrencyFormat(r.getCell(4))
    setCurrencyFormat(r.getCell(5))

    if (entry.amount < 0) {
      r.getCell(4).font = { color: { argb: 'FFEF4444' } }
    } else {
      r.getCell(4).font = { color: { argb: 'FF22C55E' } }
    }
    if (runningBalance < 0) {
      r.getCell(5).fill = {
        type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' },
      }
    }
  }

  ws.views = [{ state: 'frozen', xSplit: 0, ySplit: 2 }]
}

// ─── Settings sheet ───────────────────────────────────────────────────────────

function addSettingsSheet(wb: ExcelJS.Workbook, categories: CategoryDef[]) {
  const ws = wb.addWorksheet('Inställningar')

  ws.columns = [
    { header: 'Kategori-ID', key: 'catId', width: 22 },
    { header: 'Kategorinamn', key: 'catName', width: 26 },
    { header: 'Typ', key: 'type', width: 14 },
    { header: 'Underkategori-ID', key: 'subId', width: 22 },
    { header: 'Underkategorinamn', key: 'subName', width: 26 },
  ]

  const hRow = ws.getRow(1)
  hRow.values = ['Kategori-ID', 'Kategorinamn', 'Typ', 'Underkategori-ID', 'Underkategorinamn']
  styleHeaderRow(hRow)

  let r = 2
  for (const cat of categories) {
    if (cat.subcategories.length === 0) {
      const row = ws.getRow(r++)
      row.values = [cat.id, cat.name, cat.type, '', '']
    } else {
      for (const sub of cat.subcategories) {
        const row = ws.getRow(r++)
        row.values = [cat.id, cat.name, cat.type, sub.id, sub.name]
      }
    }
  }
}

// ─── Main export function ─────────────────────────────────────────────────────

export async function exportToExcel(state: AppState, year: number): Promise<void> {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Budgethanteraren'
  wb.created = new Date()
  wb.title = `Budget ${year}`

  const { settings, monthlyBudgets, yearlyBudgets, actuals, liquidityPlans } = state
  const categories = settings.categories

  // Settings sheet first (AI-navigable reference)
  addSettingsSheet(wb, categories)

  // Yearly budget
  const yb = yearlyBudgets[String(year)]
  if (yb) {
    addYearlySheet(wb, yb, monthlyBudgets, actuals, categories)
  }

  // Monthly budgets for this year
  const yearMonths = Object.keys(monthlyBudgets)
    .filter((k) => k.startsWith(String(year)))
    .sort()

  for (const ym of yearMonths) {
    const mb = monthlyBudgets[ym]
    const act = actuals[ym]
    addMonthlySheet(wb, mb, act, categories)
  }

  // Liquidity
  const lp = liquidityPlans[String(year)]
  if (lp) {
    addLiquiditySheet(wb, lp)
  }

  // Trigger download in browser
  const buffer = await wb.xlsx.writeBuffer()
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `budget_${year}.xlsx`
  a.click()
  URL.revokeObjectURL(url)
}
