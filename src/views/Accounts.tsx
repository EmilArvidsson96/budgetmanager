import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Wallet,
  AlertTriangle,
  ArrowUpRight,
  ArrowDownRight,
  Upload,
  Settings as SettingsIcon,
  Pencil,
  Check,
  X,
  RotateCcw,
  Archive,
  Trash2,
} from 'lucide-react'
import { useAppStore } from '@/store'
import { Layout, PageHeader } from '@/components/layout/Layout'
import { Card, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Sparkline } from '@/components/report/charts'
import { classifyAccount } from '@/utils/projection'
import { formatCurrency } from '@/utils/budgetHelpers'
import type { Account, AccountType, ImportSnapshot } from '@/types'

const TYPE_LABELS: Record<AccountType, string> = {
  checking:   'Lönekonto',
  savings:    'Sparkonto',
  credit:     'Kreditkort',
  loan:       'Lån',
  isk:        'ISK',
  investment: 'Investeringskonto',
  property:   'Bostad / fastighet',
  other:      'Övrigt',
}

// Display order inside an owner group: everyday money first, then growth
// assets, then property/other, then debt.
const TYPE_ORDER: AccountType[] = ['checking', 'savings', 'isk', 'investment', 'property', 'other', 'credit', 'loan']

const NO_OWNER = '__none__'

function fmtDate(iso: string): string {
  const d = new Date(iso)
  return isNaN(d.getTime()) ? iso.slice(0, 10) : d.toLocaleDateString('sv-SE')
}

// Current value of an account, mirroring the projection's starting-balance rules:
// liabilities read the snapshot (falling back to the configured loan balance),
// assets let a manual value override the imported one (a property only has the
// manual value).
function accountValue(acc: Account, snapMap: Map<string, number>): number {
  const snap = snapMap.get(acc.id)
  if (classifyAccount(acc) === 'liability') {
    if (snap !== undefined) return snap
    return acc.loanBalance != null ? -Math.abs(acc.loanBalance) : 0
  }
  return acc.manualValue ?? snap ?? 0
}

interface AccountInfo {
  account: Account
  value: number
  isManual: boolean                    // value comes from manualValue, not an import
  history: { label: string; value: number }[]
  lastChangedAt: string | null         // last import where the balance moved
  lastCoveredAt: string | null         // last import that actually CONTAINED the account
  missingSince: string | null          // newer import covered this owner without the account
}

