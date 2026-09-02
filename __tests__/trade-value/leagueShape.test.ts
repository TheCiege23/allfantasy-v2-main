/**
 * LeagueShape — pure structural facts about a league.
 *
 * The fixtures are REAL leagues, not synthetic ones, because the bugs this module fixes were all
 * found by looking at real settings:
 *   Four Horsemen  4 teams, 4QB/4RB/6WR/4TE/10FLEX, 32 bench, 10 taxi, 10 IR   (rules PDF)
 *   KBFL          32 teams, 1QB/3RB/2WR/TE/K + IDP, dynasty PPR TEP            (league screen)
 */

import { describe, expect, it } from 'vitest'
import {
  DEMAND_MULTIPLIER_MAX,
  DEMAND_MULTIPLIER_MIN,
  REFERENCE_SHAPE,
  buildLeagueShape,
  demandMultiplier,
  isPastTradeDeadline,
  leaguewideStarters,
  rosteredPlayers,
  stashCapacity,
} from '@/lib/trade-value/leagueShape'

/** Four Horsemen: 4 QB, 4 RB, 6 WR, 4 TE, 10 FLEX = 28 starters. */
const FOUR_HORSEMEN_SLOTS = [
  ...Array(4).fill('QB'),
  ...Array(4).fill('RB'),
  ...Array(6).fill('WR'),
  ...Array(4).fill('TE'),
  ...Array(10).fill('FLEX'),
]

/** KBFL, read off the matchup screen: QB, 3 RB, 2 WR, TE, K, DE, 2 DL, 3 LB, CB, DB. */
const KBFL_SLOTS = [
  'QB', 'RB', 'RB', 'RB', 'WR', 'WR', 'TE', 'K',
  'DE', 'DL', 'DL', 'LB', 'LB', 'LB', 'CB', 'DB',
]

const STANDARD_12 = ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF']

describe('buildLeagueShape', () => {
  it('refuses rather than defaulting when team count is unusable', () => {
    expect(buildLeagueShape({ teams: 0, starterSlots: STANDARD_12 })).toBeNull()
    expect(buildLeagueShape({ teams: 1, starterSlots: STANDARD_12 })).toBeNull()
    expect(buildLeagueShape({ teams: NaN, starterSlots: STANDARD_12 })).toBeNull()
  })

  it('refuses when there are no recognisable starter slots', () => {
    expect(buildLeagueShape({ teams: 12, starterSlots: [] })).toBeNull()
    expect(buildLeagueShape({ teams: 12, starterSlots: null })).toBeNull()
    // BN / IR / TAXI are not starting slots, so a roster of only those has no shape.
    expect(buildLeagueShape({ teams: 12, starterSlots: ['BN', 'BN', 'IR', 'TAXI'] })).toBeNull()
  })

  it('counts Four Horsemen exactly: 4 dedicated QB and 10 flex', () => {
    const shape = buildLeagueShape({
      teams: 4,
      starterSlots: FOUR_HORSEMEN_SLOTS,
      rosterSize: 80,
      irSlots: 10,
      taxiSlots: 10,
      deadlineWeek: 13,
    })!
    expect(shape).not.toBeNull()
    expect(shape.teams).toBe(4)
    expect(shape.dedicatedStarters.QB).toBe(4)
    expect(shape.dedicatedStarters.WR).toBe(6)
    expect(shape.totalStarters).toBe(28)
    expect(shape.flexGroups).toHaveLength(1)
    expect(shape.flexGroups[0].count).toBe(10)
    // FLEX is RB/WR/TE — NOT superflex. A QB may not fill it.
    expect(shape.superflexSlots).toBe(0)
    expect(shape.benchSlots).toBe(52) // 80 − 28
  })

  it('does not count BN/IR/TAXI as starters', () => {
    const shape = buildLeagueShape({
      teams: 12,
      starterSlots: [...STANDARD_12, 'BN', 'BN', 'BN', 'IR', 'TAXI'],
    })!
    expect(shape.totalStarters).toBe(9)
  })

  it('separates superflex from a plain flex', () => {
    const sf = buildLeagueShape({ teams: 12, starterSlots: [...STANDARD_12, 'SUPER_FLEX'] })!
    expect(sf.superflexSlots).toBe(1)
    const plain = buildLeagueShape({ teams: 12, starterSlots: [...STANDARD_12, 'FLEX'] })!
    expect(plain.superflexSlots).toBe(0)
  })

  it('groups distinct flex eligibilities separately', () => {
    const shape = buildLeagueShape({
      teams: 12,
      starterSlots: ['QB', 'FLEX', 'FLEX', 'REC_FLEX', 'SUPER_FLEX'],
    })!
    // FLEX×2, REC_FLEX×1, SUPER_FLEX×1 => three distinct groups.
    expect(shape.flexGroups).toHaveLength(3)
    expect(shape.flexGroups.find((g) => g.count === 2)?.eligible).toEqual(['RB', 'WR', 'TE'])
  })
})

