import { describe, expect, it } from 'vitest'
import {
  planLanes,
  resolveLiveFloor,
  validateLanes,
  type LanePlanInput,
  type LaneSpec,
} from '@/lib/decision-os/value-v2/lanePlanner'
import { resolveScheduledPeriods } from '@/lib/decision-os/value-v2/periodCalendar'

/** Deterministic calendar: period p settles at p * WEEK after an epoch. */
const EPOCH = 1_700_000_000_000
const WEEK = 7 * 24 * 60 * 60 * 1000
const settleEligibleAt = (p: number) => EPOCH + p * WEEK
/** "Now" just after period `p` became settle-eligible. */
const afterPeriod = (p: number) => settleEligibleAt(p) + 1

const schedule = (over: Parameters<typeof resolveScheduledPeriods>[0] | null = null) => {
  const r = resolveScheduledPeriods(over ?? {
    playoffStartPeriod: 15, playoffTeams: 4, weeksPerRound: 1,
    leagueSize: 12, maxScheduledPeriod: 25,
  })
  if (r.kind !== 'schedule') throw new Error(`expected schedule, got ${r.reason}`)
  return r.periods            // 1..16
}

const input = (over: Partial<LanePlanInput> = {}): LanePlanInput => ({
  scheduledPeriods: schedule(),
  availableEvidencePeriods: [],
  settleEligibleAt,
  nowMs: afterPeriod(6),
  requiredLookback: 3,
  ...over,
})

const planOf = (over: Partial<LanePlanInput> = {}) => {
  const p = planLanes(input(over))
  if (p.kind !== 'plan') throw new Error(`expected a plan, got refusal ${p.reason}`)
  return p
}

const refusalOf = (over: Partial<LanePlanInput> = {}) => {
  const p = planLanes(input(over))
  if (p.kind !== 'refused') throw new Error('expected a refusal, got a plan')
  return p.reason
}

describe('ongoing season without a seed lane', () => {
  it('creates only a live lane when the floor is the first period', () => {
    const p = planOf({ availableEvidencePeriods: [], nowMs: EPOCH - 1 })
    expect(p.state).toBe('ongoing_live_only')
    expect(p.historical).toBeNull()
    expect(p.live).toMatchObject({
      processingLane: 'live', laneFloorPeriod: 1, laneCeilingPeriod: 16,
      targetPeriodOrdinal: 1, blocksLiveSettlement: false,
    })
  })

  it('starts a preseason league at period 1 with no evidence at all', () => {
    expect(resolveLiveFloor(input({ availableEvidencePeriods: [], nowMs: EPOCH - 1 }))).toBe(1)
  })
})

describe('ongoing season requiring a seed lane', () => {
  it('creates two disjoint sibling lanes', () => {
    // Evidence for 1..6, now just after period 6: lookback of 3 is satisfied at period 3.
    const p = planOf({ availableEvidencePeriods: [1, 2, 3, 4, 5, 6], nowMs: afterPeriod(6) })
    expect(p.state).toBe('ongoing_with_seed')
    expect(p.live).toMatchObject({ laneFloorPeriod: 3, laneCeilingPeriod: 16, targetPeriodOrdinal: 3 })
    expect(p.historical).toMatchObject({
      laneFloorPeriod: 1, laneCeilingPeriod: 2, targetPeriodOrdinal: 1, blocksLiveSettlement: true,
    })
    expect(p.historical!.laneCeilingPeriod).toBeLessThan(p.live!.laneFloorPeriod)
  })

  it('produces a two-period seed for the canonical midseason case', () => {
    const p = planOf({ availableEvidencePeriods: [1, 2, 3, 4, 5, 6, 7, 8, 9], nowMs: afterPeriod(9) })
    expect(p.live!.laneFloorPeriod).toBe(3)
    expect(p.historical!.laneFloorPeriod).toBe(1)
    expect(p.historical!.laneCeilingPeriod).toBe(2)
  })

  it('marks the seed lane as blocking live settlement', () => {
    const p = planOf({ availableEvidencePeriods: [1, 2, 3, 4], nowMs: afterPeriod(4) })
    expect(p.historical!.blocksLiveSettlement).toBe(true)
    expect(p.live!.blocksLiveSettlement).toBe(false)
  })
})

describe('historical lanes start at the SCHEDULE, not at the evidence', () => {
  it('targets period 1 even when the first evidence is period 3', () => {
    // Weeks 1-2 have no matchups. They must still be targeted, deferred and SKIPped —
    // otherwise a missing week 1 vanishes and weeks 2-4 read as three consecutive periods.
    const p = planOf({ availableEvidencePeriods: [3, 4, 5, 6, 7], nowMs: afterPeriod(7) })
    expect(p.historical).not.toBeNull()
    expect(p.historical!.laneFloorPeriod).toBe(1)
    expect(p.historical!.targetPeriodOrdinal).toBe(1)
    expect(p.historical!.targetPeriodOrdinal).not.toBe(3)
  })

  it('handles sparse evidence without moving any lane boundary', () => {
    const dense = planOf({ availableEvidencePeriods: [1, 2, 3, 4, 5, 6], nowMs: afterPeriod(6) })
    const sparse = planOf({ availableEvidencePeriods: [1, 3, 5], nowMs: afterPeriod(6) })
    // Sparse evidence changes WHERE the live floor can sit, but never the seed lane's floor.
    expect(sparse.historical!.laneFloorPeriod).toBe(dense.historical!.laneFloorPeriod)
    expect(sparse.historical!.targetPeriodOrdinal).toBe(1)
  })
})

