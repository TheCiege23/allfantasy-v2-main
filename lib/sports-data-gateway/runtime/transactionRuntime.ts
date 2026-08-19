import 'server-only'
import crypto from 'node:crypto'
/**
 * Fantasy OS Phase 5D-b — Sleeper transaction synchronization (Parts 1–2).
 *
 * League+season scoped, certified, incremental over a bounded (optionally overlapping) week window. Type and
 * status are classified deterministically from provider fields — NEVER inferred from roster diffs. Unknown
 * provider values are retained as `unknown`, not dropped. Deterministic transaction + event ids ⇒ rerunning an
 * overlapping window creates 0 duplicate records/events.
 */
import type { SourceProvenance } from '../contracts'
import { resolveIdentity, type MappingSource } from '../resolution'
import { SportsRuntimeStore } from './store'
import { deterministicEventId } from './events'
import { canCertify, type SnapshotDraft, type SnapshotRecordDraft } from './snapshot'
import { fetchSleeperLeagueTransactions, type SleeperRawTxn } from '../providers/sleeper'

export type CanonicalTransactionType = 'trade' | 'waiver' | 'free_agent' | 'commissioner' | 'roster_adjustment' | 'unknown'
export type CanonicalTransactionStatus = 'pending' | 'complete' | 'failed' | 'cancelled' | 'unknown'

export type CanonicalLeagueTransaction = {
  canonicalTransactionId: string
  canonicalLeagueId: string
  providerTransactionId: string
  type: CanonicalTransactionType
  status: CanonicalTransactionStatus
  occurredAt: string | null
  rosterIds: string[]
  playerAdds: Record<string, string>
  playerDrops: Record<string, string>
  faabTransfers: Array<{ fromRosterId: string | null; toRosterId: string | null; amount: number }>
  draftPickTransfers: Array<{ season: string; round: number; originalRosterId: string | null; previousOwnerRosterId: string | null; newOwnerRosterId: string | null }>
  unresolvedPlayerCount: number
  source: SourceProvenance
}

export function normalizeTxnType(raw: string | undefined): CanonicalTransactionType {
  switch ((raw ?? '').toLowerCase()) {
    case 'trade': return 'trade'
    case 'waiver': return 'waiver'
    case 'free_agent': return 'free_agent'
    case 'commissioner': return 'commissioner'
    default: return 'unknown' // retained, never dropped
  }
}
export function normalizeTxnStatus(raw: string | undefined): CanonicalTransactionStatus {
  switch ((raw ?? '').toLowerCase()) {
    case 'complete': return 'complete'
    case 'failed': return 'failed'
    case 'cancelled':
    case 'canceled': return 'cancelled'
    case 'pending': return 'pending'
    default: return 'unknown'
  }
}

/** Pure Sleeper transaction → canonical (the seam). Type/status classified separately; identity resolved. */
export function normalizeSleeperTransaction(raw: SleeperRawTxn, leagueId: string, source: MappingSource): CanonicalLeagueTransaction {
  let unresolved = 0
  const resolve = (pid: string): string => {
    const r = resolveIdentity({ provider: 'sleeper', providerId: pid, sport: 'NFL' }, source)
    if (r.status === 'resolved' && r.canonicalPlayerId) return r.canonicalPlayerId
    unresolved++
    return `unresolved:sleeper:${pid}`
  }
  const rosterRef = (rid: number | undefined | null): string | null => (rid == null ? null : `sleeper:${leagueId}:${rid}`)
  const mapPlayers = (m: Record<string, number> | null | undefined): Record<string, string> => {
    const out: Record<string, string> = {}
    for (const [pid, rid] of Object.entries(m ?? {})) out[resolve(pid)] = rosterRef(rid) ?? ''
    return out
  }
  const fetchedAt = new Date().toISOString()
  return {
    canonicalTransactionId: `sleeper:${leagueId}:${raw.transaction_id ?? 'unknown'}`,
    canonicalLeagueId: `sleeper:${leagueId}`,
    providerTransactionId: String(raw.transaction_id ?? ''),
    type: normalizeTxnType(raw.type),
    status: normalizeTxnStatus(raw.status),
    occurredAt: raw.status_updated ? new Date(raw.status_updated).toISOString() : null,
    rosterIds: (raw.roster_ids ?? []).map((r) => `sleeper:${leagueId}:${r}`),
    playerAdds: mapPlayers(raw.adds),
    playerDrops: mapPlayers(raw.drops),
    faabTransfers: (raw.waiver_budget ?? []).map((w) => ({ fromRosterId: rosterRef(w.sender), toRosterId: rosterRef(w.receiver), amount: Number(w.amount ?? 0) })),
    draftPickTransfers: (raw.draft_picks ?? []).map((p) => ({ season: String(p.season ?? ''), round: Number(p.round ?? 0), originalRosterId: rosterRef(p.roster_id), previousOwnerRosterId: rosterRef(p.previous_owner_id), newOwnerRosterId: rosterRef(p.owner_id) })),
    unresolvedPlayerCount: unresolved,
    source: { primaryProvider: 'sleeper', providerRecordId: String(raw.transaction_id ?? ''), fetchedAt, sourceUpdatedAt: raw.status_updated ? new Date(raw.status_updated).toISOString() : null, snapshotVersion: '' },
  }
}

