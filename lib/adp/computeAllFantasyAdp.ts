/**
 * D.5-test â pure aggregation logic for AllFantasy AI ADP.
 *
 * Given a list of valid `DraftPick` rows, group by (player + context + draftMode)
 * and compute the snapshot fields the resolver / table will read:
 *   - sampleSize, averageOverallPick, averageRound, averagePickInRound
 *   - minOverallPick, maxOverallPick
 *   - sevenDayTrend / thirtyDayTrend (deltas vs. earlier snapshots, computed elsewhere)
 *
 * Pure, framework-free â no Prisma, no React. The recompute script wires this
 * to Neon; the test suite verifies the math directly without a database.
 *
 * Definition of valid pick (filtered upstream by the recompute script):
 *   - the row is not a commissioner-cleared EMPTY slot (see `isPickValidForAdp` - this
 *     replaced a `pickedAt`/`status=completed` test that excluded every live draft)
 *   - pick.source NOT IN ('test_seed', 'undone', 'corrected')   â see DraftPick.source
 *   - playerName is non-empty
 *   - overall â¥ 1
 *   - assetType IN (null, 'player')   (rookie/devy/dispersal picks excluded from ADP)
 *
 * Context tuple â drives `contextHash` (the natural key alongside playerKey + draftMode):
 *   sport | leagueType | draftType | scoringFormat | rosterFormat | teamCount | season
 */

import { createHash } from 'node:crypto'

import { isDraftPickRowEmpty } from '@/lib/live-draft-engine/draftPickEmpty'

export interface DraftContext {
  sport: string
  leagueType: string
  draftType: string
  scoringFormat: string
  rosterFormat: string
  teamCount: number
  season: string
}

export type DraftMode = 'real' | 'mock' | 'test'

export interface AggregatablePick {
  playerName: string
  position: string
  overall: number
  round: number
  /** 1-based pick within the round. If absent, derived from `overall` and `teamCount`. */
  roundPick?: number | null
  /** When the pick was submitted (used for trend windows). Defaults to "now" when null. */
  pickedAt?: Date | null
  context: DraftContext
  draftMode: DraftMode
}

export interface AdpSnapshot {
  playerKey: string
  playerName: string
  context: DraftContext
  draftMode: DraftMode
  contextHash: string
  sampleSize: number
  averageOverallPick: number
  averageRound: number
  averagePickInRound: number
  minOverallPick: number
  maxOverallPick: number
  /** Population standard deviation of overall picks. Null when sampleSize<2. */
  standardDeviation: number | null
  /** Filled in by the recompute script when prior snapshots are available; null in pure aggregation. */
  sevenDayTrend: number | null
  thirtyDayTrend: number | null
}

/** Stable lowercase + position key. Pool side uses the same shape. */
export function buildPlayerKey(name: string, position: string | null | undefined): string {
  const n = (name ?? '').trim().toLowerCase()
  const p = (position ?? '').trim().toLowerCase()
  return `${n}|${p}`
}

/** Deterministic context hash â used as the natural key alongside playerKey + draftMode. */
export function buildContextHash(ctx: DraftContext): string {
  const parts = [
    String(ctx.sport ?? '').trim().toUpperCase(),
    String(ctx.leagueType ?? '').trim().toLowerCase(),
    String(ctx.draftType ?? '').trim().toLowerCase(),
    String(ctx.scoringFormat ?? '').trim().toLowerCase(),
    String(ctx.rosterFormat ?? '').trim().toLowerCase(),
    String(ctx.teamCount ?? ''),
    String(ctx.season ?? '').trim(),
  ]
  return createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 16)
}

function meanOf(nums: readonly number[]): number {
  if (!nums.length) return 0
  let sum = 0
  for (const n of nums) sum += n
  return sum / nums.length
}

/** Population standard deviation. Returns null when fewer than 2 samples. */
function stdDevOf(nums: readonly number[]): number | null {
  if (nums.length < 2) return null
  const mean = meanOf(nums)
  let variance = 0
  for (const n of nums) variance += (n - mean) * (n - mean)
  variance /= nums.length
  return Math.sqrt(variance)
}

function clampRoundPick(pick: AggregatablePick): number {
  if (pick.roundPick != null && Number.isFinite(pick.roundPick) && pick.roundPick > 0) return pick.roundPick
  // Snake derivation: pick-in-round = ((overall - 1) % teamCount) + 1
  // (Sleeper-equivalent â for snake, the raw pick-in-round is a useful approximation
  //  even though slot direction reverses each round; readers care about the average
  //  position more than the slot direction.)
  const tc = Math.max(1, pick.context.teamCount || 1)
  return ((pick.overall - 1) % tc) + 1
}

/**
 * Aggregate a flat list of picks into one snapshot per (player, context, draftMode).
 * Caller is responsible for filtering out invalid/undone/test picks BEFORE passing.
 */
