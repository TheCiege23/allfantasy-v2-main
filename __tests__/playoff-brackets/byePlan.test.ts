import { describe, expect, it } from 'vitest'

import type { CanonicalLeagueRules } from '@/lib/league-runtime'
import {
  checkByePlan,
  describeByePlan,
  naturalByePlan,
  parseStoredByePlan,
  validByePlans,
} from '@/lib/playoff-brackets/byePlan'
import {
  advanceNflRedraftPlayoffRound,
  buildNflRedraftPlayoffRuntimeState,
  finalizeNflRedraftPlayoffChampion,
  generateNflRedraftPlayoffBracket,
  type NflRedraftPlayoffRuntimeState,
  type NflRedraftPlayoffTeamInput,
} from '@/lib/playoff-runtime/canonicalNflRedraftPlayoffRuntime'

describe('bye plans', () => {
  it('natural byes for odd and in-between counts', () => {
    expect(naturalByePlan(5)).toEqual([1, 1, 1, 0, 0])
    expect(naturalByePlan(6)).toEqual([1, 1, 0, 0, 0, 0])
    expect(naturalByePlan(7)).toEqual([1, 0, 0, 0, 0, 0, 0])
    expect(naturalByePlan(8)).toEqual([0, 0, 0, 0, 0, 0, 0, 0])
    expect(naturalByePlan(9)).toEqual([1, 1, 1, 1, 1, 1, 1, 0, 0])
    for (let n = 2; n <= 16; n++) expect(checkByePlan(n, naturalByePlan(n)).ok, String(n)).toBe(true)
  })

  it('9 teams: #8 v #9 play-in, then an 8-team bracket — 4 rounds', () => {
    const check = checkByePlan(9, naturalByePlan(9))
    expect(check.ok && check.rounds.map((r) => [r.entering, r.games])).toEqual([[[8, 9], 1], [[1, 2, 3, 4, 5, 6, 7], 4], [[], 2], [[], 1]])
  })

  it('8 teams with the top two seeds on a double bye', () => {
    const check = checkByePlan(8, [2, 2, 1, 1, 0, 0, 0, 0])
    expect(check.ok && check.rounds.map((r) => r.teams)).toEqual([4, 4, 4, 2])
  })

  it('rejects plans that leave a round with an odd number of teams, or reward a worse seed', () => {
    expect(checkByePlan(7, [2, 0, 0, 0, 0, 0, 0])).toMatchObject({ ok: false, error: expect.stringMatching(/Round 2 would have 3 teams/) })
    expect(checkByePlan(6, [0, 1, 0, 0, 0, 0])).toMatchObject({ ok: false, error: expect.stringMatching(/cannot wait longer/) })
    expect(checkByePlan(17, naturalByePlan(17)).ok).toBe(false)
  })

  it('lists valid plans, natural first', () => {
    const plans = validByePlans(5)
    expect(plans[0]).toEqual([1, 1, 1, 0, 0])
    expect(plans).toContainEqual([3, 2, 1, 0, 0]) // stepladder
    expect(plans.every((p) => checkByePlan(5, p).ok)).toBe(true)
  })

  it('describes and parses stored plans', () => {
    expect(describeByePlan([2, 2, 1, 1, 0, 0, 0, 0])).toBe('#1 waits 2 rounds · #2 waits 2 rounds · #3 waits 1 round · #4 waits 1 round')
    expect(parseStoredByePlan(['1', '1', '1', '0', '0'], 5)).toEqual([1, 1, 1, 0, 0])
    expect(parseStoredByePlan([1, 1, 1, 0, 0], 6)).toBeNull()
    expect(parseStoredByePlan('nope', 5)).toBeNull()
  })
})

// ── Through the real playoff runtime ──

function rulesFor(teamCount: number, byePlan: number[] | null): CanonicalLeagueRules {
  return {
    general: { sport: 'NFL', season: 2026, format: 'redraft', teamCount: 10 },
    playoffs: { teamCount, startWeek: 15, byePlan, standingsTiebreakers: ['win_pct', 'points_for'] },
    schedule: { regularSeasonLength: 14, playoffTransitionPoint: 15 },
  } as unknown as CanonicalLeagueRules
}

