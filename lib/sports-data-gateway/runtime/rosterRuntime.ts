import 'server-only'
import crypto from 'node:crypto'
/**
 * Fantasy OS Phase 5D — Sleeper roster synchronization scope (Part 1).
 *
 * League-scoped, incremental, certified. Player ids resolve to canonical identity (unresolved ⇒ quarantined,
 * kept as `unresolved:sleeper:<id>`, never dropped). Roster membership diff emits per-player added/removed/moved
 * events (deterministic ids ⇒ no duplicates on rerun). Never infers a change's acquisition source (that needs
 * transaction evidence). Freshness/checkpoint advance only after certification (handled by the caller/runner).
 */
import { resolveIdentity, type MappingSource } from '../resolution'
import { SportsRuntimeStore } from './store'
import { deterministicEventId } from './events'
import { canCertify, type SnapshotDraft, type SnapshotRecordDraft } from './snapshot'
import { fetchSleeperRosters, type SleeperRawRoster } from '../providers/sleeper'

export type CanonicalRosterSnapshot = {
  canonicalLeagueId: string
  canonicalRosterId: string
  canonicalManagerId: string | null
  season: string
  playerIds: string[]
  starterIds: string[]
  reserveIds: string[]
  taxiIds: string[]
  injuredReserveIds: string[]
  providerRosterId: string
  unresolvedCount: number
  sourceUpdatedAt: string | null
}

/** Pure Sleeper roster → canonical (the seam). Resolves player ids; unresolved kept as quarantined refs. */
export function normalizeSleeperRoster(raw: SleeperRawRoster, leagueId: string, season: string, source: MappingSource): CanonicalRosterSnapshot {
  const players = (raw.players ?? []).filter((p) => p && p !== '0')
  const starters = (raw.starters ?? []).filter((p) => p && p !== '0')
  const ir = (raw.reserve ?? []).filter(Boolean)
  const taxi = (raw.taxi ?? []).filter(Boolean)
  const bench = players.filter((p) => !starters.includes(p) && !ir.includes(p) && !taxi.includes(p))

  // Resolve each UNIQUE provider id once (so unresolvedCount counts distinct players, not list occurrences).
  const uniqueIds = [...new Set([...players, ...starters, ...ir, ...taxi])]
  const resolvedMap = new Map<string, string>()
  let unresolved = 0
  for (const id of uniqueIds) {
    const r = resolveIdentity({ provider: 'sleeper', providerId: id, sport: 'NFL' }, source)
    if (r.status === 'resolved' && r.canonicalPlayerId) resolvedMap.set(id, r.canonicalPlayerId)
    else {
      unresolved++
      resolvedMap.set(id, `unresolved:sleeper:${id}`)
    }
  }
  const resolve = (id: string): string => resolvedMap.get(id) ?? `unresolved:sleeper:${id}`
  return {
    canonicalLeagueId: `sleeper:${leagueId}`,
    canonicalRosterId: `sleeper:${leagueId}:${raw.roster_id}`,
    canonicalManagerId: raw.owner_id ? `sleeper:${raw.owner_id}` : null,
    season,
    playerIds: players.map(resolve),
    starterIds: starters.map(resolve),
    reserveIds: bench.map(resolve),
    taxiIds: taxi.map(resolve),
    injuredReserveIds: ir.map(resolve),
    providerRosterId: String(raw.roster_id),
    unresolvedCount: unresolved,
    sourceUpdatedAt: null,
  }
}

export function rosterContentHash(r: CanonicalRosterSnapshot): string {
  const body = JSON.stringify({ p: [...r.playerIds].sort(), s: [...r.starterIds].sort(), ir: [...r.injuredReserveIds].sort(), t: [...r.taxiIds].sort() })
  return crypto.createHash('sha256').update(body).digest('hex')
}

export type RosterEvent = { eventId: string; eventType: 'roster_player_added' | 'roster_player_removed' | 'roster_player_moved'; entityId: string; rosterId: string; playerId: string }

/** Pure per-player diff between previous and next roster snapshots (by canonicalRosterId). Deterministic ids. */
export function diffRosterPlayers(prev: CanonicalRosterSnapshot[], next: CanonicalRosterSnapshot[], snapshotVersion: string): RosterEvent[] {
  const prevByRoster = new Map(prev.map((r) => [r.canonicalRosterId, r]))
  const events: RosterEvent[] = []
  for (const nr of next) {
    const pr = prevByRoster.get(nr.canonicalRosterId)
    const prevPlayers = new Set(pr?.playerIds ?? [])
    const nextPlayers = new Set(nr.playerIds)
    const prevStarters = new Set(pr?.starterIds ?? [])
    const nextStarters = new Set(nr.starterIds)
    for (const p of nextPlayers) if (!prevPlayers.has(p)) events.push(mk('roster_player_added', nr.canonicalRosterId, p, snapshotVersion))
    for (const p of prevPlayers) if (!nextPlayers.has(p)) events.push(mk('roster_player_removed', nr.canonicalRosterId, p, snapshotVersion))
    // moved = starter status changed for a player present in both snapshots
    for (const p of nextPlayers) if (prevPlayers.has(p) && prevStarters.has(p) !== nextStarters.has(p)) events.push(mk('roster_player_moved', nr.canonicalRosterId, p, snapshotVersion))
  }
  return events
}

