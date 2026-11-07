import { describe, expect, it } from 'vitest'
import { createSimRng, nflWaiverRunAt, nflWeekStart, runSeasonSim } from '@/lib/season-sim'
import { checkFaab, checkPlayerConservation, checkScoring } from '@/lib/season-sim/invariants'
import type { SimTeam } from '@/lib/season-sim/types'

describe('season sim — determinism', () => {
  it('the same seed replays the same season', () => {
    const a = runSeasonSim({ seed: 'determinism', teamCount: 8, regularSeasonWeeks: 6 })
    const b = runSeasonSim({ seed: 'determinism', teamCount: 8, regularSeasonWeeks: 6 })
    expect(b).toEqual(a)
  })

  it('a different seed plays a different season', () => {
    const a = runSeasonSim({ seed: 1, teamCount: 8, regularSeasonWeeks: 6 })
    const b = runSeasonSim({ seed: 2, teamCount: 8, regularSeasonWeeks: 6 })
    expect(b.signals).not.toEqual(a.signals)
  })

  it('rng forks are independent streams', () => {
    const root = createSimRng(7)
    const x = root.fork('stats').next()
    root.fork('bots').next()
    expect(createSimRng(7).fork('stats').next()).toBe(x)
  })
})

describe('season sim — clock', () => {
  it('week 1 is a Thursday in September and waivers clear the Wednesday before', () => {
    const kickoff = nflWeekStart(2026, 1)
    expect(kickoff.getUTCDay()).toBe(4)
    expect(kickoff.getUTCMonth()).toBe(8)
    expect(nflWeekStart(2026, 2).getTime() - kickoff.getTime()).toBe(7 * 86_400_000)
    expect(nflWaiverRunAt(2026, 2).getUTCDay()).toBe(3)
    expect(nflWaiverRunAt(2026, 2).getTime()).toBeLessThan(nflWeekStart(2026, 2).getTime())
  })
})

describe('season sim — full seasons', () => {
  it('a redraft season runs to a champion and exercises every phase', () => {
    const report = runSeasonSim({ seed: 'redraft-smoke', format: 'redraft' })
    expect(report.aborted, JSON.stringify(report.violations.slice(0, 3))).toBeNull()
    expect(report.championRosterId).not.toBeNull()
    expect(report.signals.waiverClaimsWon).toBeGreaterThan(0)
    expect(report.signals.waiverClaimsRejectedAtSubmit).toBeGreaterThan(0) // chaos bots got turned away
    expect(report.signals.tradesExecuted).toBeGreaterThan(0)
    expect(report.signals.inactiveStarterWeeks).toBeGreaterThan(0) // ghosts left injured starters in
  })

  it('a guillotine season chops one team a week down to a survivor', () => {
    const report = runSeasonSim({ seed: 'guillotine-smoke', format: 'guillotine', teamCount: 10 })
    expect(report.aborted, JSON.stringify(report.violations.slice(0, 3))).toBeNull()
    expect(report.signals.guillotineChops).toBe(9)
    expect(report.championRosterId).not.toBeNull()
  })
})

/**
 * Positive controls: each invariant must go RED on the failure it exists to catch. A check that has never
 * been seen to fail is not evidence that the engine is right.
 */
describe('season sim — invariants catch what they claim to', () => {
  const team = (rosterId: string, ids: string[], faab = 50): SimTeam => ({
    rosterId,
    displayName: rosterId,
    ownerId: `u-${rosterId}`,
    persona: 'active',
    partnerRosterId: null,
    draftSlot: 1,
    faabBalance: faab,
    waiverPriority: 1,
    sections: { starters: ids.map((playerId) => ({ playerId, playerName: playerId, position: 'WR' })), bench: [], ir: [] },
    eliminatedWeek: null,
  })

  it('flags a player on two rosters, and a player who vanished', () => {
    const codes = checkPlayerConservation({
      week: 1,
      phase: 'waivers',
      teams: [team('a', ['p1', 'p2']), team('b', ['p2'])],
      freeAgentIds: [],
      universeIds: new Set(['p1', 'p2', 'p3']),
    }).map((violation) => violation.code)
    expect(codes).toContain('PLAYER_ON_TWO_ROSTERS')
    expect(codes).toContain('PLAYER_LOST')
  })

  it('flags negative FAAB and FAAB that appeared from nowhere', () => {
    const codes = checkFaab({ week: 2, phase: 'waivers', teams: [team('a', [], -3), team('b', [], 100)], budget: 100, expectedLeagueTotal: 150 }).map(
      (violation) => violation.code,
    )
    expect(codes).toContain('FAAB_NEGATIVE')
    expect(codes).toContain('FAAB_NOT_CONSERVED')
  })

  it('flags bench points counted and a wrong winner', () => {
    const player = (playerId: string, fantasyPoints: number) => ({ playerId, fantasyPoints }) as never
    const scoring = {
      teams: [
        { rosterId: 'a', starterTotal: 30, starters: [player('s1', 10), player('b1', 20)], bench: [] },
        { rosterId: 'b', starterTotal: 25, starters: [player('s2', 25)], bench: [] },
      ],
      matchups: [
        {
          matchupId: 'm1',
          homeRosterId: 'a',
          awayRosterId: 'b',
          homeScore: 30,
          awayScore: 25,
          home: { starterTotal: 30 },
          away: { starterTotal: 25 },
          complete: true,
          winnerRosterId: 'b',
        },
      ],
    } as never
    const codes = checkScoring({
      week: 3,
      phase: 'scoring',
      scoring,
      starterIdsByRoster: new Map([
        ['a', ['s1']],
        ['b', ['s2']],
      ]),
      playersWithStats: new Set(['s1', 'b1', 's2']),
    }).map((violation) => violation.code)
    expect(codes).toContain('SCORED_STARTERS_MISMATCH')
    expect(codes).toContain('MATCHUP_WINNER_WRONG')
  })
})