export function txnContentHash(t: CanonicalLeagueTransaction): string {
  return crypto.createHash('sha256').update(JSON.stringify({ ty: t.type, st: t.status, a: t.playerAdds, d: t.playerDrops, f: t.faabTransfers, dp: t.draftPickTransfers })).digest('hex')
}

const TYPE_EVENT: Record<CanonicalTransactionType, string> = {
  trade: 'trade_observed', waiver: 'waiver_observed', free_agent: 'free_agent_move_observed',
  commissioner: 'commissioner_adjustment_observed', roster_adjustment: 'commissioner_adjustment_observed', unknown: 'transaction_status_changed',
}

export type TransactionSyncResult = { certified: boolean; leagueId: string; season: string; snapshotId: string | null; txnCount: number; byType: Record<string, number>; unresolvedPlayers: number; eventsInserted: number; reason?: string; checkpoint: { lastWindow: string | null } }

/** Sync a bounded week window (overlap-safe via deterministic ids). Default weeks 1..maxWeeks. */
export async function runSleeperTransactionSync(input: { leagueId: string; season: string; mappingSource: MappingSource; maxWeeks?: number; store?: SportsRuntimeStore }): Promise<TransactionSyncResult> {
  const { leagueId, season } = input
  const store = input.store ?? new SportsRuntimeStore()
  const maxWeeks = input.maxWeeks ?? 4
  const weeks = Array.from({ length: maxWeeks }, (_, i) => i + 1)
  const rawAll: SleeperRawTxn[] = []
  for (const w of weeks) {
    const wk = await fetchSleeperLeagueTransactions(leagueId, w)
    if (Array.isArray(wk)) rawAll.push(...wk)
  }
  // Dedup provider transactions by transaction_id (overlap-safe).
  const byId = new Map<string, SleeperRawTxn>()
  for (const t of rawAll) if (t.transaction_id && !byId.has(t.transaction_id)) byId.set(t.transaction_id, t)
  const txns = [...byId.values()].map((t) => normalizeSleeperTransaction(t, leagueId, input.mappingSource))

  const scopeRef = `${leagueId}-${season}`
  const now = new Date().toISOString()
  const version = `nfl-txns-${scopeRef}-${now.slice(0, 10)}`
  const records: SnapshotRecordDraft[] = txns.map((t) => ({ canonicalKey: t.canonicalTransactionId, resolutionStatus: 'resolved', contentHash: txnContentHash(t), record: { ...t, source: { ...t.source, snapshotVersion: version } }, schemaValid: Boolean(t.providerTransactionId) }))
  const checksumKey = records.map((r) => `${r.canonicalKey}:${r.contentHash}`).sort().join('|')
  const snapshotId = `nfl-txns-${scopeRef}-${crypto.createHash('sha256').update(checksumKey).digest('hex').slice(0, 20)}`

  const prev = await store.previousCertifiedHashes('NFL', 'transactions', scopeRef)
  const unresolvedTotal = txns.reduce((a, t) => a + t.unresolvedPlayerCount, 0)
  const draft: SnapshotDraft = {
    snapshotId, version, sport: 'NFL', capability: 'transactions', provider: 'sleeper', generatedAt: now, sourceUpdatedAt: null,
    records, rejectedCount: records.filter((r) => !r.schemaValid).length, runPartial: false, scopeComplete: true, previousSnapshotId: prev.snapshotId,
    limitations: unresolvedTotal > 0 ? [`${unresolvedTotal} transaction player references unresolved (quarantined).`] : [], scopeRef,
  }
  const decision = canCertify(draft)
  if (!decision.certifiable) return { certified: false, leagueId, season, snapshotId: null, txnCount: txns.length, byType: {}, unresolvedPlayers: unresolvedTotal, eventsInserted: 0, reason: decision.reasons.join('; '), checkpoint: { lastWindow: null } }

  await store.persistCertifiedSnapshot(draft)
  // Only emit events for transactions not already certified (changed content vs previous).
  const events = txns
    .filter((t) => prev.hashes.get(t.canonicalTransactionId) !== txnContentHash(t))
    .map((t) => ({ eventId: deterministicEventId(TYPE_EVENT[t.type], t.canonicalTransactionId, version, txnContentHash(t)), eventType: TYPE_EVENT[t.type], entityId: t.canonicalTransactionId, contentHash: txnContentHash(t), record: t }))
  const inserted = await store.insertEvents(events, { sport: 'NFL', provider: 'sleeper', snapshotVersion: version, occurredAt: now })

  const byType: Record<string, number> = {}
  for (const t of txns) byType[t.type] = (byType[t.type] ?? 0) + 1
  return { certified: true, leagueId, season, snapshotId, txnCount: txns.length, byType, unresolvedPlayers: unresolvedTotal, eventsInserted: inserted, checkpoint: { lastWindow: `w1-w${maxWeeks}` } }
}
