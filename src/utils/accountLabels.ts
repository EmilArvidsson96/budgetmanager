// ─── Unique display labels for accounts ──────────────────────────────────────
//
// Several accounts can legitimately share a name ("Buffert", "Privatkonto") —
// one per owner and/or bank. A chart keyed or labelled by the bare name would
// both collide and read ambiguously, so this derives a per-id display label
// that appends whatever actually distinguishes the accounts within a
// same-name group: the bank when banks differ, the owner when owners differ,
// and a trailing id fragment as a last resort (e.g. a mortgage split into
// identically named parts).

import type { Account } from '@/types'

const firstWord = (s: string | undefined) => (s ?? '').trim().split(/\s+/)[0] ?? ''

export function accountDisplayLabels(accounts: Account[]): Map<string, string> {
  // Group case-insensitively so "Buffert" and "BUFFERT" (different banks'
  // spellings of the same idea) also get told apart.
  const groups = new Map<string, Account[]>()
  for (const a of accounts) {
    const key = a.name.trim().toLowerCase()
    const g = groups.get(key)
    if (g) g.push(a)
    else groups.set(key, [a])
  }

  const labels = new Map<string, string>()
  for (const group of groups.values()) {
    if (group.length === 1) {
      labels.set(group[0].id, group[0].name)
      continue
    }
    const banks = new Set(group.map((a) => a.bankName ?? ''))
    const owners = new Set(group.map((a) => a.owner ?? ''))
    // First names read better in a legend, but fall back to the full owner
    // string when first names alone can't separate the group
    // ("Emil Johan…" vs "Emil och Anna").
    const shortOwners = new Set(group.map((a) => firstWord(a.owner)))
    const useFullOwner = shortOwners.size < owners.size
    for (const a of group) {
      const parts: string[] = []
      if (banks.size > 1 && a.bankName) parts.push(a.bankName)
      if (owners.size > 1 && a.owner) parts.push(useFullOwner ? a.owner : firstWord(a.owner))
      labels.set(a.id, parts.length > 0 ? `${a.name} (${parts.join(', ')})` : a.name)
    }
    const counts = new Map<string, number>()
    for (const a of group) {
      const l = labels.get(a.id)!
      counts.set(l, (counts.get(l) ?? 0) + 1)
    }
    for (const a of group) {
      const l = labels.get(a.id)!
      if ((counts.get(l) ?? 0) > 1) labels.set(a.id, `${l} …${a.id.slice(-4)}`)
    }
  }
  return labels
}
