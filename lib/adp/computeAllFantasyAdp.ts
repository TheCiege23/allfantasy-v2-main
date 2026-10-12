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

import { normalizeAdpName } from '@/lib/adp/resolveAdp'
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

/**
 * Stable `<name>|<position>` key. Writer (aggregateAdp) and every reader build it here.
 *
 * 🛑 THE NAME HALF IS `normalizeAdpName`, NOT `trim().toLowerCase()` — suffixes and punctuation
 * DROP. Draft picks spell a name however the source did, and roster `playerData` carries Sleeper's
 * spelling. Measured on production 2026-10-12: rosters say "Kenneth Walker" ~500 times and
 * "Kenneth Walker III" 8; the 2026 NFL redraft snapshots held 46 suffixed keys (dynasty 37) —
 * `james cook iii|rb` at ADP 5, `marvin harrison jr.|wr` at 7, `kenneth walker iii|rb` at 11 —
 * plus dotted/undotted twins (`aaron jones sr.|rb` AND `aaron jones sr|rb`). The free-agent pools
 * exclude rostered players by this key, so all three were offered as top free agents to the teams
 * that rostered them, and the rostered "Kenneth Walker" was priced off a 1-sample stray key.
 *
 * Suffix-insensitive is safe HERE because a snapshot only holds players drafted this season — a
 * retired father is never in it. (`canonicalName` keeps suffixes for exactly that reason; it serves
 * a different table.) Stored rows written before this change still carry the old spelling, so
 * readers re-key them with `normalizeStoredPlayerKey`.
 */
export function buildPlayerKey(name: string, position: string | null | undefined): string {
  const n = normalizeAdpName(name)
  const p = (position ?? '').trim().toLowerCase()
  return `${n}|${p}`
}

/**
 * Re-key a STORED `playerKey` into today's `buildPlayerKey` shape. Idempotent, so it is safe on
 * rows the current writer produced and on rows written under the old trim+lowercase key alike.
 */
export function normalizeStoredPlayerKey(stored: string | null | undefined): string {
  const s = String(stored ?? '')
  const bar = s.lastIndexOf('|')
  return bar < 0 ? buildPlayerKey(s, '') : buildPlayerKey(s.slice(0, bar), s.slice(bar + 1))
}

export interface StoredAdpRowLike {
  playerKey: string | null
  averageOverallPick: number
  sampleSize?: number | null
  contextHash?: string | null
  draftMode?: string | null
}

/**
 * Which of two stored rows for the SAME normalized player in the SAME context to keep: more
 * samples, then the better (lower) ADP, then the smaller stored key — so the answer never depends
 * on row order. Samples first because the stray variant is usually the thin one (the 1-sample
 * `kenneth walker|rb` beside 8 samples of `kenneth walker iii|rb`).
 */
export function preferStoredAdpRow<T extends StoredAdpRowLike>(a: T, b: T): T {
  const sa = a.sampleSize ?? 0
  const sb = b.sampleSize ?? 0
  if (sa !== sb) return sa > sb ? a : b
  if (a.averageOverallPick !== b.averageOverallPick) return a.averageOverallPick < b.averageOverallPick ? a : b
  return String(a.playerKey ?? '') <= String(b.playerKey ?? '') ? a : b
}

/**
 * Re-key stored rows and collapse spelling variants of one player within one
 * (contextHash, draftMode) via `preferStoredAdpRow`. Rows from DIFFERENT contexts are not merged
 * here — that is each reader's own cross-context rule. Rows with no key are dropped. Output keeps
 * the order in which each surviving group was first seen.
 */
export function collapseStoredAdpRows<T extends StoredAdpRowLike>(rows: readonly T[]): Array<T & { playerKey: string }> {
  // Originals are kept so the tie-break compares STORED keys, not the shared normalized one.
  const kept = new Map<string, T>()
  for (const row of rows) {
    if (!row.playerKey) continue
    const groupKey = `${normalizeStoredPlayerKey(row.playerKey)}::${row.contextHash ?? ''}::${row.draftMode ?? ''}`
    const prev = kept.get(groupKey)
    kept.set(groupKey, prev ? preferStoredAdpRow(prev, row) : row)
  }
  return [...kept.values()].map((row) => ({ ...row, playerKey: normalizeStoredPlayerKey(row.playerKey) }))
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