function mk(eventType: RosterEvent['eventType'], rosterId: string, playerId: string, snapshotVersion: string): RosterEvent {
  return { eventId: deterministicEventId(eventType, `${rosterId}|${playerId}`, snapshotVersion, playerId), eventType, entityId: playerId, rosterId, playerId }
}

export type RosterSyncResult = { certified: boolean; leagueId: string; snapshotId: string | null; rosterCount: number; unresolvedCount: number; addedEvents: number; removedEvents: number; movedEvents: number; eventsInserted: number; reason?: string }

/** Run one league's roster sync: fetch → normalize → resolve → certify → per-player events. */
export async function runSleeperRosterSync(input: { leagueId: string; season: string; mappingSource: MappingSource; store?: SportsRuntimeStore }): Promise<RosterSyncResult> {
  const { leagueId, season } = input
  const store = input.store ?? new SportsRuntimeStore()
  const raw = await fetchSleeperRosters(leagueId)
  if (!raw || !Array.isArray(raw) || raw.length === 0) return { certified: false, leagueId, snapshotId: null, rosterCount: 0, unresolvedCount: 0, addedEvents: 0, removedEvents: 0, movedEvents: 0, eventsInserted: 0, reason: 'no rosters returned' }

  const rosters = raw.map((r) => normalizeSleeperRoster(r, leagueId, season, input.mappingSource))
  const now = new Date().toISOString()
  const version = `nfl-rosters-${leagueId}-${now.slice(0, 10)}`
  const records: SnapshotRecordDraft[] = rosters.map((r) => ({ canonicalKey: r.canonicalRosterId, resolutionStatus: 'resolved', contentHash: rosterContentHash(r), record: r, schemaValid: Boolean(r.providerRosterId) }))
  const checksumKey = records.map((r) => `${r.canonicalKey}:${r.contentHash}`).sort().join('|')
  const snapshotId = `nfl-rosters-${leagueId}-${crypto.createHash('sha256').update(checksumKey).digest('hex').slice(0, 20)}`

  // Previous certified rosters for this league → per-player diff.
  const prevRead = await store.getCertifiedRecords('NFL', 'rosters', leagueId)
  const prevRosters = (prevRead.records as CanonicalRosterSnapshot[]) ?? []
  const prevMeta = await store.previousCertifiedHashes('NFL', 'rosters', leagueId)

  const unresolvedTotal = rosters.reduce((a, r) => a + r.unresolvedCount, 0)
  const draft: SnapshotDraft = {
    snapshotId, version, sport: 'NFL', capability: 'rosters', provider: 'sleeper', generatedAt: now, sourceUpdatedAt: null,
    records, rejectedCount: records.filter((r) => !r.schemaValid).length, runPartial: false, scopeComplete: true,
    previousSnapshotId: prevMeta.snapshotId, limitations: unresolvedTotal > 0 ? [`${unresolvedTotal} roster player references are unresolved (quarantined).`] : [], scopeRef: leagueId,
  }
  const decision = canCertify(draft)
  if (!decision.certifiable) return { certified: false, leagueId, snapshotId: null, rosterCount: rosters.length, unresolvedCount: unresolvedTotal, addedEvents: 0, removedEvents: 0, movedEvents: 0, eventsInserted: 0, reason: decision.reasons.join('; ') }

  await store.persistCertifiedSnapshot(draft)
  const events = diffRosterPlayers(prevRosters, rosters, version)
  const inserted = await store.insertEvents(
    events.map((e) => ({ eventId: e.eventId, eventType: e.eventType, entityId: e.entityId, contentHash: e.playerId, record: { rosterId: e.rosterId, playerId: e.playerId } })),
    { sport: 'NFL', provider: 'sleeper', snapshotVersion: version, occurredAt: now },
  )
  return {
    certified: true, leagueId, snapshotId, rosterCount: rosters.length, unresolvedCount: unresolvedTotal,
    addedEvents: events.filter((e) => e.eventType === 'roster_player_added').length,
    removedEvents: events.filter((e) => e.eventType === 'roster_player_removed').length,
    movedEvents: events.filter((e) => e.eventType === 'roster_player_moved').length,
    eventsInserted: inserted,
  }
}
