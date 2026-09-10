import { isConsecutiveSchedule } from './periodCalendar'

/**
 * Lane planner — pure, deterministic, no I/O.
 *
 * Two lanes process one league-season so a live cursor and a historical cursor cannot fight
 * over one target. They own DISJOINT period ranges, verified here before anything reaches a
 * database.
 *
 * ⚠ A HISTORICAL LANE STARTS AT THE FIRST SCHEDULED PERIOD, NOT THE FIRST WITH EVIDENCE.
 * Starting at the first period that happens to have matchups makes a missing week 1 vanish
 * from history, and hysteresis then reads weeks 2-4 as three consecutive periods while week
 * 1 was never accounted for. A missing scheduled week is still targeted, still deferred, and
 * still closed by a durable SKIP.
 */

export type ProcessingLane = 'live' | 'historical_backfill'

export interface LaneSpec {
  readonly processingLane: ProcessingLane
  readonly laneFloorPeriod: number
  readonly laneCeilingPeriod: number
  readonly targetPeriodOrdinal: number
  /**
   * True for a seed lane whose periods precede a live sibling.
   *
   * Batch 19A decision: durable live completion is BLOCKED until the seed lane exhausts.
   * The alternative — completing provisionally and re-evaluating later — needs a durable
   * work record and its own observation correction type, neither of which exists yet.
   * Blocking is the honest option; a request-time surface may still show a clearly labelled
   * provisional answer, which is outside this batch.
   */
  readonly blocksLiveSettlement: boolean
}

export type LanePlanState =
  | 'ongoing_live_only'
  | 'ongoing_with_seed'
  | 'completed_season_backfill'

export type LanePlanRefusal =
  | 'schedule_empty'
  | 'schedule_not_consecutive'
  | 'required_lookback_invalid'
  | 'evidence_outside_schedule'
  | 'lane_bounds_invalid'
  | 'lane_target_out_of_bounds'
  | 'lane_overlap'

export interface LanePlanInput {
  /** Consecutive, ascending, from `resolveScheduledPeriods`. */
  scheduledPeriods: readonly number[]
  /** Periods with at least one scored matchup. Order irrelevant; duplicates tolerated. */
  availableEvidencePeriods: readonly number[]
  /** Epoch ms at which a period becomes eligible to settle. Injected for determinism. */
  settleEligibleAt: (periodOrdinal: number) => number
  /** Epoch ms. Injected for determinism. */
  nowMs: number
  /** Consecutive predecessor periods hysteresis needs. Normally 3. */
  requiredLookback: number
}

export type LanePlan =
  | { kind: 'plan'; state: LanePlanState; live: LaneSpec | null; historical: LaneSpec | null }
  | { kind: 'refused'; reason: LanePlanRefusal }

function refuse(reason: LanePlanRefusal): LanePlan {
  return { kind: 'refused', reason }
}

/**
 * Validates a pair before it can be persisted. Overlapping lanes must never reach the
 * database, where two workers would then race to write the same observation.
 */
export function validateLanes(live: LaneSpec | null, historical: LaneSpec | null): LanePlanRefusal | null {
  for (const lane of [live, historical]) {
    if (!lane) continue
    if (!Number.isInteger(lane.laneFloorPeriod) || lane.laneFloorPeriod < 1) return 'lane_bounds_invalid'
    if (!Number.isInteger(lane.laneCeilingPeriod) || lane.laneCeilingPeriod < lane.laneFloorPeriod) {
      return 'lane_bounds_invalid'
    }
    if (!Number.isInteger(lane.targetPeriodOrdinal)) return 'lane_target_out_of_bounds'
    if (lane.targetPeriodOrdinal < lane.laneFloorPeriod || lane.targetPeriodOrdinal > lane.laneCeilingPeriod) {
      return 'lane_target_out_of_bounds'
    }
  }
  if (live && historical && !(historical.laneCeilingPeriod < live.laneFloorPeriod)) return 'lane_overlap'
  return null
}

/**
 * `liveFloor` — the earliest period the live lane can meaningfully observe.
 *
 * Preference order:
 *   1. the earliest settle-eligible period WITH evidence that also has `requiredLookback`
 *      periods of evidence at or before it, so its own history is present;
 *   2. failing that, the earliest settle-eligible period with evidence;
 *   3. failing that, the first scheduled period — a preseason league with no evidence yet
 *      starts at the beginning and simply defers until finality appears.
 */
export function resolveLiveFloor(input: LanePlanInput): number {
  const scheduled = input.scheduledPeriods
  const evidence = [...new Set(input.availableEvidencePeriods)].sort((a, b) => a - b)
  const settleable = new Set(scheduled.filter(p => input.settleEligibleAt(p) <= input.nowMs))
  const usable = evidence.filter(p => settleable.has(p))

  for (let i = 0; i < usable.length; i += 1) {
    if (i + 1 >= input.requiredLookback) return usable[i]
  }
  if (usable.length) return usable[0]
  return scheduled[0]
}

export function planLanes(input: LanePlanInput): LanePlan {
  const scheduled = input.scheduledPeriods
  if (!scheduled.length) return refuse('schedule_empty')
  if (!isConsecutiveSchedule(scheduled)) return refuse('schedule_not_consecutive')
  if (!Number.isInteger(input.requiredLookback) || input.requiredLookback < 1) {
    return refuse('required_lookback_invalid')
  }

  const firstScheduled = scheduled[0]
  const lastScheduled = scheduled[scheduled.length - 1]

  const scheduledSet = new Set(scheduled)
  for (const p of input.availableEvidencePeriods) {
    if (!scheduledSet.has(p)) return refuse('evidence_outside_schedule')
  }

  // A season is complete when its FINAL scheduled period is already settle-eligible. That is
  // a property of the calendar and the clock, never of whether evidence happens to exist.
  const seasonCompleted = input.settleEligibleAt(lastScheduled) <= input.nowMs

  if (seasonCompleted) {
    const historical: LaneSpec = {
      processingLane: 'historical_backfill',
      laneFloorPeriod: firstScheduled,
      laneCeilingPeriod: lastScheduled,
      targetPeriodOrdinal: firstScheduled,   // scheduled, not first-with-evidence
      blocksLiveSettlement: false,           // there is no live sibling to block
    }
    const invalid = validateLanes(null, historical)
    if (invalid) return refuse(invalid)
    return { kind: 'plan', state: 'completed_season_backfill', live: null, historical }
  }

  const liveFloor = resolveLiveFloor(input)
  const live: LaneSpec = {
    processingLane: 'live',
    laneFloorPeriod: liveFloor,
    laneCeilingPeriod: lastScheduled,
    targetPeriodOrdinal: liveFloor,
    blocksLiveSettlement: false,
  }

  if (liveFloor <= firstScheduled) {
    const invalid = validateLanes(live, null)
    if (invalid) return refuse(invalid)
    return { kind: 'plan', state: 'ongoing_live_only', live, historical: null }
  }

  const historical: LaneSpec = {
    processingLane: 'historical_backfill',
    laneFloorPeriod: firstScheduled,
    laneCeilingPeriod: liveFloor - 1,
    targetPeriodOrdinal: firstScheduled,     // scheduled, not first-with-evidence
    blocksLiveSettlement: true,              // live cannot durably settle until this exhausts
  }
  const invalid = validateLanes(live, historical)
  if (invalid) return refuse(invalid)
  return { kind: 'plan', state: 'ongoing_with_seed', live, historical }
}