// Ten teams; seed order is t1 (best) … t10.
const teams: NflRedraftPlayoffTeamInput[] = Array.from({ length: 10 }, (_, i) => ({
  rosterId: `t${i + 1}`,
  displayName: `Team ${i + 1}`,
  ownerId: `u${i + 1}`,
  wins: 12 - i,
  losses: 2 + i,
  pointsFor: 1600 - i * 20,
  pointsAgainst: 1400,
}))

function stateFor(teamCount: number, byePlan: number[] | null): NflRedraftPlayoffRuntimeState {
  const state = buildNflRedraftPlayoffRuntimeState({ leagueId: 'L', seasonId: 'S', season: 2026, week: 15, rules: rulesFor(teamCount, byePlan), teams })
  return { ...state, bracket: generateNflRedraftPlayoffBracket({ state }).bracket }
}

/** Score the active round so the better seed always wins, then advance. */
function playRound(state: NflRedraftPlayoffRuntimeState): NflRedraftPlayoffRuntimeState {
  const scored: NflRedraftPlayoffRuntimeState = {
    ...state,
    bracket: {
      ...state.bracket,
      rounds: state.bracket.rounds.map((round) =>
        round.status !== 'active'
          ? round
          : {
              ...round,
              matchups: round.matchups.map((m) =>
                m.bye ? m : { ...m, homeScore: (m.homeSeed ?? 0) < (m.awaySeed ?? 0) ? 120 : 90, awayScore: (m.homeSeed ?? 0) < (m.awaySeed ?? 0) ? 90 : 120 },
              ),
            },
      ),
    },
  }
  const advanced = advanceNflRedraftPlayoffRound({ state: scored })
  if (!advanced.ok) throw new Error(advanced.message)
  return advanced.state
}

const pairsOf = (state: NflRedraftPlayoffRuntimeState, round: number) =>
  state.bracket.rounds.find((r) => r.roundNumber === round)!.matchups.map((m) => [m.homeSeed, m.awaySeed])

describe('playoff runtime with a bye plan', () => {
  it('8 teams, top two on a double bye: seeds enter in their round and the best seed meets the worst', () => {
    let state = stateFor(8, [2, 2, 1, 1, 0, 0, 0, 0])
    expect(state.settings).toMatchObject({ roundCount: 4, reseedAfterEachRound: true, firstRoundByes: 4 })
    expect(pairsOf(state, 1)).toEqual([[5, 8], [6, 7]])

    state = playRound(state)
    expect(pairsOf(state, 2)).toEqual([[3, 6], [4, 5]])
    state = playRound(state)
    expect(pairsOf(state, 3)).toEqual([[1, 4], [2, 3]])
    state = playRound(state)
    expect(pairsOf(state, 4)).toEqual([[1, 2]])
    state = playRound(state)

    const done = finalizeNflRedraftPlayoffChampion({ state })
    expect(done.ok && done.state.bracket.championRosterId).toBe('t1')
  })

  it('5-team stepladder: #4 v #5, then the winner climbs past #3, #2 and #1', () => {
    let state = stateFor(5, [3, 2, 1, 0, 0])
    expect(state.settings.roundCount).toBe(4)
    expect(pairsOf(state, 1)).toEqual([[4, 5]])
    state = playRound(state)
    expect(pairsOf(state, 2)).toEqual([[3, 4]])
    state = playRound(state)
    expect(pairsOf(state, 3)).toEqual([[2, 3]])
    state = playRound(state)
    expect(pairsOf(state, 4)).toEqual([[1, 2]])
  })

  it('a natural or invalid stored plan keeps the existing fixed bracket', () => {
    const natural = stateFor(5, [1, 1, 1, 0, 0])
    expect(natural.settings.byePlan).toBeNull()
    expect(natural.bracket.rounds[0].matchups.filter((m) => m.bye)).toHaveLength(3)

    const invalid = stateFor(7, [2, 0, 0, 0, 0, 0, 0])
    expect(invalid.settings.byePlan).toBeNull()
    expect(invalid.settings.roundCount).toBe(3)
  })
})