describe('leaguewideStarters — demand is teams × slots, and neither factor alone explains it', () => {
  it('a 4-team league can need MORE starting QBs than a 12-team league', () => {
    const horsemen = buildLeagueShape({ teams: 4, starterSlots: FOUR_HORSEMEN_SLOTS })!
    const standard = buildLeagueShape({ teams: 12, starterSlots: STANDARD_12 })!

    expect(leaguewideStarters(horsemen, 'QB')).toBe(16) // 4 teams × 4 QB
    expect(leaguewideStarters(standard, 'QB')).toBe(12) // 12 teams × 1 QB
    // The headline: fewer teams, more quarterbacks needed.
    expect(leaguewideStarters(horsemen, 'QB')).toBeGreaterThan(leaguewideStarters(standard, 'QB'))
  })

  it('KBFL 32-team needs far more of every offensive position', () => {
    const kbfl = buildLeagueShape({ teams: 32, starterSlots: KBFL_SLOTS })!
    expect(leaguewideStarters(kbfl, 'QB')).toBe(32)
    expect(leaguewideStarters(kbfl, 'RB')).toBe(96) // 32 × 3
    expect(leaguewideStarters(kbfl, 'LB')).toBe(96) // 32 × 3 — IDP demand is real demand
  })

  it('splits flex evenly across its eligible positions', () => {
    const shape = buildLeagueShape({ teams: 10, starterSlots: ['RB', 'FLEX', 'FLEX', 'FLEX'] })!
    // RB gets 1 dedicated + 3 flex / 3 eligible = 2 per team, × 10 teams.
    expect(leaguewideStarters(shape, 'RB')).toBe(20)
    // WR gets flex share only: 3/3 = 1 per team.
    expect(leaguewideStarters(shape, 'WR')).toBe(10)
  })

  it("counts Four Horsemen's 10 flex slots rather than discarding them", () => {
    const horsemen = buildLeagueShape({ teams: 4, starterSlots: FOUR_HORSEMEN_SLOTS })!
    // WR: 6 dedicated + 10/3 flex share = 9.333 per team × 4 = 37.33
    const wr = leaguewideStarters(horsemen, 'WR')
    expect(wr).toBeCloseTo(37.33, 1)
    // If flex were discarded it would be exactly 24. The gap IS the finding.
    expect(wr).toBeGreaterThan(24)
  })

  it('returns 0 for a position the league does not start at all', () => {
    const shape = buildLeagueShape({ teams: 12, starterSlots: STANDARD_12 })!
    expect(leaguewideStarters(shape, 'LB')).toBe(0)
  })
})

