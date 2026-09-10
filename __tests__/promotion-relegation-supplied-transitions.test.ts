import { beforeEach, describe, expect, it, vi } from 'vitest'

/* `vi.mock` is hoisted above every top-level const, so the fns must be too. */
const {
  promotionRuleFindMany,
  leagueDivisionFindMany,
  leagueTeamFindMany,
  leagueTeamUpdate,
  transaction,
  getStandingsWithZonesMock,
} = vi.hoisted(() => ({
  promotionRuleFindMany: vi.fn(),
  leagueDivisionFindMany: vi.fn(),
  leagueTeamFindMany: vi.fn(),
  leagueTeamUpdate: vi.fn(),
  transaction: vi.fn(),
  getStandingsWithZonesMock: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    promotionRule: { findMany: promotionRuleFindMany },
    leagueDivision: { findMany: leagueDivisionFindMany },
    leagueTeam: { findMany: leagueTeamFindMany, update: leagueTeamUpdate },
    $transaction: transaction,
  },
}))

vi.mock('@/lib/promotion-relegation/StandingsEvaluator', () => ({
  getStandingsWithZones: getStandingsWithZonesMock,
}))

import { runPromotionRelegation } from '@/lib/promotion-relegation/PromotionEngine'
import type { SeasonEndTransition } from '@/lib/promotion-relegation/types'

/**
 * The additive supplied-transition path, and proof the standings-zone path is untouched.
 *
 * 🛑 THE SPLIT UNDER TEST: A RESOLVER DECIDES, THIS ENGINE APPLIES. Nothing in `PromotionEngine`
 * knows about promotion playoffs, relegation playoffs, tier exemptions or rookie draft rules.
 */

const DIVISIONS = [
  { id: 'div-1', tierLevel: 1 },
  { id: 'div-2', tierLevel: 2 },
  { id: 'div-3', tierLevel: 3 },
]

const TEAMS = [{ id: 'team-a' }, { id: 'team-b' }, { id: 'team-c' }]

const relegation = (over: Partial<SeasonEndTransition> = {}): SeasonEndTransition => ({
  teamId: 'team-a',
  teamName: 'Team A',
  fromDivisionId: 'div-1',
  fromTierLevel: 1,
  toDivisionId: 'div-2',
  toTierLevel: 2,
  type: 'relegation',
  ...over,
})

const promotion = (over: Partial<SeasonEndTransition> = {}): SeasonEndTransition => ({
  teamId: 'team-b',
  teamName: 'Team B',
  fromDivisionId: 'div-2',
  fromTierLevel: 2,
  toDivisionId: 'div-1',
  toTierLevel: 1,
  type: 'promotion',
  ...over,
})

beforeEach(() => {
  promotionRuleFindMany.mockReset()
  leagueDivisionFindMany.mockReset()
  leagueTeamFindMany.mockReset()
  leagueTeamUpdate.mockReset()
  transaction.mockReset()
  getStandingsWithZonesMock.mockReset()

  leagueTeamFindMany.mockResolvedValue(TEAMS)
  leagueDivisionFindMany.mockResolvedValue(DIVISIONS)
  transaction.mockResolvedValue([])
  leagueTeamUpdate.mockResolvedValue({})
})

describe('🛑 OMITTING transitions leaves the existing behaviour exactly as it was', () => {
  it('still computes from promotion rules and standings zones', async () => {
    promotionRuleFindMany.mockResolvedValue([
      { fromTierLevel: 1, toTierLevel: 2, promoteCount: 1, relegateCount: 1 },
    ])
    getStandingsWithZonesMock
      .mockResolvedValueOnce([
        { teamId: 'team-a', teamName: 'Team A', inRelegationZone: true, inPromotionZone: false },
      ])
      .mockResolvedValueOnce([
        { teamId: 'team-b', teamName: 'Team B', inRelegationZone: false, inPromotionZone: true },
      ])

    const result = await runPromotionRelegation({ leagueId: 'L1', dryRun: true })

    expect(getStandingsWithZonesMock).toHaveBeenCalledTimes(2)
    expect(result.source).toBe('standings_zones')
    expect(result.transitions.map((t) => `${t.teamId}:${t.type}`).sort()).toEqual([
      'team-a:relegation',
      'team-b:promotion',
    ])
  })

  it('applies through the original per-row update path, NOT the new transaction', async () => {
    /*
     * ⚠ THE TRANSACTION IS DELIBERATELY ONLY ON THE SUPPLIED PATH. Wrapping the existing one would
     * be a behaviour change to callers this parameter exists to leave alone.
     */
    promotionRuleFindMany.mockResolvedValue([
      { fromTierLevel: 1, toTierLevel: 2, promoteCount: 0, relegateCount: 1 },
    ])
    getStandingsWithZonesMock
      .mockResolvedValueOnce([{ teamId: 'team-a', teamName: 'Team A', inRelegationZone: true, inPromotionZone: false }])
      .mockResolvedValueOnce([])

    const result = await runPromotionRelegation({ leagueId: 'L1' })

    expect(result.applied).toBe(true)
    expect(leagueTeamUpdate).toHaveBeenCalledTimes(1)
    expect(transaction).not.toHaveBeenCalled()
  })

  it('never validates or reads teams when no plan is supplied', async () => {
    promotionRuleFindMany.mockResolvedValue([])
    const result = await runPromotionRelegation({ leagueId: 'L1', dryRun: true })
    expect(result.transitions).toEqual([])
    expect(leagueTeamFindMany).not.toHaveBeenCalled()
  })
})