export function aggregateAdp(picks: readonly AggregatablePick[]): AdpSnapshot[] {
  type Key = string
  const groups = new Map<Key, AggregatablePick[]>()
  const groupKey = (p: AggregatablePick): Key =>
    `${buildPlayerKey(p.playerName, p.position)}::${buildContextHash(p.context)}::${p.draftMode}`

  for (const pick of picks) {
    if (!pick.playerName || !pick.playerName.trim()) continue
    if (!Number.isFinite(pick.overall) || pick.overall < 1) continue
    const key = groupKey(pick)
    const list = groups.get(key) ?? []
    list.push(pick)
    groups.set(key, list)
  }

  const out: AdpSnapshot[] = []
  for (const list of groups.values()) {
    const first = list[0]!
    const overalls = list.map((p) => p.overall)
    const rounds = list.map((p) => p.round)
    const pickInRounds = list.map(clampRoundPick)
    const sd = stdDevOf(overalls)
    out.push({
      playerKey: buildPlayerKey(first.playerName, first.position),
      playerName: first.playerName.trim(),
      context: first.context,
      draftMode: first.draftMode,
      contextHash: buildContextHash(first.context),
      sampleSize: list.length,
      averageOverallPick: round2(meanOf(overalls)),
      averageRound: round2(meanOf(rounds)),
      averagePickInRound: round2(meanOf(pickInRounds)),
      minOverallPick: Math.min(...overalls),
      maxOverallPick: Math.max(...overalls),
      standardDeviation: sd == null ? null : round2(sd),
      sevenDayTrend: null,
      thirtyDayTrend: null,
    })
  }
  return out
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * Compute trend deltas given the new aggregate set + prior aggregate sets keyed by
 * (playerKey, contextHash, draftMode).
 *
 * sevenDayTrend = (7-day prior snapshot averageOverallPick) - (current averageOverallPick)
 *   â positive number means the player has moved UP the board (drafted earlier now).
 *   â null when no prior snapshot exists for that window.
 *
 * Same shape for 30-day. Pure function â recompute script handles the DB read.
 */
export function applyTrends(
  current: AdpSnapshot[],
  priorBySnapshotKey: {
    sevenDay: Map<string, number>
    thirtyDay: Map<string, number>
  },
): AdpSnapshot[] {
  return current.map((snap) => {
    const k = `${snap.playerKey}::${snap.contextHash}::${snap.draftMode}`
    const sevenPrior = priorBySnapshotKey.sevenDay.get(k)
    const thirtyPrior = priorBySnapshotKey.thirtyDay.get(k)
    return {
      ...snap,
      standardDeviation: snap.standardDeviation,
      sevenDayTrend:
        typeof sevenPrior === 'number' && Number.isFinite(sevenPrior)
          ? round2(sevenPrior - snap.averageOverallPick)
          : null,
      thirtyDayTrend:
        typeof thirtyPrior === 'number' && Number.isFinite(thirtyPrior)
          ? round2(thirtyPrior - snap.averageOverallPick)
          : null,
    }
  })
}

/** Convenience snapshot key builder used by tests + recompute script. */
export function snapshotKey(s: { playerKey: string; contextHash: string; draftMode: DraftMode }): string {
  return `${s.playerKey}::${s.contextHash}::${s.draftMode}`
}

/**
 * Predicate that mirrors the recompute-script-side filter for "valid for AI ADP".
 *
 * - draftMode === 'test' is excluded by default; pass `{ includeTest: true }` to keep them.
 * - source values 'undone' / 'corrected' are excluded unconditionally.
 * - assetType must be null OR 'player' (rookie / devy / dispersal picks excluded from ADP).
 * - commissioner-cleared EMPTY slot rows are excluded.
 *
 * ⚠ THE EMPTY-ROW CHECK REPLACED A `pickedAt IS NOT NULL` FILTER THAT MATCHED ALMOST NOTHING.
 * The recompute selected `pickedAt != null OR session.status = 'completed'` to mean "a pick that
 * was actually made". But `pickedAt` is written by exactly ONE caller in the repo -
 * `commissionerPickEditService`. `PickSubmissionService` and `AuctionEngine` both omit the column
 * on create, and `sleeperSync` sets it to NULL deliberately (Sleeper's pick payload carries no
 * timestamp, and stamping sync-time made every pick read as "just now"). So for any draft not yet
 * `completed`, that clause dropped every pick - which is exactly the live and in-progress draft
 * data this system exists to collect.
 *
 * A DraftPick row is only created when a pick is actually made. The single exception is a
 * commissioner-cleared slot, which leaves a placeholder row behind. Emptiness, not `pickedAt`, is
 * the faithful expression of the original intent, and it is one predicate shared with the draft
 * board rather than a second definition that can drift.
 */
export interface PickValidityInput {
  source?: string | null
  assetType?: string | null
  draftMode: DraftMode
  /** Commissioner-cleared slots leave a placeholder row behind; these three identify one. */
  playerName?: string | null
  position?: string | null
  pickMetadata?: unknown | null
}

export function isPickValidForAdp(
  pick: PickValidityInput,
  options: { includeTest?: boolean } = {},
): boolean {
  const src = (pick.source ?? '').trim().toLowerCase()
  if (src === 'undone' || src === 'corrected' || src === 'deleted') return false
  if (pick.draftMode === 'test' && !options.includeTest) return false
  const asset = (pick.assetType ?? 'player').trim().toLowerCase()
  if (asset !== 'player' && asset !== '') return false
  if (isDraftPickRowEmpty(pick)) return false
  return true
}
