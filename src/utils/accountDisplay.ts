import type { Account } from '@/types'

const SELF_REFERENTIAL_OWNERS = new Set(['mig', 'jag', 'me'])

// First word of the owner label — keeps the disambiguation short ("Emil
// Johan Theodor" → "Emil") instead of echoing a full name. When the account
// is owned by a self-referential placeholder ("Mig"/"Jag"), substitutes the
// user's own configured name so the label reads as an actual name.
function ownerShortLabel(owner: string | undefined, myName?: string): string | undefined {
  const trimmed = owner?.trim()
  if (!trimmed) return undefined
  const source = SELF_REFERENTIAL_OWNERS.has(trimmed.toLowerCase()) ? (myName?.trim() || trimmed) : trimmed
  return source.split(/\s+/)[0]
}

// Maps accountId → display name. An account keeps its plain name unless
// another account shares the exact same name, in which case the owner's
// first name is appended in parentheses, e.g. "Sparkonto (Emil)" /
// "Sparkonto (Anna)". Falls back to also appending the bank name when two
// accounts with the same name also share the same owner label.
export function buildAccountDisplayNames(accounts: Account[], myName?: string): Map<string, string> {
  const groups = new Map<string, Account[]>()
  for (const a of accounts) {
    const key = a.name.trim().toLowerCase()
    const group = groups.get(key)
    if (group) group.push(a)
    else groups.set(key, [a])
  }

  const names = new Map<string, string>()
  for (const group of groups.values()) {
    if (group.length === 1) {
      names.set(group[0].id, group[0].name)
      continue
    }
    for (const a of group) {
      const label = ownerShortLabel(a.owner, myName)
      if (!label) {
        names.set(a.id, a.name)
        continue
      }
      const stillAmbiguous = group.some(
        (other) => other.id !== a.id && ownerShortLabel(other.owner, myName) === label
      )
      names.set(
        a.id,
        stillAmbiguous && a.bankName ? `${a.name} (${label} · ${a.bankName})` : `${a.name} (${label})`
      )
    }
  }
  return names
}
