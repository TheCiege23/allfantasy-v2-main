import 'server-only'
import crypto from 'node:crypto'
/**
 * Fantasy OS Phase 5F-a — certified player-statistics runtime.
 *
 * Certified, append-only player-game statistics snapshots keyed by (sport, capability='statistics',
 * scope_ref=`<season>-w<week>`). Real observed box-score stats only — NO derived fantasy points, NO projections.
 * Mirrors the schedule runtime's certification pattern (schema validation → identity classification → duplicate
 * detection via content hash → canCertify → append-only persist). Rejected drafts never replace certified ones.
 *
 * PROVIDER TRUTH: box scores come from ESPN's public summary endpoint (verified, same source lib/espn-data.ts
 * uses). ESPN athlete ids are provider-native; a cross-provider canonical player map does not yet exist, so
 * player identity is classified `unresolved` (canonical key `unresolved:espn:<athleteId>`) and disclosed — the
 * snapshot still certifies (unresolved is a valid classified identity outcome), the game/team identity resolves.
 */
import type { CanonicalPlayerGameStat, CanonicalGameStatus } from '../contracts'
import { fetchEspnBoxScore, mapEspnStatus, type EspnBoxScoreAthlete, type EspnBoxScoreFetch } from '../providers/espn'
import { SportsRuntimeStore } from './store'
import { canCertify, type SnapshotDraft, type SnapshotRecordDraft } from './snapshot'

export function statContentHash(s: CanonicalPlayerGameStat): string {
  return crypto.createHash('sha256').update(`${s.canonicalGameId}|${s.canonicalPlayerId}|${s.position ?? 'na'}|${JSON.stringify(s.statCategories)}|${s.gameStatus}`).digest('hex')
}

/**
 * Deterministic identity outcome for one provider athlete id. `resolved` carries the canonical id; `ambiguous`
 * flags a non-deterministic match (no canonical id assigned). `null`/absent = unresolved. Phase 5F-b: this is a
 * SYNC lookup into a pre-built map (the async DB resolution happens once, batched, in runEspnStatisticsSync).
 */
export type StatIdentityResolution = { canonicalPlayerId: string; state: 'resolved' } | { state: 'ambiguous' }
export type PlayerIdentityResolver = (providerAthleteId: string) => StatIdentityResolution | null

/** Pure normalize: one ESPN box-score athlete → CanonicalPlayerGameStat. Team ids are provider-neutral `nfl:<ABBREV>`. */
export function normalizeEspnStat(
  a: EspnBoxScoreAthlete,
  ctx: { eventId: string; season: string; week: string | null; gameStatus: CanonicalGameStatus; homeAbbrev: string | null; awayAbbrev: string | null; fetchedAt: string; snapshotVersion: string },
  resolve?: PlayerIdentityResolver,
): CanonicalPlayerGameStat {
  const res = resolve?.(a.providerAthleteId) ?? null
  const teamId = a.teamAbbrev ? `nfl:${a.teamAbbrev.toUpperCase()}` : 'nfl:UNKNOWN'
  const opponentAbbrev = a.teamAbbrev && ctx.homeAbbrev && ctx.awayAbbrev
    ? (a.teamAbbrev.toUpperCase() === ctx.homeAbbrev.toUpperCase() ? ctx.awayAbbrev : ctx.homeAbbrev)
    : null
  // resolved → canonical id; ambiguous → flagged but NO canonical id assigned (never name-guessed); unresolved → provider ref.
  const canonicalPlayerId = res?.state === 'resolved' ? res.canonicalPlayerId : res?.state === 'ambiguous' ? `ambiguous:espn:${a.providerAthleteId}` : `unresolved:espn:${a.providerAthleteId}`
  const identityResolution: CanonicalPlayerGameStat['identityResolution'] = res?.state === 'resolved' ? 'resolved' : res?.state === 'ambiguous' ? 'ambiguous' : 'unresolved'
  return {
    canonicalPlayerId,
    canonicalGameId: `espn:nfl:${ctx.eventId}`,
    teamId,
    opponentTeamId: opponentAbbrev ? `nfl:${opponentAbbrev.toUpperCase()}` : null,
    season: ctx.season,
    week: ctx.week,
    gameStatus: ctx.gameStatus,
    position: a.position,
    statCategories: a.stats,
    identityResolution,
    source: { primaryProvider: 'espn', providerRecordId: a.providerAthleteId, fetchedAt: ctx.fetchedAt, sourceUpdatedAt: null, snapshotVersion: ctx.snapshotVersion },
  }
}

export type StatisticsSyncResult = {
  certified: boolean; season: string; week: string | null; snapshotId: string | null; statCount: number; resolvedCount: number; unresolvedCount: number; ambiguousCount: number
  gamesFetched: number; gamesFailed: number; created: number; changed: number; suppressed: number; attempts: number; logical: number; reason?: string
}

/** Async batch identity resolver: unique provider athlete ids → deterministic resolution map. Absent id = unresolved. */
export type StatIdentityBatchResolver = (providerAthleteIds: string[]) => Promise<Map<string, StatIdentityResolution>>

/**
 * Fetch ESPN box scores for a set of game event ids, resolve canonical player identity (deterministically, once,
 * batched), normalize, and certify an append-only statistics snapshot. `eventIds` are the raw ESPN ids.
 */
