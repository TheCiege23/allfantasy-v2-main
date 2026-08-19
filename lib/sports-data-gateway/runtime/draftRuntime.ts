import 'server-only'
import crypto from 'node:crypto'
/**
 * Fantasy OS Phase 5D-c — Sleeper draft synchronization + pick-ownership reconciliation (Parts 9–11).
 *
 * League-scoped, certified, deterministic. Player ids resolve to canonical identity (unresolved quarantined).
 * Completed drafts are treated as immutable (cached; not refetched). Pick-ownership conflicts (draft vs
 * transaction vs current provider) are explicit, never silently overwritten.
 */
import type { SourceProvenance } from '../contracts'
import { resolveIdentity, type MappingSource } from '../resolution'
import { SportsRuntimeStore } from './store'
import { deterministicEventId } from './events'
import { canCertify, type SnapshotDraft, type SnapshotRecordDraft } from './snapshot'
import { fetchSleeperLeagueDrafts, fetchSleeperDraftPicks, type SleeperRawDraft, type SleeperRawPick } from '../providers/sleeper'

export type CanonicalDraft = {
  canonicalDraftId: string; canonicalLeagueId: string; providerDraftId: string; season: string
  type: 'startup' | 'rookie' | 'supplemental' | 'redraft' | 'unknown'
  status: 'pre_draft' | 'drafting' | 'paused' | 'complete' | 'unknown'
  rounds: number | null; teams: number | null; startedAt: string | null; completedAt: string | null; source: SourceProvenance
}
export type CanonicalDraftPick = {
  canonicalDraftPickId: string; canonicalDraftId: string; canonicalLeagueId: string
  canonicalPlayerId: string | null; providerPlayerId: string | null
  round: number; pickNumber: number; draftSlot: number | null
  draftingRosterId: string | null; originalRosterId: string | null; finalOwnerRosterId: string | null
  pickedAt: string | null; identityStatus: 'resolved' | 'ambiguous' | 'unresolved' | 'conflicting'; source: SourceProvenance
}


export function normalizeDraftStatus(s: string | undefined): CanonicalDraft['status'] {
  switch ((s ?? '').toLowerCase()) {
    case 'complete': return 'complete'
    case 'drafting': return 'drafting'
    case 'paused': return 'paused'
    case 'pre_draft': return 'pre_draft'
    default: return 'unknown'
  }
}

export function normalizeDraft(raw: SleeperRawDraft, leagueId: string, fetchedAt: string, version: string): CanonicalDraft {
  return {
    canonicalDraftId: `sleeper:${leagueId}:${raw.draft_id}`,
    canonicalLeagueId: `sleeper:${leagueId}`,
    providerDraftId: String(raw.draft_id ?? ''),
    season: String(raw.season ?? ''),
    type: 'unknown', // Sleeper draft.type is snake/linear (order), not startup/rookie — canonical type needs league context
    status: normalizeDraftStatus(raw.status),
    rounds: raw.settings?.rounds ?? null,
    teams: raw.settings?.teams ?? null,
    startedAt: raw.start_time ? new Date(raw.start_time).toISOString() : null,
    completedAt: raw.status === 'complete' && raw.start_time ? null : null,
    source: { primaryProvider: 'sleeper', providerRecordId: String(raw.draft_id ?? ''), fetchedAt, sourceUpdatedAt: null, snapshotVersion: version },
  }
}

export function normalizeDraftPick(raw: SleeperRawPick, draftId: string, leagueId: string, source: MappingSource, fetchedAt: string, version: string): CanonicalDraftPick {
  let identityStatus: CanonicalDraftPick['identityStatus'] = 'unresolved'
  let canonicalPlayerId: string | null = null
  if (raw.player_id) {
    const r = resolveIdentity({ provider: 'sleeper', providerId: raw.player_id, sport: 'NFL' }, source)
    identityStatus = r.status
    canonicalPlayerId = r.status === 'resolved' ? r.canonicalPlayerId : `unresolved:sleeper:${raw.player_id}`
  }
  const rosterRef = (rid: number | undefined) => (rid == null ? null : `sleeper:${leagueId}:${rid}`)
  return {
    canonicalDraftPickId: `sleeper:${leagueId}:${draftId}:${raw.pick_no}`,
    canonicalDraftId: `sleeper:${leagueId}:${draftId}`,
    canonicalLeagueId: `sleeper:${leagueId}`,
    canonicalPlayerId,
    providerPlayerId: raw.player_id ?? null,
    round: Number(raw.round ?? 0),
    pickNumber: Number(raw.pick_no ?? 0),
    draftSlot: raw.draft_slot ?? null,
    draftingRosterId: rosterRef(raw.roster_id),
    originalRosterId: rosterRef(raw.roster_id),
    finalOwnerRosterId: rosterRef(raw.roster_id),
    pickedAt: null,
    identityStatus,
    source: { primaryProvider: 'sleeper', providerRecordId: String(raw.pick_no ?? ''), fetchedAt, sourceUpdatedAt: null, snapshotVersion: version },
  }
}

