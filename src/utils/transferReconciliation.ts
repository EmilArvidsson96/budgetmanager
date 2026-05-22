import type {
  Account,
  ReconciliationRecord,
  TransferMatch,
  ZlantarTransaction,
} from '@/types'

// Stable identifier for a transaction. Mirrors the dedup key used by the
// store's `setZlantarImport`, so a reconciled key can be matched back to
// transactions in `allTransactions`.
export function txKey(tx: ZlantarTransaction): string {
  return `${tx.date}|${tx.amount}|${tx.description ?? ''}`
}

export function accountIdForTx(tx: ZlantarTransaction): string {
  return `${tx.bank_name}_${tx.account_index}`
}

export function reconciledKeysFromRecords(
  records: ReconciliationRecord[]
): Set<string> {
  const keys = new Set<string>()
  for (const rec of records) {
    for (const m of rec.matches) {
      keys.add(m.txAKey)
      keys.add(m.txBKey)
    }
  }
  return keys
}

export interface ReconcileOptions {
  transactions: ZlantarTransaction[]
  accounts: Account[]
  partnerName?: string
  alreadyReconciledKeys?: Set<string>
  maxDaysDiff?: number
  amountTolerance?: number
}

interface Candidate extends TransferMatch {
  score: number
}

// Pair up opposite-sign transactions from accounts owned by different people.
// Greedy match: best score first, each tx can only participate in one match.
export function reconcileTransfers({
  transactions,
  accounts,
  partnerName,
  alreadyReconciledKeys,
  maxDaysDiff = 5,
  amountTolerance = 0.01,
}: ReconcileOptions): TransferMatch[] {
  const reconciled = alreadyReconciledKeys ?? new Set<string>()

  const accountInfo = new Map<string, { owner: string; name: string }>()
  for (const acc of accounts) {
    if (acc.owner && acc.owner.trim()) {
      accountInfo.set(acc.id, { owner: acc.owner.trim(), name: acc.name })
    }
  }
  if (accountInfo.size === 0) return []

  const owners = new Set<string>()
  for (const info of accountInfo.values()) owners.add(info.owner.toLowerCase())
  if (owners.size < 2) return []   // nothing to reconcile across

  const keywords = ['swish']
  if (partnerName && partnerName.trim()) keywords.push(partnerName.trim().toLowerCase())

  type Enriched = {
    tx: ZlantarTransaction
    key: string
    owner: string
    accountName: string
  }

  const seenKeys = new Set<string>()
  const enriched: Enriched[] = []
  for (const tx of transactions) {
    if (!tx.date) continue
    if (tx.transaction_type === 'transfer') continue   // Zlantar-internal
    const key = txKey(tx)
    if (reconciled.has(key)) continue
    if (seenKeys.has(key)) continue
    seenKeys.add(key)
    const info = accountInfo.get(accountIdForTx(tx))
    if (!info) continue
    enriched.push({ tx, key, owner: info.owner, accountName: info.name })
  }

  const negatives = enriched.filter((e) => e.tx.amount < 0)
  const positives = enriched.filter((e) => e.tx.amount > 0)

  const candidates: Candidate[] = []
  for (const neg of negatives) {
    const negTime = Date.parse(neg.tx.date)
    if (Number.isNaN(negTime)) continue
    for (const pos of positives) {
      if (neg.owner.toLowerCase() === pos.owner.toLowerCase()) continue
      if (Math.abs(neg.tx.amount + pos.tx.amount) > amountTolerance) continue
      const posTime = Date.parse(pos.tx.date)
      if (Number.isNaN(posTime)) continue
      const daysDiff = Math.abs(negTime - posTime) / 86_400_000
      if (daysDiff > maxDaysDiff) continue

      const desc = `${neg.tx.description ?? ''} ${pos.tx.description ?? ''}`.toLowerCase()
      const keywordHit = keywords.some((k) => k && desc.includes(k))

      // Closer dates + keyword hit = higher score
      const score = (maxDaysDiff - daysDiff) + (keywordHit ? 10 : 0)

      candidates.push({
        id: `match_${neg.key}__${pos.key}`,
        txAKey: neg.key,
        txBKey: pos.key,
        dateA: neg.tx.date,
        dateB: pos.tx.date,
        amount: Math.abs(neg.tx.amount),
        ownerA: neg.owner,
        ownerB: pos.owner,
        accountAName: neg.accountName,
        accountBName: pos.accountName,
        descriptionA: neg.tx.description,
        descriptionB: pos.tx.description,
        daysDiff,
        keywordHit,
        score,
      })
    }
  }

  candidates.sort((a, b) => b.score - a.score)
  const used = new Set<string>()
  const accepted: TransferMatch[] = []
  for (const c of candidates) {
    if (used.has(c.txAKey) || used.has(c.txBKey)) continue
    const match: TransferMatch = {
      id: c.id,
      txAKey: c.txAKey,
      txBKey: c.txBKey,
      dateA: c.dateA,
      dateB: c.dateB,
      amount: c.amount,
      ownerA: c.ownerA,
      ownerB: c.ownerB,
      accountAName: c.accountAName,
      accountBName: c.accountBName,
      descriptionA: c.descriptionA,
      descriptionB: c.descriptionB,
      daysDiff: c.daysDiff,
      keywordHit: c.keywordHit,
    }
    accepted.push(match)
    used.add(c.txAKey)
    used.add(c.txBKey)
  }
  return accepted
}