export async function runEspnStatisticsSync(input: { season: string; week: string | null; eventIds: string[]; store?: SportsRuntimeStore; resolve?: PlayerIdentityResolver; resolveBatch?: StatIdentityBatchResolver }): Promise<StatisticsSyncResult> {
  const store = input.store ?? new SportsRuntimeStore()
  const scopeRef = `${input.season}-w${input.week ?? 'x'}`
  const now = new Date().toISOString()
  const version = `nfl-stats-${scopeRef}-${now.slice(0, 10)}`
  const fetchedAt = now

  // 1. Fetch all box scores first.
  const fetched: Array<{ eventId: string; box: EspnBoxScoreFetch }> = []
  let gamesFetched = 0
  let gamesFailed = 0
  const limitations: string[] = []
  for (const eventId of input.eventIds) {
    const box: EspnBoxScoreFetch | { error: string } = await fetchEspnBoxScore(eventId)
    if ('error' in box) { gamesFailed++; limitations.push(`game ${eventId}: ${box.error}`); continue }
    gamesFetched++
    fetched.push({ eventId, box })
  }

  // 2. Batch-resolve every unique athlete id ONCE (deterministic direct id resolution only), then a sync lookup.
  let resolve = input.resolve
  if (input.resolveBatch) {
    const uniqueIds = [...new Set(fetched.flatMap((f) => f.box.athletes.map((a) => a.providerAthleteId)))]
    const map = uniqueIds.length > 0 ? await input.resolveBatch(uniqueIds) : new Map<string, StatIdentityResolution>()
    resolve = (id) => map.get(id) ?? null
  }

  // 3. Normalize with resolved identity.
  const stats: CanonicalPlayerGameStat[] = []
  for (const { eventId, box } of fetched) {
    const gameStatus = mapEspnStatus(box.statusName)
    for (const a of box.athletes) {
      stats.push(normalizeEspnStat(a, { eventId, season: input.season, week: input.week, gameStatus, homeAbbrev: box.homeAbbrev, awayAbbrev: box.awayAbbrev, fetchedAt, snapshotVersion: version }, resolve))
    }
  }

  const resolvedCount = stats.filter((s) => s.identityResolution === 'resolved').length
  const ambiguousCount = stats.filter((s) => s.identityResolution === 'ambiguous').length
  const unresolvedCount = stats.length - resolvedCount - ambiguousCount
  if (unresolvedCount > 0) limitations.push(`${unresolvedCount} player identities unresolved (no deterministic ESPN athlete-id → canonical map entry)`)
  if (ambiguousCount > 0) limitations.push(`${ambiguousCount} player identities ambiguous (non-deterministic match only; not scoring-eligible)`)

  // Key includes the stat group (position) so a player appearing in multiple ESPN groups (e.g. passing AND
  // rushing) yields one record PER group rather than colliding into one — preserving full stat fidelity.
  const records: SnapshotRecordDraft[] = stats.map((s) => ({
    canonicalKey: `${s.canonicalGameId}:${s.canonicalPlayerId}:${s.position ?? 'na'}`,
    resolutionStatus: s.identityResolution, // resolved | unresolved | ambiguous — all valid classified outcomes
    contentHash: statContentHash(s),
    record: s,
    schemaValid: true,
  }))

  if (records.length === 0) {
    return { certified: false, season: input.season, week: input.week, snapshotId: null, statCount: 0, resolvedCount: 0, unresolvedCount: 0, ambiguousCount: 0, gamesFetched, gamesFailed, created: 0, changed: 0, suppressed: 0, attempts: 1, logical: 1, reason: gamesFetched === 0 ? 'no games fetched' : 'no box-score stats available (games not yet played?)' }
  }

  const checksumKey = records.map((r) => `${r.canonicalKey}:${r.contentHash}`).sort().join('|')
  const snapshotId = `nfl-stats-${scopeRef}-${crypto.createHash('sha256').update(checksumKey).digest('hex').slice(0, 20)}`
  const prev = await store.previousCertifiedHashes('NFL', 'statistics', scopeRef)

  const draft: SnapshotDraft = {
    snapshotId, version, sport: 'NFL', capability: 'statistics', provider: 'espn', generatedAt: now, sourceUpdatedAt: null,
    records, rejectedCount: gamesFailed, runPartial: false, scopeComplete: true, previousSnapshotId: prev.snapshotId,
    limitations, scopeRef,
  }
  const decision = canCertify(draft)
  if (!decision.certifiable) {
    return { certified: false, season: input.season, week: input.week, snapshotId: null, statCount: stats.length, resolvedCount, unresolvedCount, ambiguousCount, gamesFetched, gamesFailed, created: 0, changed: 0, suppressed: 0, attempts: 1, logical: 1, reason: decision.reasons.join('; ') }
  }

  // Content-hash diff for created/changed/suppressed (append-only correction replay: changed stats → a new snapshot).
  let created = 0, changed = 0, suppressed = 0
  for (const r of records) {
    const prior = prev.hashes.get(r.canonicalKey)
    if (prior === r.contentHash) suppressed++
    else if (prior === undefined) created++
    else changed++
  }

  await store.persistCertifiedSnapshot(draft)
  return { certified: true, season: input.season, week: input.week, snapshotId, statCount: stats.length, resolvedCount, unresolvedCount, ambiguousCount, gamesFetched, gamesFailed, created, changed, suppressed, attempts: 1, logical: 1 }
}

/** Consumer read: certified player-game statistics for a season/week (provider-neutral). */
export async function getCertifiedPlayerStats(store: SportsRuntimeStore, season: string, week: string | null): Promise<CanonicalPlayerGameStat[]> {
  const { records } = await store.getCertifiedRecords('NFL', 'statistics', `${season}-w${week ?? 'x'}`).catch(() => ({ records: [] as unknown[] }))
  return records as CanonicalPlayerGameStat[]
}