// ── Pick ownership reconciliation (Part 11) ─────────────────────────────────────
export type DraftPickOwnershipEvidence = {
  canonicalDraftPickId: string; draftSnapshotOwner: string | null; transactionEvidenceOwner: string | null; currentProviderOwner: string | null
  status: 'resolved' | 'conflicting' | 'insufficient_evidence'; evidenceIds: string[]
}
export function reconcilePickOwnership(input: { canonicalDraftPickId: string; draftSnapshotOwner: string | null; transactionEvidenceOwner: string | null; currentProviderOwner: string | null }): DraftPickOwnershipEvidence {
  const owners = [input.draftSnapshotOwner, input.transactionEvidenceOwner, input.currentProviderOwner].filter((o): o is string => o != null)
  const distinct = new Set(owners)
  const evidenceIds = [input.canonicalDraftPickId]
  if (distinct.size === 0) return { ...input, status: 'insufficient_evidence', evidenceIds }
  if (distinct.size === 1) return { ...input, status: 'resolved', evidenceIds }
  return { ...input, status: 'conflicting', evidenceIds } // never silently pick one
}

function contentHash(o: unknown): string { return crypto.createHash('sha256').update(JSON.stringify(o)).digest('hex') }

export type DraftSyncResult = { certified: boolean; leagueId: string; draftCount: number; pickCount: number; resolvedPicks: number; unresolvedPicks: number; eventsInserted: number; immutableReused: number; reason?: string }

export async function runSleeperDraftSync(input: { leagueId: string; mappingSource: MappingSource; store?: SportsRuntimeStore }): Promise<DraftSyncResult> {
  const { leagueId } = input
  const store = input.store ?? new SportsRuntimeStore()
  const rawDrafts = await fetchSleeperLeagueDrafts(leagueId)
  if (!rawDrafts || rawDrafts.length === 0) return { certified: false, leagueId, draftCount: 0, pickCount: 0, resolvedPicks: 0, unresolvedPicks: 0, eventsInserted: 0, immutableReused: 0, reason: 'no drafts' }

  const now = new Date().toISOString()
  const scopeRef = leagueId
  const version = `nfl-draft-${leagueId}-${now.slice(0, 10)}`
  const records: SnapshotRecordDraft[] = []
  let pickCount = 0, resolved = 0, unresolved = 0, immutableReused = 0
  const pickEvents: { eventId: string; eventType: string; entityId: string; contentHash: string; record: unknown }[] = []

  // Previous certified draft snapshot (for immutable-completed reuse + pick dedup).
  const prevHashes = (await store.previousCertifiedHashes('NFL', 'draft_data', scopeRef)).hashes

  for (const rd of rawDrafts) {
    const draft = normalizeDraft(rd, leagueId, now, version)
    records.push({ canonicalKey: draft.canonicalDraftId, resolutionStatus: 'resolved', contentHash: contentHash({ s: draft.status, r: draft.rounds, t: draft.teams }), record: draft, schemaValid: Boolean(draft.providerDraftId) })
    // Immutable completed draft already certified with same content → reuse cache, skip pick refetch.
    const priorDraftHash = prevHashes.get(draft.canonicalDraftId)
    if (draft.status === 'complete' && priorDraftHash === contentHash({ s: draft.status, r: draft.rounds, t: draft.teams })) { immutableReused++; continue }

    const rawPicks = (await fetchSleeperDraftPicks(String(rd.draft_id))) ?? []
    for (const rp of rawPicks) {
      const pick = normalizeDraftPick(rp, String(rd.draft_id), leagueId, input.mappingSource, now, version)
      records.push({ canonicalKey: pick.canonicalDraftPickId, resolutionStatus: pick.identityStatus === 'resolved' ? 'resolved' : pick.identityStatus, contentHash: contentHash(pick), record: pick, schemaValid: true })
      pickCount++
      if (pick.identityStatus === 'resolved') resolved++; else unresolved++
      const h = contentHash(pick)
      if (prevHashes.get(pick.canonicalDraftPickId) !== h) {
        pickEvents.push({ eventId: deterministicEventId('draft_pick_made', pick.canonicalDraftPickId, version, h), eventType: 'draft_pick_made', entityId: pick.canonicalDraftPickId, contentHash: h, record: { pick: pick.pickNumber, player: pick.canonicalPlayerId } })
      }
    }
  }

  const checksumKey = records.map((r) => `${r.canonicalKey}:${r.contentHash}`).sort().join('|')
  const snapshotId = `nfl-draft-${leagueId}-${crypto.createHash('sha256').update(checksumKey).digest('hex').slice(0, 20)}`
  const draftSnap: SnapshotDraft = {
    snapshotId, version, sport: 'NFL', capability: 'draft_data', provider: 'sleeper', generatedAt: now, sourceUpdatedAt: null,
    records, rejectedCount: 0, runPartial: false, scopeComplete: true, previousSnapshotId: (await store.previousCertifiedHashes('NFL', 'draft_data', scopeRef)).snapshotId,
    limitations: unresolved > 0 ? [`${unresolved} draft picks have unresolved player identity (quarantined).`] : [], scopeRef,
  }
  const decision = canCertify(draftSnap)
  if (!decision.certifiable) return { certified: false, leagueId, draftCount: rawDrafts.length, pickCount, resolvedPicks: resolved, unresolvedPicks: unresolved, eventsInserted: 0, immutableReused, reason: decision.reasons.join('; ') }

  await store.persistCertifiedSnapshot(draftSnap)
  const inserted = await store.insertEvents(pickEvents, { sport: 'NFL', provider: 'sleeper', snapshotVersion: version, occurredAt: now })
  return { certified: true, leagueId, draftCount: rawDrafts.length, pickCount, resolvedPicks: resolved, unresolvedPicks: unresolved, eventsInserted: inserted, immutableReused }
}
