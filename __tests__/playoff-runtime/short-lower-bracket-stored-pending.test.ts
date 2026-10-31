/**
 * A lower bracket shorter than the title bracket, read back the way the resolver reads stored rows.
 *
 * 🛑 THE SEASON NEVER ENDED. 10 teams, 6 in the playoffs: 3 title rounds and a 2-round consolation
 * bracket that starts alongside championship round 2, so its first round is stored `pending`. The
 * round scorer writes that round's games `final` with scores and no winner; on the next read a `final`
 * row counted as complete, the pending round derived as `completed` with no winners, the advance went
 * to the empty consolation final, and the finalizer refused with LOWER_BRACKET_INCOMPLETE for good.
 * Pure-state tests never saw it: the in-memory state keeps `complete: false` until the advance runs.
 */
import { describe, expect, it } from 'vitest'
import {
  advanceNflRedraftPlayoffRound,
  buildNflRedraftPlayoffRuntimeState,
  finalizeNflRedraftPlayoffChampion,
  generateNflRedraftPlayoffBracket,
  type NflRedraftPlayoffMatchupInput,
  type NflRedraftPlayoffMatchupState,
  type NflRedraftPlayoffRoundState,
  type NflRedraftPlayoffRuntimeState,
  type NflRedraftPlayoffTeamInput,
} from '@/lib/playoff-runtime/canonicalNflRedraftPlayoffRuntime'

const teams: NflRedraftPlayoffTeamInput[] = Array.from({ length: 10 }, (_, i) => ({
  rosterId: `t${String(i + 1).padStart(2, '0')}`,
  displayName: `Team ${i + 1}`,
  wins: 13 - i,
  losses: i,
  pointsFor: 2000 - i * 37,
  pointsAgainst: 1500,
}))

const rules = {
  general: { season: 2026, sport: 'NBA', teamCount: 10 },
  playoffs: {
    teamCount: 6,
    startWeek: 23,
    firstRoundByes: null,
    consolationBracketEnabled: true,
    toiletBowlEnabled: false,
    thirdPlaceGameEnabled: true,
    seedingRules: 'standings',
    tiebreakerRules: ['win_pct', 'points_for'],
    standingsTiebreakers: ['win_pct', 'points_for'],
  },
  schedule: { regularSeasonLength: 22, playoffTransitionPoint: 23 },
}

/** The rows the resolver hands back: every matchup with its round's stored status. */
function stored(state: NflRedraftPlayoffRuntimeState): NflRedraftPlayoffMatchupInput[] {
  const rows = (round: NflRedraftPlayoffRoundState, extra: NflRedraftPlayoffMatchupState[] = []) =>
    [...round.matchups, ...extra].map((m) => ({
      matchupId: m.matchupId,
      roundId: round.roundId,
      roundNumber: m.roundNumber,
      roundName: m.roundName,
      matchupNumber: m.matchupNumber,
      bracketType: m.bracketType,
      homeRosterId: m.homeRosterId,
      awayRosterId: m.awayRosterId,
      homeSeed: m.homeSeed,
      awaySeed: m.awaySeed,
      homeScore: m.homeScore,
      awayScore: m.awayScore,
      winnerRosterId: m.winnerRosterId,
      nextMatchupId: m.nextMatchupId,
      status: m.status,
      metadata: { ...m.metadata, bracketType: m.bracketType, roundStatus: round.status },
    }))
  const finalRound = state.bracket.rounds.at(-1)!
  return [
    ...state.bracket.rounds.flatMap((r) => rows(r, r === finalRound && state.bracket.thirdPlaceMatchup ? [state.bracket.thirdPlaceMatchup] : [])),
    ...state.bracket.consolationRounds.flatMap((r) => rows(r)),
  ]
}

function reread(state: NflRedraftPlayoffRuntimeState): NflRedraftPlayoffRuntimeState {
  return buildNflRedraftPlayoffRuntimeState({
    leagueId: 'L', seasonId: 'S', season: 2026, week: 23, rules, teams,
    matchups: stored(state), bracketStatus: 'active', bracketId: 'B',
  })
}

/** What the round scorer writes: scores and `final`, never a winner. */
function scoreRound(state: NflRedraftPlayoffRuntimeState, championshipRound: number): NflRedraftPlayoffRuntimeState {
  const play = (matchups: NflRedraftPlayoffMatchupState[]) =>
    matchups.map((m, i) =>
      m.bye || m.winnerRosterId || !m.homeRosterId || !m.awayRosterId
        ? m
        : { ...m, homeScore: 120 + i, awayScore: 100 - i, status: 'final' as const },
    )
  const final = state.bracket.rounds.at(-1)!.roundNumber === championshipRound
  return {
    ...state,
    bracket: {
      ...state.bracket,
      rounds: state.bracket.rounds.map((r) => (r.roundNumber === championshipRound ? { ...r, matchups: play(r.matchups) } : r)),
      consolationRounds: state.bracket.consolationRounds.map((r) => (r.roundNumber === championshipRound ? { ...r, matchups: play(r.matchups) } : r)),
      thirdPlaceMatchup: final && state.bracket.thirdPlaceMatchup ? play([state.bracket.thirdPlaceMatchup])[0]! : state.bracket.thirdPlaceMatchup,
    },
  }
}

describe('a short lower bracket stored pending', () => {
  it('advances, fills its final and lets the season finalize after every re-read', () => {
    const base = buildNflRedraftPlayoffRuntimeState({ leagueId: 'L', seasonId: 'S', season: 2026, week: 23, rules, teams })
    let state: NflRedraftPlayoffRuntimeState = { ...base, bracket: generateNflRedraftPlayoffBracket({ state: base }).bracket }
    expect(state.bracket.consolationRounds.map((r) => [r.roundNumber, r.status])).toEqual([[2, 'pending'], [3, 'pending']])

    for (const round of [1, 2, 3]) {
      state = reread(scoreRound(reread(state), round))
      // The lower round just scored is still in play, not silently completed.
      const lowerScored = state.bracket.consolationRounds.find((r) => r.roundNumber === round)
      if (lowerScored) expect(lowerScored.status).not.toBe('completed')
      const advanced = advanceNflRedraftPlayoffRound({ state })
      if (!advanced.ok) throw new Error(`round ${round}: ${advanced.code} ${advanced.message}`)
      state = reread(advanced.state)
    }

    const consolationFinal = state.bracket.consolationRounds.at(-1)!.matchups[0]!
    expect(consolationFinal.homeRosterId && consolationFinal.awayRosterId).toBeTruthy()
    expect(consolationFinal.winnerRosterId).toBeTruthy()
    const finalized = finalizeNflRedraftPlayoffChampion({ state })
    if (!finalized.ok) throw new Error(finalized.code)
    expect(finalized.finalStandings.map((r) => r.finish)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    expect(finalized.finalStandings.filter((r) => r.champion)).toHaveLength(1)
  })
})
