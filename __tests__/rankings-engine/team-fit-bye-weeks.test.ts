/**
 * 🛑 THE TEAM-FIT BYE SCORE READ A HARD-CODED 2025 SLATE IN 2026.
 *
 * `computeByeClusterRelief` looked byes up in `NFL_BYE_WEEKS_2025`, so every "two of your WRs share
 * this bye" judgement in the enhanced rankings was last season's. The byes are now passed in from
 * the schedule we hold (`resolveByeWeekMap`), and a club the map does not carry scores neutral.
 */
import { describe, expect, it } from 'vitest'

import { computeTeamFitScore } from '@/lib/rankings-engine/team-fit-score'
import type { AdaptivePlayerRank, AdaptiveRankingsOutput } from '@/lib/rankings-engine/adaptive-rankings'
import { computeEnhancedRankings } from '@/lib/rankings-engine/enhanced-rankings'

const p = (name: string, team: string | null, position = 'WR'): AdaptivePlayerRank =>
  ({
    playerId: name,
    name,
    position,
    team,
    age: 26,
    scarcityFactors: { volatilityFit: 50, ageCurveFit: 50, positionalScarcity: 50, rosterNeedFit: 50 },
  }) as unknown as AdaptivePlayerRank

const relief = (player: AdaptivePlayerRank, roster: AdaptivePlayerRank[], byes?: Record<string, number>) =>
  computeTeamFitScore(player, [], roster, 'balanced', byes).byeClusterRelief

/*
 * Under the old 2025 table these clubs' byes were KC 6, BUF 12, DET 5 — all different, so the
 * old code scored this as maximum relief (75) whatever season it was.
 */
const THIS_SEASON = { KC: 10, BUF: 10, DET: 10, MIN: 7 }

describe('🛑 bye-cluster relief uses the season it is given, not 2025', () => {
  it('two same-position starters already on the candidate’s bye → clustered (25)', () => {
    const roster = [p('Rostered A', 'BUF'), p('Rostered B', 'DET')]
    expect(relief(p('Candidate', 'KC'), roster, THIS_SEASON)).toBe(25)
  })

  it('one → 50, none → 75', () => {
    expect(relief(p('Candidate', 'KC'), [p('A', 'BUF'), p('B', 'MIN')], THIS_SEASON)).toBe(50)
    expect(relief(p('Candidate', 'MIN'), [p('A', 'BUF'), p('B', 'DET')], THIS_SEASON)).toBe(75)
  })

  it('no bye map is no bye opinion (neutral 50), never last season’s slate', () => {
    expect(relief(p('Candidate', 'KC'), [p('A', 'BUF'), p('B', 'DET')])).toBe(50)
    expect(relief(p('Candidate', 'KC'), [p('A', 'BUF'), p('B', 'DET')], {})).toBe(50)
  })

  it('reads a club spelled as an alias (JAC → JAX)', () => {
    const byes = { JAX: 8, KC: 8, BUF: 8 }
    expect(relief(p('Candidate', 'JAC'), [p('A', 'KC'), p('B', 'BUF')], byes)).toBe(25)
  })

  it('computeEnhancedRankings hands its bye map through to every team-fit score', () => {
    const rostered = (name: string, team: string) => ({ ...p(name, team), isOnUserRoster: true })
    const players = [rostered('A', 'BUF'), rostered('B', 'DET'), { ...p('Candidate', 'KC'), isOnUserRoster: false }]
    const out = computeEnhancedRankings(
      { players } as unknown as AdaptiveRankingsOutput,
      'balanced',
      'overall',
      12,
      null,
      THIS_SEASON,
    )
    expect(out.players.find((x) => x.name === 'Candidate')?.tfsBreakdown.byeClusterRelief).toBe(25)
  })
})