describe('a supplied plan is applied without the engine computing anything', () => {
  it('does not consult promotion rules or standings at all', async () => {
    const result = await runPromotionRelegation({
      leagueId: 'L1',
      transitions: [relegation(), promotion()],
    })

    expect(result.applied).toBe(true)
    expect(result.source).toBe('supplied')
    expect(promotionRuleFindMany).not.toHaveBeenCalled()
    expect(getStandingsWithZonesMock).not.toHaveBeenCalled()
  })

  it('applies all-or-nothing in a transaction', async () => {
    await runPromotionRelegation({ leagueId: 'L1', transitions: [relegation(), promotion()] })
    expect(transaction).toHaveBeenCalledTimes(1)
    expect(leagueTeamUpdate).toHaveBeenCalledTimes(2)
  })

  it('dryRun returns the plan and writes nothing', async () => {
    const result = await runPromotionRelegation({
      leagueId: 'L1',
      dryRun: true,
      transitions: [relegation()],
    })
    expect(result.applied).toBe(false)
    expect(result.transitions).toHaveLength(1)
    expect(transaction).not.toHaveBeenCalled()
  })

  it('an empty supplied plan is a no-op, not a fallback to computing one', async () => {
    const result = await runPromotionRelegation({ leagueId: 'L1', transitions: [] })
    expect(result.source).toBe('supplied')
    expect(result.applied).toBe(false)
    expect(promotionRuleFindMany).not.toHaveBeenCalled()
  })
})

describe('🛑 a supplied plan is validated BEFORE the first write', () => {
  const expectRefused = async (transitions: SeasonEndTransition[], pattern: RegExp) => {
    const result = await runPromotionRelegation({ leagueId: 'L1', transitions })
    expect(result.applied).toBe(false)
    expect((result.rejected ?? []).join(' ')).toMatch(pattern)
    expect(transaction).not.toHaveBeenCalled()
    expect(leagueTeamUpdate).not.toHaveBeenCalled()
  }

  it('refuses a team that does not belong to this league', () =>
    expectRefused([relegation({ teamId: 'team-from-another-league' })], /not a team in this league/i))

  it('refuses a division that does not belong to this league', () =>
    expectRefused([relegation({ toDivisionId: 'div-elsewhere' })], /not a division in this league/i))

  it('refuses a team appearing twice', () =>
    expectRefused([relegation(), relegation({ toDivisionId: 'div-3', toTierLevel: 3 })], /more than once/i))

  it('refuses a move to the division the team is already in', () =>
    expectRefused([relegation({ toDivisionId: 'div-1' })], /already in/i))

  it('🛑 refuses an INVERTED promotion — tier 1 is the highest', () => {
    /*
     * A resolver with the orientation backwards would otherwise have its plan applied faithfully,
     * relegating the champions. Direction is checked against the real tier levels, never trusted
     * from the plan's own `type`.
     */
    return expectRefused(
      [promotion({ fromDivisionId: 'div-1', toDivisionId: 'div-2' })],
      /promotion must move to a higher tier/i,
    )
  })

  it('refuses an inverted relegation', () =>
    expectRefused(
      [relegation({ fromDivisionId: 'div-2', toDivisionId: 'div-1' })],
      /relegation must move to a lower tier/i,
    ))

  it('one bad entry refuses the WHOLE plan, so nothing lands half-applied', async () => {
    const result = await runPromotionRelegation({
      leagueId: 'L1',
      transitions: [relegation(), promotion({ teamId: 'nope' })],
    })
    expect(result.applied).toBe(false)
    expect(result.transitions).toEqual([])
    expect(leagueTeamUpdate).not.toHaveBeenCalled()
  })
})

describe('the engine stays free of competition policy', () => {
  it('its source file mentions no playoff, tier-exemption or draft concept', async () => {
    /*
     * ⚠ A STRUCTURAL ASSERTION, NOT A STYLE ONE. The user's ruling was that PromotionEngine may
     * accept a settled plan but must never learn promotion-playoff semantics, relegation-playoff
     * semantics, EFL tier rules or rookie draft rules. This fails the moment somebody starts moving
     * that logic in.
     */
    const fs = await import('node:fs/promises')
    const src = await fs.readFile('lib/promotion-relegation/PromotionEngine.ts', 'utf8')
    const body = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    expect(body).not.toMatch(/playoff/i)
    expect(body).not.toMatch(/rookie/i)
    expect(body).not.toMatch(/maxPf/i)
    expect(body).not.toMatch(/efl/i)
  })
})
