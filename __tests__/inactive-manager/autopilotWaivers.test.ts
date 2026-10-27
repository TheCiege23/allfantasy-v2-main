/** Chimmy autopilot waivers: fill holes only, in the team's style, never dropping what it protects. */
import { describe, expect, it } from 'vitest'
import type { ExpandedStarterSlot } from '@/lib/league/lineup-expand-template'
import { AUTOPILOT_FAAB_SHARE, autopilotFaabBid, planAutopilotWaivers, unfillableSlots, type AutopilotPlayer } from '@/lib/inactive-manager/autopilotWaivers'

const slot = (index: number, label: string, allowedPositions: string[]): ExpandedStarterSlot =>
  ({ index, label, allowedPositions, isFlexible: allowedPositions.length > 1 }) as ExpandedStarterSlot
const SLOTS = [slot(0, 'QB', ['QB']), slot(1, 'RB', ['RB']), slot(2, 'FLEX', ['RB', 'WR', 'TE'])]
const P = (id: string, position: string, projectedPoints: number, extra: Partial<AutopilotPlayer> = {}): AutopilotPlayer => ({ id, position, projectedPoints, ...extra })

const roster = {
  qb: P('qb', 'QB', 20),
  rb: P('rb', 'RB', 14, { injuryStatus: 'Out' }),
  wr: P('wr', 'WR', 11),
  oldBench: P('oldBench', 'TE', 2, { yearsExp: 9 }),
  kidBench: P('kidBench', 'WR', 1, { yearsExp: 1 }),
}
const base = {
  slots: SLOTS,
  starters: ['qb', 'rb', 'wr'],
  bench: ['oldBench', 'kidBench'],
  players: roster as Record<string, AutopilotPlayer>,
  benchCapacity: 2,
}
const FA = [P('vetRb', 'RB', 10, { yearsExp: 7 }), P('kidRb', 'RB', 9.5, { yearsExp: 1 }), P('hurtRb', 'RB', 30, { injuryStatus: 'IR' })]

describe('unfillableSlots', () => {
  it('finds the slot only a ruled-out player could fill, and fills restrictive slots first', () => {
    expect(unfillableSlots(SLOTS, ['qb', 'rb', 'wr', 'oldBench'], roster).map((s) => s.label)).toEqual(['RB'])
  })
  it('a healthy roster has no holes', () => {
    expect(unfillableSlots(SLOTS, ['qb', 'rb', 'wr', 'oldBench'], { ...roster, rb: P('rb', 'RB', 14) } as never)).toEqual([])
  })
})

describe('planAutopilotWaivers', () => {
  it('dynasty owner: a young player wins a near-tie, and the old bench player — not the young one — is dropped', () => {
    expect(planAutopilotWaivers({ ...base, style: 'dynasty_owner', freeAgents: FA })).toEqual({
      claims: [{ slot: 'RB', addPlayerId: 'kidRb', dropPlayerId: 'oldBench' }],
      unfilled: [],
    })
  })

  it('win now: the best projection, whoever it is', () => {
    expect(planAutopilotWaivers({ ...base, style: 'win_now', freeAgents: FA }).claims[0]).toMatchObject({ addPlayerId: 'vetRb' })
  })

  it('never claims a ruled-out player, however good his projection', () => {
    const plan = planAutopilotWaivers({ ...base, style: 'win_now', freeAgents: FA })
    expect(plan.claims.map((c) => c.addPlayerId)).not.toContain('hurtRb')
  })

  it('dynasty owner will not cut a young player to make room; with nobody else to drop, the hole stays open', () => {
    const plan = planAutopilotWaivers({ ...base, bench: ['kidBench'], benchCapacity: 1, style: 'dynasty_owner', freeAgents: FA })
    expect(plan).toEqual({ claims: [], unfilled: ['RB'] })
    // win_now has no such protection.
    expect(planAutopilotWaivers({ ...base, bench: ['kidBench'], benchCapacity: 1, style: 'win_now', freeAgents: FA }).claims[0]).toMatchObject({ dropPlayerId: 'kidBench' })
  })

  it('claims without a drop when the bench has room, or when its size is unknown', () => {
    expect(planAutopilotWaivers({ ...base, benchCapacity: 5, style: 'win_now', freeAgents: FA }).claims[0]).toMatchObject({ dropPlayerId: null })
    expect(planAutopilotWaivers({ ...base, benchCapacity: null, style: 'win_now', freeAgents: FA }).claims[0]).toMatchObject({ dropPlayerId: null })
  })

  it('does nothing for a healthy, full lineup, and skips players it already has a claim on', () => {
    const healthy = { ...roster, rb: P('rb', 'RB', 14) }
    expect(planAutopilotWaivers({ ...base, players: healthy, style: 'win_now', freeAgents: FA }).claims).toEqual([])
    expect(planAutopilotWaivers({ ...base, style: 'win_now', freeAgents: FA, pendingAddIds: ['vetRb'] }).claims[0]).toMatchObject({ addPlayerId: 'kidRb' })
  })

  it('stops at the per-run cap', () => {
    const hurt = { ...roster, qb: P('qb', 'QB', 20, { injuryStatus: 'Out' }) }
    const plan = planAutopilotWaivers({ ...base, players: hurt, benchCapacity: 9, style: 'win_now', freeAgents: [...FA, P('qb2', 'QB', 15)], maxClaims: 1 })
    expect(plan.claims).toHaveLength(1)
    expect(plan.unfilled).toHaveLength(1)
  })
})

describe('autopilotFaabBid', () => {
  const base = { style: 'dynasty_owner' as const, faab: true, budget: 100, remaining: 100, minBid: null, allowZero: true }

  it('bids the style’s modest share of the budget', () => {
    expect(autopilotFaabBid(base)).toBe(Math.round(100 * AUTOPILOT_FAAB_SHARE.dynasty_owner))
    expect(autopilotFaabBid({ ...base, style: 'win_now' })).toBe(8)
    expect(autopilotFaabBid({ ...base, style: 'rebuild' })).toBe(2)
  })

  it('never bids below the league minimum, or $0 where the league refuses it', () => {
    expect(autopilotFaabBid({ ...base, style: 'rebuild', minBid: 5 })).toBe(5)
    expect(autopilotFaabBid({ ...base, budget: 10, style: 'rebuild', allowZero: false })).toBe(1)
  })

  it('never bids more than the team has left, and makes no claim it cannot afford', () => {
    expect(autopilotFaabBid({ ...base, style: 'win_now', remaining: 3 })).toBe(3)
    expect(autopilotFaabBid({ ...base, remaining: 2, minBid: 5 })).toBe('unaffordable')
    expect(autopilotFaabBid({ ...base, remaining: 0, allowZero: false })).toBe('unaffordable')
  })

  it('has no bid outside a FAAB league', () => {
    expect(autopilotFaabBid({ ...base, faab: false })).toBeNull()
  })
})
