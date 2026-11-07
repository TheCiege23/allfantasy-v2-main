/**
 * The rules a best ball result was scored under, stored WITH the result.
 *
 * `RedraftMatchup.lineupSnapshots.redraftScoring.{home,away}.bestBall` already keeps the lineup each team
 * was given and the seats nobody could fill. What it did not keep was what produced that lineup (audit
 * 2026-11-06, "Rule/settings version stored with a result"): the optimizer, the slot list it seated and
 * the scoring rules. So every rescore of an old week — a stat sync re-pulling a sealed week, an admin
 * re-ingest, a scoring-type switch — read the league's CURRENT roster seats, and a commissioner who added
 * a FLEX seat in week 9 silently rescored weeks 1–8 with it.
 *
 * `redraftScoring.bestBallRules` (one per matchup: both teams are seated on the same slots):
 *
 *   algorithm           `OPTIMAL_LINEUP_ALGORITHM` — the optimizer that ran this time.
 *   slots               the `buildBestBallSlots` list that was seated this time.
 *   scoringFingerprint  a hash of the league's resolved scoring rules this time. A record, not a lock:
 *                       a later scoring edit still applies (category scoring has its own per-week rule,
 *                       `settingsForScoringWeek`), and the fingerprint shows that it did.
 *   sealedAt            when the result was first written FINAL. From then on the slots are FROZEN:
 *                       every rescore seats `slots` from here, never the league's current seats. A
 *                       correction that drops the matchup back to active and re-finals it keeps them.
 *   sealedScoringFingerprint  the scoring fingerprint at the seal, kept beside the latest one.
 *   legacy              the result was already final before this stamp existed. Its original slots
 *                       are unknown, so it is NEVER frozen: it keeps today's behaviour (current seats),
 *                       and says so, instead of freezing whatever the seats happen to be now.
 *
 * Lives in JSON beside the result: no schema change.
 *
 * Contest rows (`BestBallOptimizedLineup` for a `BestBallEntry`, which contest scoring reads) carry the
 * same record in `optimizerLog.bestBallRules` — see `contestBestBallRuleStamp` below.
 */
import { createHash } from 'node:crypto'
import { OPTIMAL_LINEUP_ALGORITHM, type LineupSlotSpec } from '@/lib/lineup-optimizer/optimalLineup'
import { resolveLeagueScoringRules } from '@/lib/redraft/leagueScoringRules'

export const BEST_BALL_RULE_STAMP_VERSION = 1

/**
 * `min` / `max` / `required` are kept when the slot list states them: a SOCCER contest template is a
 * formation range (`min`/`max` per line), and dropping them would record a different contract from the
 * one that was seated. League slot lists never carry them, so their stamps are unchanged.
 */
export type StoredSlot = { slot: string; eligible: string[]; count: number; slotOrder?: number; min?: number; max?: number; required?: boolean }
export type StoredSlotSpec = LineupSlotSpec & { min?: number; max?: number; required?: boolean }

function slotBounds(s: { min?: unknown; max?: unknown; required?: unknown }) {
  return {
    ...(typeof s.min === 'number' && Number.isFinite(s.min) ? { min: s.min } : {}),
    ...(typeof s.max === 'number' && Number.isFinite(s.max) ? { max: s.max } : {}),
    ...(typeof s.required === 'boolean' ? { required: s.required } : {}),
  }
}

