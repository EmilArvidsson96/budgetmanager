// ─── Refund ↔ expense reconciliation ──────────────────────────────────────────
//
// Zlantar files a refund (e.g. a returned purchase, an insurance payout) as
// income under Inkomst → Återbetalningar, while the original purchase already
// landed as an expense. Left alone, that inflates BOTH income and expenses for
// something that was net-zero. This pairs a refund with the expense it most
// likely reverses so the two can be excluded from category totals the same
// way a reconciled transfer already is (see reconciledKeysFromRecords).
//
// Only FULL refunds are matched (amount ≈ the original expense): excluding a
// whole transaction from both totals is only accurate when the two legs
// cancel out completely. A partial refund would quietly erase real spend from
// the expense category, so it's deliberately left unmatched — better to miss
// a suggestion than to silently understate spending.

import type { CategoryDef, TransferMatch, TxOverride, ZlantarCategoryRule, ZlantarTransaction } from '@/types'
import { txKey } from './transferReconciliation'
import { resolveTxCategory } from './zlantarParser'

export interface RefundReconcileOptions {
  transactions: ZlantarTransaction[]
  categories: CategoryDef[]
  zlantarCategoryRules: ZlantarCategoryRule[]
  transactionOverrides: Record<string, TxOverride>
  alreadyReconciledKeys?: Set<string>
  maxDaysDiff?: number      // expense → refund window, default 180 (returns/insurance can lag)
  amountTolerance?: number  // absolute SEK slack on top of a 1% relative allowance
}

interface Candidate {
  refundKey: string
  refund: ZlantarTransaction
  expenseKey: string
  expense: ZlantarTransaction
  daysDiff: number
  score: number
}

export function reconcileRefunds({
  transactions,
  categories,
  zlantarCategoryRules,
  transactionOverrides,
  alreadyReconciledKeys,
  maxDaysDiff = 180,
  amountTolerance = 1,
}: RefundReconcileOptions): TransferMatch[] {
  const reconciled = alreadyReconciledKeys ?? new Set<string>()
  const catById = new Map(categories.map((c) => [c.id, c]))

  const refunds: { tx: ZlantarTransaction; key: string }[] = []
  const expenses: { tx: ZlantarTransaction; key: string }[] = []

  for (const tx of transactions) {
    if (!tx.date || tx.transaction_type === 'transfer') continue
    const key = txKey(tx)
    if (reconciled.has(key)) continue
    const { catId, subId } = resolveTxCategory(tx, categories, zlantarCategoryRules, transactionOverrides)
    const cat = catById.get(catId)
    if (!cat) continue
    if (cat.type === 'income' && subId === 'refund' && tx.amount > 0) {
      refunds.push({ tx, key })
    } else if (cat.type === 'expense' && tx.amount < 0) {
      expenses.push({ tx, key })
    }
  }
  if (refunds.length === 0 || expenses.length === 0) return []

  const candidates: Candidate[] = []
  for (const r of refunds) {
    const rTime = Date.parse(r.tx.date)
    if (Number.isNaN(rTime)) continue
    for (const e of expenses) {
      const expenseAbs = Math.abs(e.tx.amount)
      if (expenseAbs <= 0) continue
      if (Math.abs(expenseAbs - r.tx.amount) > Math.max(amountTolerance, expenseAbs * 0.01)) continue

      const eTime = Date.parse(e.tx.date)
      if (Number.isNaN(eTime)) continue
      const daysDiff = (rTime - eTime) / 86_400_000
      // The purchase must precede (or coincide with) the refund it reverses.
      if (daysDiff < 0 || daysDiff > maxDaysDiff) continue

      const sameAccount = !!e.tx.account_number && e.tx.account_number === r.tx.account_number
      const score = Math.max(0, maxDaysDiff - daysDiff) + (sameAccount ? 1000 : 0)

      candidates.push({ refundKey: r.key, refund: r.tx, expenseKey: e.key, expense: e.tx, daysDiff, score })
    }
  }

  candidates.sort((a, b) => b.score - a.score)
  const used = new Set<string>()
  const accepted: TransferMatch[] = []
  for (const c of candidates) {
    if (used.has(c.refundKey) || used.has(c.expenseKey)) continue
    used.add(c.refundKey)
    used.add(c.expenseKey)
    accepted.push({
      id: `refund_${c.expenseKey}__${c.refundKey}`,
      txAKey: c.expenseKey,
      txBKey: c.refundKey,
      dateA: c.expense.date,
      dateB: c.refund.date,
      amount: Math.abs(c.refund.amount),
      ownerA: 'Kostnad',
      ownerB: 'Återbetalning',
      accountAName: c.expense.account_name,
      accountBName: c.refund.account_name,
      descriptionA: c.expense.description,
      descriptionB: c.refund.description,
      daysDiff: c.daysDiff,
      keywordHit: false,
    })
  }
  return accepted
}
