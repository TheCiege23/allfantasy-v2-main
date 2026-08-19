import 'server-only'
import crypto from 'node:crypto'
/**
 * Fantasy OS Phase 5D-b — ESPN schedule/games synchronization (Parts 5–6).
 *
 * Certified, append-only games snapshots keyed by (sport, capability='games', scope_ref=`<season>-w<week>`).
 * Emits status-change events only when a game record actually changes (no event for unchanged data).
 */
import { fetchEspnSchedule } from '../providers/espn'
import type { CanonicalGameSchedule } from '../contracts'
import { SportsRuntimeStore } from './store'
import { deterministicEventId } from './events'
import { canCertify, type SnapshotDraft, type SnapshotRecordDraft } from './snapshot'

export function gameContentHash(g: CanonicalGameSchedule): string {
  return crypto.createHash('sha256').update(`${g.status}|${g.scheduledStart}|${g.homeTeamId}|${g.awayTeamId}`).digest('hex')
}

const STATUS_EVENT: Record<CanonicalGameSchedule['status'], string> = {
  scheduled: 'game_created', delayed: 'game_delayed', postponed: 'game_postponed', suspended: 'game_suspended',
  live: 'game_started', final: 'game_final', cancelled: 'game_cancelled', unknown: 'game_corrected',
}

export type GameEvent = { eventId: string; eventType: string; entityId: string; contentHash: string; record: CanonicalGameSchedule }

/** Pure diff: new game → game_created; changed status/start → the status-mapped event; unchanged → suppressed. */
export function diffGames(games: CanonicalGameSchedule[], previous: Map<string, string>, snapshotVersion: string): { events: GameEvent[]; created: number; changed: number; suppressed: number } {
  let created = 0, changed = 0, suppressed = 0
  const events: GameEvent[] = []
  for (const g of games) {
    const h = gameContentHash(g)
    const prior = previous.get(g.canonicalGameId)
    if (prior === h) { suppressed++; continue }
    const isNew = prior === undefined
    if (isNew) created++
    else changed++
    const eventType = isNew ? 'game_created' : STATUS_EVENT[g.status]
    events.push({ eventId: deterministicEventId(eventType, g.canonicalGameId, snapshotVersion, h), eventType, entityId: g.canonicalGameId, contentHash: h, record: g })
  }
  return { events, created, changed, suppressed }
}

export type ScheduleSyncResult = { certified: boolean; season: string; week: string | null; snapshotId: string | null; gameCount: number; rejected: number; createdEvents: number; changedEvents: number; eventsInserted: number; attempts: number; logical: number; reason?: string }

export async function runEspnScheduleSync(input: { week?: number; store?: SportsRuntimeStore }): Promise<ScheduleSyncResult> {
  const store = input.store ?? new SportsRuntimeStore()
  const fetched = await fetchEspnSchedule({ week: input.week })
  if ('error' in fetched) return { certified: false, season: 'unknown', week: null, snapshotId: null, gameCount: 0, rejected: 0, createdEvents: 0, changedEvents: 0, eventsInserted: 0, attempts: 1, logical: 1, reason: fetched.error }

  const { games, season, week, rejected } = fetched
  const scopeRef = `${season}-w${week ?? 'x'}`
  const now = new Date().toISOString()
  const version = `nfl-games-${scopeRef}-${now.slice(0, 10)}`
  const records: SnapshotRecordDraft[] = games.map((g) => ({ canonicalKey: g.canonicalGameId, resolutionStatus: 'resolved', contentHash: gameContentHash(g), record: g, schemaValid: true }))
  const checksumKey = records.map((r) => `${r.canonicalKey}:${r.contentHash}`).sort().join('|')
  const snapshotId = `nfl-games-${scopeRef}-${crypto.createHash('sha256').update(checksumKey).digest('hex').slice(0, 20)}`

  const prev = await store.previousCertifiedHashes('NFL', 'games', scopeRef)
  const draft: SnapshotDraft = {
    snapshotId, version, sport: 'NFL', capability: 'games', provider: 'espn', generatedAt: now, sourceUpdatedAt: null,
    records, rejectedCount: rejected, runPartial: false, scopeComplete: true, previousSnapshotId: prev.snapshotId,
    limitations: rejected > 0 ? [`${rejected} ESPN events failed schema validation and were rejected.`] : [], scopeRef,
  }
  const decision = canCertify(draft)
  if (!decision.certifiable) return { certified: false, season, week, snapshotId: null, gameCount: games.length, rejected, createdEvents: 0, changedEvents: 0, eventsInserted: 0, attempts: 1, logical: 1, reason: decision.reasons.join('; ') }

  await store.persistCertifiedSnapshot(draft)
  const diff = diffGames(games, prev.hashes, version)
  const inserted = await store.insertEvents(diff.events.map((e) => ({ eventId: e.eventId, eventType: e.eventType, entityId: e.entityId, contentHash: e.contentHash, record: e.record })), { sport: 'NFL', provider: 'espn', snapshotVersion: version, occurredAt: now })
  return { certified: true, season, week, snapshotId, gameCount: games.length, rejected, createdEvents: diff.created, changedEvents: diff.changed, eventsInserted: inserted, attempts: 1, logical: 1 }
}

/** Consumer read: certified games for a season/week (provider-neutral). */
export async function getCertifiedSchedule(store: SportsRuntimeStore, season: string, week: string | null): Promise<CanonicalGameSchedule[]> {
  const { records } = await store.getCertifiedRecords('NFL', 'games', `${season}-w${week ?? 'x'}`).catch(() => ({ records: [] as unknown[] }))
  return records as CanonicalGameSchedule[]
}