export function AccountsView() {
  const store = useAppStore()
  const navigate = useNavigate()
  const { accounts } = store.settings
  const [editingOwnerId, setEditingOwnerId] = useState<string | null>(null)
  const [ownerDraft, setOwnerDraft] = useState('')

  const snapshots = useMemo(
    () => [...store.importSnapshots].sort((a, b) => a.importedAt.localeCompare(b.importedAt)),
    [store.importSnapshots]
  )
  const latestSnapshot: ImportSnapshot | null = snapshots.length > 0 ? snapshots[snapshots.length - 1] : null

  const infos = useMemo<Map<string, AccountInfo>>(() => {
    const snapMap = new Map<string, number>(
      (latestSnapshot?.accountBalances ?? []).map((ab) => [ab.accountId, ab.balance])
    )
    // Snapshots that know which account ids the upload actually contained
    // (recorded from v16 on) — the basis for "missing from the last import".
    const covering = snapshots.filter((s) => s.importedAccountIds && s.owner)

    const map = new Map<string, AccountInfo>()
    for (const acc of accounts) {
      const history: { label: string; value: number }[] = []
      let lastChangedAt: string | null = null
      let prev: number | undefined
      for (const s of snapshots) {
        const ab = s.accountBalances.find((b) => b.accountId === acc.id)
        if (!ab) continue
        history.push({ label: fmtDate(s.importedAt), value: ab.balance })
        if (prev === undefined || Math.abs(ab.balance - prev) > 0.005) lastChangedAt = s.importedAt
        prev = ab.balance
      }

      let lastCoveredAt: string | null = null
      let missingSince: string | null = null
      const ownerKey = acc.owner?.trim().toLowerCase()
      for (const s of covering) {
        if (s.importedAccountIds!.includes(acc.id)) {
          lastCoveredAt = s.importedAt
          missingSince = null
        } else if (ownerKey && s.owner!.trim().toLowerCase() === ownerKey) {
          // an import for this owner that no longer contains the account
          missingSince = s.importedAt
        }
      }
      // Only flag accounts that imports have actually tracked at some point.
      if (history.length === 0) missingSince = null

      map.set(acc.id, {
        account: acc,
        value: accountValue(acc, snapMap),
        isManual: classifyAccount(acc) !== 'liability' && acc.manualValue != null,
        history,
        lastChangedAt,
        lastCoveredAt,
        missingSince: acc.closedAt ? null : missingSince,
      })
    }
    return map
  }, [accounts, snapshots, latestSnapshot])

  const openAccounts = accounts.filter((a) => !a.closedAt)
  const closedAccounts = accounts.filter((a) => a.closedAt)

  // ── Totals (open accounts counting toward net worth) ────────────────────────
  const totals = useMemo(() => {
    let liquid = 0, invested = 0, debt = 0
    for (const a of openAccounts) {
      if (a.includeInNetWorth === false) continue
      const v = infos.get(a.id)?.value ?? 0
      const role = classifyAccount(a)
      if (role === 'liability') debt += v
      else if (role === 'liquid') liquid += v
      else invested += v
    }
    return { liquid, invested, debt, net: liquid + invested + debt }
  }, [openAccounts, infos])

  // ── Owner groups ─────────────────────────────────────────────────────────────
  const groups = useMemo(() => {
    const byOwner = new Map<string, Account[]>()
    for (const a of openAccounts) {
      const key = a.owner?.trim() || NO_OWNER
      byOwner.set(key, [...(byOwner.get(key) ?? []), a])
    }
    const sortAccounts = (list: Account[]) =>
      [...list].sort(
        (a, b) =>
          TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type) || a.name.localeCompare(b.name, 'sv')
      )
    return [...byOwner.entries()]
      .sort(([a], [b]) => (a === NO_OWNER ? 1 : b === NO_OWNER ? -1 : a.localeCompare(b, 'sv')))
      .map(([owner, list]) => ({ owner, accounts: sortAccounts(list) }))
  }, [openAccounts])

  // Balance entries still being carried forward for accounts that no longer
  // exist in settings — stale leftovers (e.g. from the old name-only keying).
  const orphanBalances = useMemo(() => {
    if (!latestSnapshot) return []
    const known = new Set(accounts.map((a) => a.id))
    return latestSnapshot.accountBalances.filter((ab) => !known.has(ab.accountId))
  }, [latestSnapshot, accounts])

  // Latest covering import per owner, for the import-status card.
  const coverage = useMemo(() => {
    const m = new Map<string, { at: string; count: number }>()
    for (const s of snapshots) {
      if (!s.owner || !s.importedAccountIds) continue
      m.set(s.owner, { at: s.importedAt, count: s.importedAccountIds.length })
    }
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b, 'sv'))
  }, [snapshots])

  const missingCount = [...infos.values()].filter((i) => i.missingSince).length
  const noOwnerCount = openAccounts.filter((a) => !a.owner?.trim()).length

  const startOwnerEdit = (a: Account) => {
    setEditingOwnerId(a.id)
    setOwnerDraft(a.owner ?? '')
  }
  const saveOwner = (a: Account) => {
    store.upsertAccount({ ...a, owner: ownerDraft.trim() || undefined })
    setEditingOwnerId(null)
  }

  const knownOwners = [...new Set(accounts.map((a) => a.owner?.trim()).filter((o): o is string => Boolean(o)))]

  return (
    <Layout>
      <PageHeader
        title="Konton"
        subtitle="Saldon per ägare, förändring över tid och importstatus"
        actions={
          <>
            <Button variant="secondary" size="sm" onClick={() => navigate('/importera')}>
              <Upload className="w-4 h-4" /> Importera
            </Button>
            <Button variant="secondary" size="sm" onClick={() => navigate('/installningar?tab=accounts')}>
              <SettingsIcon className="w-4 h-4" /> Hantera
            </Button>
          </>
        }
      />

      {accounts.length === 0 ? (
        <Card className="text-center py-12">
          <Wallet className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500 mb-4">Inga konton ännu. Importera din Zlantar-export för att komma igång.</p>
          <Button onClick={() => navigate('/importera')}><Upload className="w-4 h-4" /> Importera från Zlantar</Button>
        </Card>
      ) : (
        <div className="space-y-4">
          {/* ── Totals ── */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatTile label="Likvida medel" value={totals.liquid} />
            <StatTile label="Sparande & investeringar" value={totals.invested} />
            <StatTile label="Lån & krediter" value={totals.debt} />
            <StatTile label="Netto" value={totals.net} emphasis />
          </div>

          {/* ── Data-quality warnings ── */}
          {(missingCount > 0 || noOwnerCount > 0 || orphanBalances.length > 0) && (
            <Card>
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-500 mt-0.5 shrink-0" />
                <div className="text-sm text-gray-600 space-y-1">
                  {missingCount > 0 && (
                    <p>
                      <strong>{missingCount}</strong> {missingCount === 1 ? 'konto saknades' : 'konton saknades'} i
                      ägarens senaste import — markerade nedan. Avsluta dem om de tagits bort hos banken.
                    </p>
                  )}
                  {noOwnerCount > 0 && (
                    <p>
                      <strong>{noOwnerCount}</strong> {noOwnerCount === 1 ? 'konto saknar' : 'konton saknar'} ägare.
                      Sätt ägare så att överföringar mellan er kan stämmas av och kontona inte kan förväxlas.
                    </p>
                  )}
                  {orphanBalances.length > 0 && (
                    <p>
                      <strong>{orphanBalances.length}</strong> {orphanBalances.length === 1 ? 'saldopost' : 'saldoposter'} hör
                      inte till något konto — se längst ned.
                    </p>
                  )}
                </div>
              </div>
            </Card>
          )}

          {/* ── Accounts, grouped by owner ── */}
          {groups.map(({ owner, accounts: list }, gi) => {
            const sum = list
              .filter((a) => a.includeInNetWorth !== false)
              .reduce((s, a) => s + (infos.get(a.id)?.value ?? 0), 0)
            return (
              <Card key={owner} padding={false}>
                <div className="p-4 border-b border-gray-100 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <h3 className="font-semibold text-gray-900 truncate">
                      {owner === NO_OWNER ? 'Utan ägare' : owner}
                    </h3>
                    <span className="text-xs text-gray-400">{list.length} {list.length === 1 ? 'konto' : 'konton'}</span>
                    {owner === NO_OWNER && <Badge variant="amber">Sätt ägare</Badge>}
                  </div>
                  <span className={`text-sm font-semibold tabular-nums ${sum < 0 ? 'text-red-600' : 'text-gray-800'}`}>
                    {formatCurrency(sum)}
                  </span>
                </div>
                <div className="divide-y divide-gray-50">
                  {list.map((a, i) => {
                    const info = infos.get(a.id)!
                    return (
                      <AccountRow
                        key={a.id}
                        info={info}
                        sparkId={`acct-${gi}-${i}`}
                        editingOwner={editingOwnerId === a.id}
                        ownerDraft={ownerDraft}
                        knownOwners={knownOwners}
                        onOwnerDraft={setOwnerDraft}
                        onStartOwnerEdit={() => startOwnerEdit(a)}
                        onSaveOwner={() => saveOwner(a)}
                        onCancelOwnerEdit={() => setEditingOwnerId(null)}
                        onClose={() => store.markAccountClosed(a.id)}
                      />
                    )
                  })}
                </div>
              </Card>
            )
          })}

          {/* ── Closed accounts ── */}
          {closedAccounts.length > 0 && (
            <Card padding={false}>
              <div className="p-4 border-b border-gray-100">
                <h3 className="font-semibold text-gray-900">Avslutade konton</h3>
                <p className="text-sm text-gray-500">Räknas inte med i saldon. Historiken finns kvar.</p>
              </div>
              <div className="divide-y divide-gray-50">
                {closedAccounts.map((a) => (
                  <div key={a.id} className="flex items-center justify-between gap-3 px-4 py-3 opacity-70">
                    <div className="min-w-0 flex items-center gap-2">
                      <Archive className="w-4 h-4 text-gray-300 shrink-0" />
                      <div className="min-w-0">
                        <span className="text-sm font-medium text-gray-700">{a.name}</span>
                        <span className="text-xs text-gray-400 ml-2">
                          {a.bankName ?? '–'} · avslutat {fmtDate(a.closedAt!)}
                        </span>
                      </div>
                      {a.owner && <Badge variant="gray">{a.owner}</Badge>}
                    </div>
                    <Button size="sm" variant="secondary" onClick={() => store.reopenAccount(a.id)}>
                      <RotateCcw className="w-4 h-4" /> Återöppna
                    </Button>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* ── Orphaned balance entries ── */}
          {orphanBalances.length > 0 && (
            <Card padding={false}>
              <div className="p-4 border-b border-gray-100">
                <h3 className="font-semibold text-gray-900">Saldoposter utan konto</h3>
                <p className="text-sm text-gray-500">
                  Hör inte till något av dina konton — t.ex. rester från äldre importer där konton
                  med samma namn blandades ihop. De räknas inte med i summorna ovan men följer med
                  i varje ny ögonblicksbild tills du rensar dem.
                </p>
              </div>
              <div className="divide-y divide-gray-50">
                {orphanBalances.map((ab) => (
                  <div key={ab.accountId} className="flex items-center justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <span className="text-sm font-medium text-gray-700">{ab.accountName}</span>
                      <span className="text-xs text-gray-400 ml-2">
                        {[
                          TYPE_LABELS[ab.accountType] !== ab.accountName ? TYPE_LABELS[ab.accountType] : null,
                          ab.owner,
                        ].filter(Boolean).join(' · ')}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-sm text-gray-600 tabular-nums">{formatCurrency(ab.balance)}</span>
                      <button
                        onClick={() => store.dropCarriedBalance(ab.accountId)}
                        className="p-1 text-gray-300 hover:text-red-500 rounded transition-colors"
                        title="Rensa saldopost (slutar räknas med)"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* ── Import status ── */}
          <Card>
            <CardHeader
              title="Importstatus"
              subtitle="Så färsk är kontoinformationen per ägare"
            />
            {coverage.length > 0 ? (
              <div className="space-y-1.5">
                {coverage.map(([owner, c]) => (
                  <div key={owner} className="flex items-center justify-between text-sm">
                    <span className="text-gray-700 font-medium">{owner}</span>
                    <span className="text-gray-500">
                      {c.count} konton · senaste import {fmtDate(c.at)}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-400">
                Ingen import med kontoinformation ännu — ägarspårning aktiveras vid nästa import av data.json.
              </p>
            )}
            {latestSnapshot && (
              <p className="text-xs text-gray-400 mt-3">
                Senaste ögonblicksbild {fmtDate(latestSnapshot.importedAt)} · {latestSnapshot.accountBalances.length} saldoposter
                · {snapshots.length} ögonblicksbilder totalt
              </p>
            )}
          </Card>
        </div>
      )}
    </Layout>
  )
}

// ─── Stat tile ─────────────────────────────────────────────────────────────────

function StatTile({ label, value, emphasis = false }: { label: string; value: number; emphasis?: boolean }) {
  return (
    <Card className="!p-4">
      <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1">{label}</p>
      <p className={`tabular-nums font-semibold ${emphasis ? 'text-xl' : 'text-lg'} ${value < 0 ? 'text-red-600' : 'text-gray-900'}`}>
        {formatCurrency(value)}
      </p>
    </Card>
  )
}

// ─── Account row ───────────────────────────────────────────────────────────────

function AccountRow({
  info,
  sparkId,
  editingOwner,
  ownerDraft,
  knownOwners,
  onOwnerDraft,
  onStartOwnerEdit,
  onSaveOwner,
  onCancelOwnerEdit,
  onClose,
}: {
  info: AccountInfo
  sparkId: string
  editingOwner: boolean
  ownerDraft: string
  knownOwners: string[]
  onOwnerDraft: (v: string) => void
  onStartOwnerEdit: () => void
  onSaveOwner: () => void
  onCancelOwnerEdit: () => void
  onClose: () => void
}) {
  const { account: a, value, isManual, history, lastChangedAt, missingSince } = info
  const delta = history.length >= 2 ? history[history.length - 1].value - history[history.length - 2].value : null

  return (
    <div className="px-4 py-3">
      <div className="flex items-center gap-3">
        {/* Name + meta */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-gray-800 truncate">{a.name}</span>
            {editingOwner ? (
              <span className="inline-flex items-center gap-1">
                <input
                  autoFocus
                  className="border border-gray-200 rounded-md px-2 py-0.5 text-xs w-28 focus:outline-none focus:ring-2 focus:ring-brand-500"
                  value={ownerDraft}
                  placeholder="Ägare"
                  list="konton-owners"
                  onChange={(e) => onOwnerDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') onSaveOwner()
                    if (e.key === 'Escape') onCancelOwnerEdit()
                  }}
                />
                <datalist id="konton-owners">
                  {knownOwners.map((o) => <option key={o} value={o} />)}
                </datalist>
                <button onClick={onSaveOwner} className="p-0.5 text-emerald-600 hover:text-emerald-700" title="Spara ägare">
                  <Check className="w-4 h-4" />
                </button>
                <button onClick={onCancelOwnerEdit} className="p-0.5 text-gray-400 hover:text-gray-600" title="Avbryt">
                  <X className="w-4 h-4" />
                </button>
              </span>
            ) : (
              <button
                onClick={onStartOwnerEdit}
                className="group inline-flex items-center gap-1"
                title="Ändra ägare"
              >
                {a.owner
                  ? <Badge variant="blue">{a.owner}</Badge>
                  : <Badge variant="amber">Ägare saknas</Badge>}
                <Pencil className="w-3 h-3 text-gray-300 group-hover:text-brand-600" />
              </button>
            )}
            <Badge variant={a.type === 'loan' || a.type === 'credit' ? 'red' : a.type === 'savings' || a.type === 'isk' || a.type === 'investment' ? 'blue' : 'gray'}>
              {TYPE_LABELS[a.type]}
            </Badge>
            {isManual && <Badge variant="gray">Manuellt värde</Badge>}
            {a.includeInLiquidity === false && a.type !== 'loan' && a.type !== 'credit' && a.type !== 'property' && (
              <Badge variant="gray">Ej likviditet</Badge>
            )}
          </div>
          <p className="text-xs text-gray-400 mt-0.5">
            {a.bankName ?? '–'}
            {lastChangedAt && <> · saldo ändrat {fmtDate(lastChangedAt)}</>}
            {isManual && !lastChangedAt && <> · ej i importer</>}
          </p>
          {missingSince && (
            <div className="mt-1.5 flex items-center gap-2 flex-wrap">
              <Badge variant="amber">
                <AlertTriangle className="w-3 h-3 mr-1" /> Saknades i importen {fmtDate(missingSince)}
              </Badge>
              <button
                onClick={onClose}
                className="text-xs text-red-500 hover:text-red-700 hover:underline"
              >
                Markera som avslutat
              </button>
            </div>
          )}
        </div>

        {/* Balance history sparkline */}
        {history.length >= 2 && (
          <div className="hidden sm:block w-24 shrink-0">
            <Sparkline data={history} height={30} color="#64748b" fillId={sparkId} />
          </div>
        )}

        {/* Value */}
        <div className="text-right shrink-0">
          <p className={`text-sm font-semibold tabular-nums ${value < 0 ? 'text-red-600' : 'text-gray-800'}`}>
            {formatCurrency(value)}
          </p>
          {delta !== null && Math.abs(delta) > 0.005 && (
            <p className={`text-xs tabular-nums flex items-center justify-end gap-0.5 ${delta > 0 ? 'text-emerald-600' : 'text-red-500'}`}>
              {delta > 0 ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
              {formatCurrency(Math.abs(delta))}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