export type BestBallRuleStamp = {
  v: 1
  algorithm: string
  slots: StoredSlot[]
  scoringFingerprint: string | null
  sealedAt?: string
  sealedScoringFingerprint?: string | null
  legacy?: true
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** The slot list as stored: plain JSON, nothing a later reader can mistake. Null if any slot is malformed. */
export function readStoredSlots(raw: unknown): StoredSlotSpec[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null
  const out: StoredSlotSpec[] = []
  for (const s of raw) {
    if (!isRecord(s) || typeof s.slot !== 'string' || !Array.isArray(s.eligible)) return null
    const count = Number(s.count)
    if (!Number.isInteger(count) || count < 0 || !s.eligible.every((e) => typeof e === 'string')) return null
    out.push({ slot: s.slot, eligible: [...(s.eligible as string[])], count, ...(typeof s.slotOrder === 'number' ? { slotOrder: s.slotOrder } : {}), ...slotBounds(s) })
  }
  return out.some((s) => s.count > 0) ? out : null
}

export function toStoredSlots(slots: readonly StoredSlotSpec[]): StoredSlot[] {
  return slots.map((s) => ({ slot: s.slot, eligible: [...s.eligible], count: s.count, ...(typeof s.slotOrder === 'number' ? { slotOrder: s.slotOrder } : {}), ...slotBounds(s) }))
}

/** The stamp on a matchup's `lineupSnapshots`, or null when there is none (or it is unreadable). */
export function readBestBallRuleStamp(lineupSnapshots: unknown): BestBallRuleStamp | null {
  const scoring = isRecord(lineupSnapshots) ? lineupSnapshots.redraftScoring : null
  const stamp = isRecord(scoring) ? scoring.bestBallRules : null
  if (!isRecord(stamp) || stamp.v !== BEST_BALL_RULE_STAMP_VERSION || typeof stamp.algorithm !== 'string') return null
  const slots = readStoredSlots(stamp.slots)
  if (!slots) return null
  return {
    v: 1,
    algorithm: stamp.algorithm,
    slots: toStoredSlots(slots),
    scoringFingerprint: typeof stamp.scoringFingerprint === 'string' ? stamp.scoringFingerprint : null,
    ...(typeof stamp.sealedAt === 'string' ? { sealedAt: stamp.sealedAt } : {}),
    ...(stamp.sealedScoringFingerprint !== undefined
      ? { sealedScoringFingerprint: typeof stamp.sealedScoringFingerprint === 'string' ? stamp.sealedScoringFingerprint : null }
      : {}),
    ...(stamp.legacy === true ? { legacy: true as const } : {}),
  }
}

/**
 * The slots a rescore must seat: the stored ones once the result has been sealed under a stamp, else
 * null (seat the league's current slots, as before).
 */
export function frozenBestBallSlots(stamp: BestBallRuleStamp | null): LineupSlotSpec[] | null {
  if (!stamp || !stamp.sealedAt || stamp.legacy) return null
  return readStoredSlots(stamp.slots)
}

/**
 * The stamp to write with this scoring. `previousStatus` is the matchup's status BEFORE this write: a
 * result that was already final with no stamp is legacy and stays unfrozen.
 */
export function nextBestBallRuleStamp(args: {
  previous: BestBallRuleStamp | null
  previousStatus: string | null | undefined
  slotsUsed: readonly LineupSlotSpec[]
  scoringFingerprint: string | null
  isFinal: boolean
  now: Date
}): BestBallRuleStamp {
  const legacy = args.previous ? args.previous.legacy === true : args.previousStatus === 'final'
  const sealedAt = legacy ? undefined : args.previous?.sealedAt ?? (args.isFinal ? args.now.toISOString() : undefined)
  return {
    v: 1,
    algorithm: OPTIMAL_LINEUP_ALGORITHM,
    slots: toStoredSlots(args.slotsUsed),
    scoringFingerprint: args.scoringFingerprint,
    ...(sealedAt
      ? {
          sealedAt,
          sealedScoringFingerprint: args.previous?.sealedAt ? args.previous.sealedScoringFingerprint ?? null : args.scoringFingerprint,
        }
      : {}),
    ...(legacy ? { legacy: true as const } : {}),
  }
}

/**
 * The record on a contest entry's optimized lineup, `optimizerLog.bestBallRules`: the optimizer that
 * actually ran (`seatContestLineup` reports `soccer-formation-v1` for a formation template, the exact
 * optimizer otherwise), the template slots it seated, and the scoring fingerprint.
 *
 * ⚠ `scoringFingerprint` is null, and `scoringSource` says why. A contest has no league and no scoring
 * settings of its own: it seats `PlayerWeeklyScore.fantasyPts`, a row shared by every league that rosters
 * the player and written by whichever league's scorer ran last. There is no rule set to hash, and hashing
 * the sport's defaults would record rules the points were not necessarily computed with.
 *
 * A record of this write, not a lock: a contest week rescored later is stamped with what that rescore
 * used. No `sealedAt` is written, because nothing freezes a contest's slots.
 */
export type ContestBestBallRuleStamp = {
  v: 1
  algorithm: string
  slots: StoredSlot[]
  scoringFingerprint: string | null
  scoringSource: typeof CONTEST_SCORING_SOURCE
}

export const CONTEST_SCORING_SOURCE = 'PlayerWeeklyScore.fantasyPts' as const

export function contestBestBallRuleStamp(args: {
  algorithm: unknown
  slots: readonly StoredSlotSpec[]
}): ContestBestBallRuleStamp {
  return {
    v: BEST_BALL_RULE_STAMP_VERSION,
    algorithm: typeof args.algorithm === 'string' && args.algorithm ? args.algorithm : OPTIMAL_LINEUP_ALGORITHM,
    slots: toStoredSlots(args.slots),
    scoringFingerprint: null,
    scoringSource: CONTEST_SCORING_SOURCE,
  }
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .filter((k) => value[k] !== undefined && typeof value[k] !== 'function')
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableJson(value[k])}`)
      .join(',')}}`
  }
  return JSON.stringify(value ?? null)
}

/**
 * A short hash of the scoring rules a league's stat lines are scored with (`resolveLeagueScoringRules`,
 * the same rules `buildLeagueStatScorer` applies). Null when the sport has no scoring config.
 */
export function scoringRulesFingerprint(league: { sport: string | null | undefined; settings: unknown }): string | null {
  const rules = resolveLeagueScoringRules({ sport: String(league.sport ?? 'NFL'), settings: league.settings })
  if (!rules) return null
  return createHash('sha256').update(stableJson({ categories: rules.categories, overrides: rules.overrides })).digest('hex').slice(0, 16)
}
