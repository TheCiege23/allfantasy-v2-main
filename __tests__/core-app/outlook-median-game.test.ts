// @vitest-environment node
/**
 * Sleeper's weekly median game (`settings.league_average_match = 1`): every regular-season week is
 * TWO games — the head-to-head one, and one against the league median (a win for finishing in the top
 * half of the week's scores). The outlook simulated only the head-to-head game, so in a median league
 * every projected record had half its remaining games missing and clinch/elimination arithmetic was
 * run against the wrong number of games.
 */
import { describe, expect, it } from 'vitest'
import { mathStatus, readMilestones, simulateSeason, type SimInput } from '@/lib/core-app/outlookSim'
import { leagueSimHash } from '@/lib/core-app/seasonOutlookSims'
import { leagueHasMedianGame, medianGameRecords, statedMedianGame } from '@/lib/core-app/medianGame'

const strong = { mu: 200, sigma: 1, n: 6 }
const weak = { mu: 100, sigma: 1, n: 6 }

describe('simulation — the median game', () => {
  const sim: SimInput = {
    teams: [
      { rosterId: 'A', wins: 0, losses: 0, pointsFor: 0, profile: strong },
      { rosterId: 'B', wins: 0, losses: 0, pointsFor: 0, profile: weak },
      { rosterId: 'C', wins: 0, losses: 0, pointsFor: 0, profile: weak },
      { rosterId: 'D', wins: 0, losses: 0, pointsFor: 0, profile: weak },
    ],
    remaining: [
      { week: 1, a: 'A', b: 'B' },
      { week: 1, a: 'C', b: 'D' },
    ],
    playoffTeams: 2,
    byeTeams: 0,
  }

  it('a team that tops every week finishes with two wins per week, not one', () => {
    const out = simulateSeason({ ...sim, medianGame: true }, { iterations: 200, seed: 7 })
    expect(out.finishes.A.winsHist[2]).toBe(200)
  })

  it('without the median game the same week is one win', () => {
    const out = simulateSeason(sim, { iterations: 200, seed: 7 })
    expect(out.finishes.A.winsHist[1]).toBe(200)
  })

  it('awards exactly half the field a median win each week', () => {
    let total = 0
    simulateSeason(
      { ...sim, medianGame: true },
      {
        iterations: 50,
        seed: 11,
        onRun: (run) => {
          total += ['A', 'B', 'C', 'D'].reduce((a, id) => a + run.finalWins(id), 0)
        },
      },
    )
    // 2 head-to-head wins + 2 median wins per run.
    expect(total).toBe(50 * 4)
  })

  it('milestones count the median game in the games left', () => {
    const median = { ...sim, medianGame: true }
    const out = simulateSeason(median, { iterations: 200, seed: 7 })
    const m = readMilestones(out, median, 'A')!
    expect(m.maxWins).toBe(2)
    expect(m.totalGames).toBe(2)
  })

  it('does not call a team eliminated that its median games can still carry in', () => {
    const input: SimInput = {
      teams: [
        { rosterId: 'me', wins: 0, losses: 2, pointsFor: 0, profile: weak },
        { rosterId: 'O', wins: 2, losses: 0, pointsFor: 0, profile: weak },
        { rosterId: 'Z', wins: 0, losses: 2, pointsFor: 0, profile: weak },
        { rosterId: 'W', wins: 0, losses: 2, pointsFor: 0, profile: weak },
      ],
      remaining: [
        { week: 3, a: 'me', b: 'Z' },
        { week: 3, a: 'O', b: 'W' },
      ],
      playoffTeams: 1,
      byeTeams: 0,
    }
    // One game left: 'me' can reach 1 win, O already has 2 — out.
    expect(mathStatus(input, 'me')).toBe('eliminated')
    // Two games left (head-to-head + median): 'me' can reach 2 — not out by arithmetic.
    expect(mathStatus({ ...input, medianGame: true }, 'me')).toBeNull()
  })

  it('a stored run is not reused across a median-game change', () => {
    expect(leagueSimHash(sim, 1)).not.toBe(leagueSimHash({ ...sim, medianGame: true }, 1))
  })
})

describe('median game — detection and records', () => {
  it('reads the stated league setting in its known spellings', () => {
    expect(statedMedianGame({ league_average_match: 1 })).toBe(true)
    expect(statedMedianGame({ league_average_match: 0 })).toBe(false)
    expect(statedMedianGame({ sleeper: { league_average_match: 1 } })).toBe(true)
    expect(statedMedianGame({ medianGame: true })).toBe(true)
    expect(statedMedianGame({ playoff_teams: 6 })).toBeNull()
    expect(statedMedianGame(null)).toBeNull()
  })

  it('infers it from platform records that played two games a week, when the setting is silent', () => {
    expect(leagueHasMedianGame({}, { maxGames: 6, weeksDone: 3 })).toBe(true)
    expect(leagueHasMedianGame({}, { maxGames: 3, weeksDone: 3 })).toBe(false)
    // A stale full-season record against an early week proves nothing.
    expect(leagueHasMedianGame({}, { maxGames: 14, weeksDone: 1 })).toBe(false)
    expect(leagueHasMedianGame({}, { maxGames: 6, weeksDone: 0 })).toBe(false)
    // A stated setting wins over the records either way.
    expect(leagueHasMedianGame({ league_average_match: 0 }, { maxGames: 6, weeksDone: 3 })).toBe(false)
    expect(leagueHasMedianGame({ league_average_match: 1 }, null)).toBe(true)
  })

  it('scores a week the way the standings board does: top half wins, level scores on the line tie', () => {
    const rec = medianGameRecords([
      { week: 1, rosterId: 'a', pointsFor: 120 },
      { week: 1, rosterId: 'b', pointsFor: 110 },
      { week: 1, rosterId: 'c', pointsFor: 110 },
      { week: 1, rosterId: 'd', pointsFor: 90 },
      { week: 2, rosterId: 'a', pointsFor: 80 },
      { week: 2, rosterId: 'b', pointsFor: 100 },
      { week: 2, rosterId: 'c', pointsFor: 95 },
      { week: 2, rosterId: 'd', pointsFor: 70 },
    ])
    expect(rec.get('a')).toEqual({ wins: 1, losses: 1, ties: 0 })
    expect(rec.get('b')).toEqual({ wins: 1, losses: 0, ties: 1 })
    expect(rec.get('c')).toEqual({ wins: 1, losses: 0, ties: 1 })
    expect(rec.get('d')).toEqual({ wins: 0, losses: 2, ties: 0 })
  })
})