describe('completed season', () => {
  const completed = { nowMs: afterPeriod(16) }

  it('creates one historical lane spanning the whole schedule and no live lane', () => {
    const p = planOf({ ...completed, availableEvidencePeriods: [1, 2, 3, 4, 5, 6] })
    expect(p.state).toBe('completed_season_backfill')
    expect(p.live).toBeNull()
    expect(p.historical).toMatchObject({
      laneFloorPeriod: 1, laneCeilingPeriod: 16, targetPeriodOrdinal: 1,
      blocksLiveSettlement: false,
    })
  })

  it('creates the lane automatically even with no matchup evidence at all', () => {
    // An imported completed season with no evidence still owns its schedule: every period is
    // targeted and closed by a SKIP. Nothing is synthesised.
    const p = planOf({ ...completed, availableEvidencePeriods: [] })
    expect(p.state).toBe('completed_season_backfill')
    expect(p.historical!.laneFloorPeriod).toBe(1)
    expect(p.historical!.laneCeilingPeriod).toBe(16)
    expect(p.historical!.targetPeriodOrdinal).toBe(1)
  })

  it('does not require an operator trigger', () => {
    expect(planOf({ ...completed, availableEvidencePeriods: [] }).historical).not.toBeNull()
  })
})

describe('bounds, disjointness and determinism', () => {
  it('keeps every target inside its lane bounds', () => {
    for (const evidence of [[], [1], [1, 2, 3], [1, 2, 3, 4, 5, 6], [3, 4, 5]]) {
      const p = planOf({ availableEvidencePeriods: evidence, nowMs: afterPeriod(6) })
      for (const lane of [p.live, p.historical]) {
        if (!lane) continue
        expect(lane.targetPeriodOrdinal).toBeGreaterThanOrEqual(lane.laneFloorPeriod)
        expect(lane.targetPeriodOrdinal).toBeLessThanOrEqual(lane.laneCeilingPeriod)
        expect(lane.laneCeilingPeriod).toBeGreaterThanOrEqual(lane.laneFloorPeriod)
      }
    }
  })

  it('rejects overlapping lanes before they can be persisted', () => {
    const live: LaneSpec = {
      processingLane: 'live', laneFloorPeriod: 3, laneCeilingPeriod: 16,
      targetPeriodOrdinal: 3, blocksLiveSettlement: false,
    }
    const overlapping: LaneSpec = {
      processingLane: 'historical_backfill', laneFloorPeriod: 1, laneCeilingPeriod: 3,
      targetPeriodOrdinal: 1, blocksLiveSettlement: true,
    }
    expect(validateLanes(live, overlapping)).toBe('lane_overlap')
    expect(validateLanes(live, { ...overlapping, laneCeilingPeriod: 2 })).toBeNull()
  })

  it('rejects a target outside its bounds', () => {
    expect(validateLanes({
      processingLane: 'live', laneFloorPeriod: 3, laneCeilingPeriod: 16,
      targetPeriodOrdinal: 17, blocksLiveSettlement: false,
    }, null)).toBe('lane_target_out_of_bounds')
  })

  it('rejects inverted or non-integer bounds', () => {
    expect(validateLanes({
      processingLane: 'live', laneFloorPeriod: 9, laneCeilingPeriod: 4,
      targetPeriodOrdinal: 9, blocksLiveSettlement: false,
    }, null)).toBe('lane_bounds_invalid')
    expect(validateLanes({
      processingLane: 'live', laneFloorPeriod: 0, laneCeilingPeriod: 4,
      targetPeriodOrdinal: 1, blocksLiveSettlement: false,
    }, null)).toBe('lane_bounds_invalid')
  })

  it('is deterministic for identical inputs', () => {
    const a = planLanes(input({ availableEvidencePeriods: [1, 2, 3, 4], nowMs: afterPeriod(4) }))
    const b = planLanes(input({ availableEvidencePeriods: [1, 2, 3, 4], nowMs: afterPeriod(4) }))
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })
})

describe('malformed input is refused', () => {
  it('refuses an empty schedule', () => {
    expect(refusalOf({ scheduledPeriods: [] })).toBe('schedule_empty')
  })

  it('refuses a non-consecutive schedule', () => {
    expect(refusalOf({ scheduledPeriods: [1, 2, 4, 5] })).toBe('schedule_not_consecutive')
    expect(refusalOf({ scheduledPeriods: [2, 3, 4] })).toBe('schedule_not_consecutive')
  })

  it('refuses evidence outside the schedule', () => {
    expect(refusalOf({ availableEvidencePeriods: [1, 2, 99] })).toBe('evidence_outside_schedule')
  })

  it('refuses an invalid lookback', () => {
    expect(refusalOf({ requiredLookback: 0 })).toBe('required_lookback_invalid')
    expect(refusalOf({ requiredLookback: 1.5 })).toBe('required_lookback_invalid')
  })
})
