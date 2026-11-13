/**
 * Best Ball / Guilly audit, 2026-11-06 — the consequential rules, pinned against the code that runs
 * them in production:
 *   - the exact optimizer (`computeOptimalLineup`) that native matchups, standings and Guilly chops use;
 *   - the league's real slot eligibility (`buildBestBallSlots`) for NHL goalies, MLB pitchers and NFL flex;
 *   - MLB innings in baseball notation;
 *   - Classic Best Ball's saved "no waivers / no free agency" policy, enforced by the waiver phase gate;
 *   - chopped Guilly teams refused by the roster transaction gate;
 *   - Best Ball / Guilly trades refused on the redraft trade path.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  league: { findUnique: vi.fn() },
  survivorGuillotineLeague: { findUnique: vi.fn() },
  survivorGuillotineChop: { count: vi.fn() },
  guillotineRosterState: { count: vi.fn() },
}))
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/league/commissioner-roster-lock', () => ({ isCommissionerRosterLocked: vi.fn(async () => false) }))
vi.mock('@/lib/zombie/zombieTradePolicy', () => ({ getZombieTradeRestriction: vi.fn(async () => null) }))
vi.mock('@/server/services/permissionService', () => ({ isElevatedCommissioner: vi.fn(async () => false) }))
vi.mock('@/lib/roster-legality/loadLegalityEvaluationContext', () => ({ evaluateLegalityForPersistedRoster: vi.fn(async () => null) }))

import { computeOptimalLineup, type LineupSlotSpec } from '@/lib/lineup-optimizer/optimalLineup'
import { buildBestBallSlots } from '@/lib/redraft/scoringEngine'
import { inningsFromBaseballNotation, normalizeMlbGameStats } from '@/lib/scoring-runtime/mlbStatNormalization'
import { resolveWaiverPhasePolicy } from '@/lib/waiver-wire/season-phase-policy'
import { resolveBestBallRosterPolicy } from '@/lib/waiver-wire/season-phase-gate'
import { assertRosterTransactionsAllowed } from '@/lib/roster-legality/rosterTransactionGates'
import { validateRedraftTradeProposalAtCreation } from '@/lib/redraft/tradeProposalValidation'

const p = (playerId: string, positions: string[], points: number) => ({ playerId, positions, points })

describe('exact best ball optimizer', () => {
  it('re-seats a dual-eligible player where a per-slot greedy pick would not', () => {
    // Greedy: RB <- A(30), WR <- C(5) = 35. Optimal: RB <- B(20), WR <- A(30) = 50.
    const r = computeOptimalLineup({
      slots: [{ slot: 'RB', eligible: ['RB'], count: 1 }, { slot: 'WR', eligible: ['WR'], count: 1 }],
      players: [p('A', ['RB', 'WR'], 30), p('B', ['RB'], 20), p('C', ['WR'], 5)],
    })
    expect(r.total).toBe(50)
  })

  it('never seats one player twice, even when his roster row arrives twice', () => {
    const r = computeOptimalLineup({
      slots: [{ slot: 'WR', eligible: ['WR'], count: 1 }, { slot: 'FLEX', eligible: ['RB', 'WR', 'TE'], count: 1 }],
      players: [p('WR_A', ['WR'], 30), p('WR_A', ['WR'], 30), p('RB_B', ['RB'], 10)],
    })
    expect(r.total).toBe(40)
    expect(r.assignments.map((a) => a.playerId).sort()).toEqual(['RB_B', 'WR_A'])
  })

  it('fills a required seat with a negative score rather than leaving it empty, and only as a last resort', () => {
    const r = computeOptimalLineup({
      slots: [{ slot: 'QB', eligible: ['QB'], count: 1 }, { slot: 'DEF', eligible: ['DEF'], count: 1 }],
      players: [p('QB1', ['QB'], 20), p('D1', ['DEF'], -4)],
    })
    expect(r.total).toBe(16)
    expect(r.unfilledSlots).toEqual([])
  })

  it('reports a seat nobody can fill instead of inventing a player', () => {
    const r = computeOptimalLineup({
      slots: [{ slot: 'G', eligible: ['G'], count: 1 }, { slot: 'C', eligible: ['C'], count: 1 }],
      players: [p('C1', ['C'], 12)],
    })
    expect(r.total).toBe(12)
    expect(r.unfilledSlots).toEqual([{ slot: 'G', seat: 1 }])
  })

  it('is deterministic on equal totals regardless of input order', () => {
    const slots: LineupSlotSpec[] = [{ slot: 'WR', eligible: ['WR'], count: 1 }]
    const a = computeOptimalLineup({ slots, players: [p('WR_Z', ['WR'], 10), p('WR_A', ['WR'], 10)] })
    const b = computeOptimalLineup({ slots, players: [p('WR_A', ['WR'], 10), p('WR_Z', ['WR'], 10)] })
    expect(a.assignments).toEqual(b.assignments)
    expect(a.assignments[0]!.playerId).toBe('WR_A')
  })

  it('weekly best ball (one lineup over weekly totals) is NOT the sum of daily optimal lineups', () => {
    // Two guards, one G seat. Mon: X 30, Y 0. Tue: X 0, Y 25.
    const slots: LineupSlotSpec[] = [{ slot: 'G', eligible: ['PG', 'SG', 'G'], count: 1 }]
    const weekly = computeOptimalLineup({ slots, players: [p('X', ['PG'], 30), p('Y', ['SG'], 25)] }).total
    const dailySum =
      computeOptimalLineup({ slots, players: [p('X', ['PG'], 30), p('Y', ['SG'], 0)] }).total +
      computeOptimalLineup({ slots, players: [p('X', ['PG'], 0), p('Y', ['SG'], 25)] }).total
    expect(weekly).toBe(30)
    expect(dailySum).toBe(55)
  })
})

describe('the league slot eligibility the production scorer uses', () => {
  const eligible = (sport: string) => {
    const slots = buildBestBallSlots(sport, {})
    return (pos: string) => slots.filter((s) => s.eligible.includes('*') || s.eligible.map((e) => e.toUpperCase()).includes(pos)).map((s) => s.slot)
  }

  it('NHL: a goalie can only fill a goalie slot, never a skater or UTIL slot', () => {
    const slotsFor = eligible('NHL')
    const goalieSlots = slotsFor('G')
    expect(goalieSlots.length).toBeGreaterThan(0)
    for (const s of goalieSlots) expect(s.toUpperCase()).toMatch(/^G/)
  })

  it('NHL: with two goalies and one goalie seat, the second goalie stays benched even with more points than a skater', () => {
    const slots = buildBestBallSlots('NHL', {})
    const goalieSeats = slots.filter((s) => s.eligible.includes('G')).reduce((n, s) => n + s.count, 0)
    const players = [
      ...Array.from({ length: goalieSeats + 1 }, (_, i) => p(`G${i}`, ['G'], 40 - i)),
      p('C1', ['C'], 1),
    ]
    const r = computeOptimalLineup({ slots, players })
    const seatedGoalies = r.assignments.filter((a) => a.playerId.startsWith('G'))
    expect(seatedGoalies).toHaveLength(goalieSeats)
    for (const a of seatedGoalies) expect(a.slot.toUpperCase()).toMatch(/^G/)
  })

  it('MLB: a hitter never fills a pitcher slot and a pitcher never fills a hitter slot', () => {
    const slotsFor = eligible('MLB')
    for (const s of slotsFor('SP')) expect(s.toUpperCase()).toMatch(/^(SP|RP|P)$/)
    for (const s of slotsFor('1B')) expect(s.toUpperCase()).not.toMatch(/^(SP|RP|P)$/)
  })
})

describe('MLB innings pitched', () => {
  it('reads 5.2 as five and two-thirds innings (17 outs), not the decimal 5.2', () => {
    expect(inningsFromBaseballNotation(5.2)).toBeCloseTo(17 / 3, 10)
    expect(inningsFromBaseballNotation(6.1)).toBeCloseTo(19 / 3, 10)
    const { stats } = normalizeMlbGameStats({ group: 'pitching', stats: { IP: 5.2 } })
    expect(stats.outs).toBe(17)
    expect(stats.ip).toBeCloseTo(17 / 3, 10)
  })
})

describe('Classic Best Ball transaction policy (waiver phase gate)', () => {
  const regular = { phase: 'regular' as const, offseasonRule: 'closed' as const, playoffRule: 'all_teams' as const, dynastyFamily: false, eliminated: null }

  it('a native Classic Best Ball league with waivers and free agency off takes no claims and no adds', () => {
    const policy = resolveWaiverPhasePolicy({ ...regular, bestBallRoster: { waiversEnabled: false, freeAgencyEnabled: false } })
    expect(policy.claimsAllowed).toBe(false)
    expect(policy.immediateAddsAllowed).toBe(false)
    expect(policy.code).toBe('best_ball_draft_only')
    // The claims route maps refusals that start this way to WAIVER_CLOSED.
    expect(policy.reason).toMatch(/^Waiver claims are closed/)
  })

  it('honours a commissioner who turned waivers on (managed Best Ball) while free agency stays off', () => {
    const policy = resolveWaiverPhasePolicy({ ...regular, bestBallRoster: { waiversEnabled: true, freeAgencyEnabled: false } })
    expect(policy.claimsAllowed).toBe(true)
    expect(policy.immediateAddsAllowed).toBe(false)
    expect(policy.code).toBe('best_ball_no_adds')
  })

  it('never widens a phase refusal, and keeps the phase reason', () => {
    const policy = resolveWaiverPhasePolicy({ ...regular, phase: 'pre_draft', bestBallRoster: { waiversEnabled: true, freeAgencyEnabled: true } })
    expect(policy.claimsAllowed).toBe(false)
    expect(policy.code).toBe('pre_draft_locked')
  })

  it('leaves every non-best-ball league exactly as before', () => {
    expect(resolveWaiverPhasePolicy({ ...regular, bestBallRoster: null })).toEqual(resolveWaiverPhasePolicy(regular))
  })

  it('detects native Classic Best Ball, and only that', () => {
    const classic = { platform: 'manual', bestBallMode: true, leagueType: 'best_ball', guillotineMode: false, bbWaiversEnabled: false, bbFaEnabled: false }
    expect(resolveBestBallRosterPolicy(classic)).toEqual({ waiversEnabled: false, freeAgencyEnabled: false })
    expect(resolveBestBallRosterPolicy({ ...classic, bbWaiversEnabled: null, bbFaEnabled: null })).toEqual({ waiversEnabled: false, freeAgencyEnabled: false })
    expect(resolveBestBallRosterPolicy({ ...classic, bbWaiversEnabled: true, bbFaEnabled: true })).toEqual({ waiversEnabled: true, freeAgencyEnabled: true })
    // Guilly + Best Ball: survivors must keep waivers/FAAB to claim released rosters.
    expect(resolveBestBallRosterPolicy({ platform: 'manual', bestBallMode: false, leagueType: 'guillotine', guillotineMode: true })).toBeNull()
    expect(resolveBestBallRosterPolicy({ ...classic, guillotineMode: true })).toBeNull()
    // An imported best ball league's waivers are the platform's call.
    expect(resolveBestBallRosterPolicy({ ...classic, platform: 'sleeper' })).toBeNull()
    expect(resolveBestBallRosterPolicy({ platform: 'manual', bestBallMode: false, leagueType: 'redraft' })).toBeNull()
  })
})

describe('roster transaction gate: chopped Guilly teams', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.league.findUnique.mockResolvedValue({ id: 'L1', settings: {}, leagueVariant: 'guillotine' })
    prismaMock.survivorGuillotineChop.count.mockResolvedValue(0)
  })

  it('refuses an eliminated native Guilly roster', async () => {
    prismaMock.guillotineRosterState.count.mockResolvedValue(1)
    const r = await assertRosterTransactionsAllowed({ leagueId: 'L1', rosterIds: ['R1'], userId: 'U1', kind: 'waiver_claim' })
    expect(r).toMatchObject({ ok: false, code: 'ELIMINATED_ROSTER' })
    expect(prismaMock.guillotineRosterState.count).toHaveBeenCalledWith({
      where: { leagueId: 'L1', rosterId: { in: ['R1'] }, choppedAt: { not: null } },
    })
  })

  it('lets a surviving roster through', async () => {
    prismaMock.guillotineRosterState.count.mockResolvedValue(0)
    const r = await assertRosterTransactionsAllowed({ leagueId: 'L1', rosterIds: ['R1'], userId: 'U1', kind: 'trade' })
    expect(r).toEqual({ ok: true })
  })
})

describe('redraft trade path honours Best Ball / Guilly trade rules', () => {
  const input = { leagueId: 'L1', seasonId: 'S1', proposerRosterId: 'A', receiverRosterId: 'B', assets: [] }
  const dbWith = (league: Record<string, unknown>) =>
    ({ league: { findUnique: vi.fn(async () => ({ id: 'L1', settings: {}, platform: 'manual', lockAllMoves: false, ...league })) } }) as never

  it('refuses a trade in a native Classic Best Ball league', async () => {
    const r = await validateRedraftTradeProposalAtCreation(input, dbWith({ bestBallMode: true, guillotineMode: false }))
    expect(r).toMatchObject({ ok: false, code: 'TRADES_DISABLED' })
  })

  it('refuses a trade in a Guilly league whose settings do not enable trades', async () => {
    const r = await validateRedraftTradeProposalAtCreation(input, dbWith({ bestBallMode: false, guillotineMode: true }))
    expect(r).toMatchObject({ ok: false, code: 'TRADES_DISABLED' })
  })
})