describe('demandMultiplier', () => {
  it('is exactly 1.0 for the reference league, so standard leagues are unchanged', () => {
    const standard = buildLeagueShape({ teams: 12, starterSlots: STANDARD_12, rosterSize: 15 })!
    for (const pos of ['QB', 'RB', 'WR', 'TE']) {
      expect(demandMultiplier(standard, pos)).toBeCloseTo(1.0, 10)
    }
  })

  it('is 1.0 when no shape is supplied — the additive guarantee', () => {
    expect(demandMultiplier(null, 'QB')).toBe(1.0)
    expect(demandMultiplier(undefined, 'RB')).toBe(1.0)
  })

  it('raises QB demand in Four Horsemen above a standard league', () => {
    const horsemen = buildLeagueShape({ teams: 4, starterSlots: FOUR_HORSEMEN_SLOTS })!
    const m = demandMultiplier(horsemen, 'QB')
    // 16/12 = 1.333, damped by exponent 0.5 => ~1.155
    expect(m).toBeGreaterThan(1.0)
    expect(m).toBeCloseTo(Math.sqrt(16 / 12), 3)
  })

  it('raises QB demand in a 32-team league further still', () => {
    const kbfl = buildLeagueShape({ teams: 32, starterSlots: KBFL_SLOTS })!
    const horsemen = buildLeagueShape({ teams: 4, starterSlots: FOUR_HORSEMEN_SLOTS })!
    expect(demandMultiplier(kbfl, 'QB')).toBeGreaterThan(demandMultiplier(horsemen, 'QB'))
  })

  it('distinguishes 2QB, 4QB and 6QB — the boolean model could not', () => {
    const base = ['RB', 'RB', 'WR', 'WR', 'TE', 'FLEX']
    const mult = (qbs: number) =>
      demandMultiplier(
        buildLeagueShape({ teams: 12, starterSlots: [...Array(qbs).fill('QB'), ...base] })!,
        'QB',
      )
    const m1 = mult(1)
    const m2 = mult(2)
    const m4 = mult(4)
    const m6 = mult(6)
    expect(m2).toBeGreaterThan(m1)
    expect(m4).toBeGreaterThan(m2)
    expect(m6).toBeGreaterThan(m4)
    // Four distinct values — the exact thing the isSuperflex/is2QB booleans collapsed.
    expect(new Set([m1, m2, m4, m6]).size).toBe(4)
  })

  it('is clamped at both ends so an extreme league cannot run away', () => {
    const extreme = buildLeagueShape({
      teams: 32,
      starterSlots: [...Array(12).fill('QB'), 'RB', 'WR'],
    })!
    expect(demandMultiplier(extreme, 'QB')).toBeLessThanOrEqual(DEMAND_MULTIPLIER_MAX)
    expect(demandMultiplier(extreme, 'QB')).toBeGreaterThanOrEqual(DEMAND_MULTIPLIER_MIN)
  })

  it('returns 1.0 for IDP positions, leaving them to the league-derived idpValue', () => {
    const kbfl = buildLeagueShape({ teams: 32, starterSlots: KBFL_SLOTS })!
    // The reference league starts no linebackers, so there is no baseline to compare against.
    expect(demandMultiplier(kbfl, 'LB')).toBe(1.0)
    expect(demandMultiplier(kbfl, 'DB')).toBe(1.0)
  })

  it('REFERENCE_SHAPE agrees with a shape built from its own slots', () => {
    const rebuilt = buildLeagueShape({
      teams: REFERENCE_SHAPE.teams,
      starterSlots: REFERENCE_SHAPE.starterSlots,
      rosterSize: REFERENCE_SHAPE.rosterSize,
    })!
    for (const pos of ['QB', 'RB', 'WR', 'TE']) {
      expect(leaguewideStarters(rebuilt, pos)).toBeCloseTo(leaguewideStarters(REFERENCE_SHAPE, pos), 10)
    }
  })
})

describe('roster depth helpers', () => {
  it('rosteredPlayers multiplies teams by roster size', () => {
    const horsemen = buildLeagueShape({ teams: 4, starterSlots: FOUR_HORSEMEN_SLOTS, rosterSize: 80 })!
    expect(rosteredPlayers(horsemen)).toBe(320)
  })

  it('rosteredPlayers is null when roster size is unknown, never guessed', () => {
    const shape = buildLeagueShape({ teams: 12, starterSlots: STANDARD_12 })!
    expect(rosteredPlayers(shape)).toBeNull()
  })

  it('stashCapacity adds taxi and IR, and is null when neither is known', () => {
    const horsemen = buildLeagueShape({
      teams: 4, starterSlots: FOUR_HORSEMEN_SLOTS, irSlots: 10, taxiSlots: 10,
    })!
    expect(stashCapacity(horsemen)).toBe(20)
    const bare = buildLeagueShape({ teams: 12, starterSlots: STANDARD_12 })!
    expect(stashCapacity(bare)).toBeNull()
  })
})

describe('isPastTradeDeadline', () => {
  const horsemen = buildLeagueShape({
    teams: 4, starterSlots: FOUR_HORSEMEN_SLOTS, deadlineWeek: 13,
  })!

  it('is false before and on the deadline week', () => {
    expect(isPastTradeDeadline(horsemen, 12)).toBe(false)
    expect(isPastTradeDeadline(horsemen, 13)).toBe(false)
  })

  it('is true after it', () => {
    expect(isPastTradeDeadline(horsemen, 14)).toBe(true)
  })

  it('never assumes closed when the deadline or week is unknown', () => {
    const noDeadline = buildLeagueShape({ teams: 12, starterSlots: STANDARD_12 })!
    expect(isPastTradeDeadline(noDeadline, 16)).toBe(false)
    expect(isPastTradeDeadline(horsemen, null)).toBe(false)
  })
})
