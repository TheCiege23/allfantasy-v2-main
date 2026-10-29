/**
 * The stored standings seed (`updateStandings` → `RedraftRoster.playoffSeed`, mirrored to the league
 * page's `LeagueTeam.currentRank`) and the bracket's seeding (`buildNflRedraftPlayoffRuntimeState`)
 * must order teams the same way: win percentage (a tie half a win), then the league's tiebreakers
 * (`win_pct`, `points_for`, `head_to_head`, `points_against` by default).
 *
 * Both bugs were found by the full-season simulations (full-season-mlb-redraft.test.ts):
 *  - the standings engine broke an equal win percentage on WINS, which over equal games only counts
 *    ties against a team — 14-29-3 ranked ahead of 11-26-9 on 61 fewer points;
 *  - the bracket compared win percentage ROUNDED to three places, so in an odd-team median league,
 *    where teams play different numbers of games, a 22-23 team (.48889) and a 22-23-1 team (.48913)
 *    were "equal" and the one with the lower record but more points took the higher seed.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', async () => {
  const { inMemoryPrisma } = await import('../helpers/inMemoryPrisma')
  return { prisma: inMemoryPrisma.client, default: inMemoryPrisma.client }
})
vi.mock('@/lib/events', () => ({
  getPlatformEvents: () => ({ emit: async () => undefined }),
  EVENT: new Proxy({}, { get: (_t, key) => String(key) }),
}))

import { inMemoryPrisma } from '../helpers/inMemoryPrisma'
import { updateStandings } from '@/lib/redraft/standingsEngine'
import { buildNflRedraftPlayoffRuntimeState, type NflRedraftPlayoffRulesInput } from '@/lib/playoff-runtime/canonicalNflRedraftPlayoffRuntime'

const RULES: NflRedraftPlayoffRulesInput = {
  playoffs: {
    teamCount: 4,
    startWeek: 3,
    standingsTiebreakers: ['win_pct', 'points_for', 'head_to_head', 'points_against'],
  },
  schedule: { regularSeasonLength: 2 },
}

function bracketOrder(teams: Array<{ rosterId: string; wins: number; losses: number; ties: number; pointsFor: number }>): string[] {
  const state = buildNflRedraftPlayoffRuntimeState({ leagueId: 'L', seasonId: 'S', season: 2026, week: 3, rules: RULES, teams })
  return state.seeds.map((s) => s.rosterId)
}

describe('an equal win percentage is broken on points for, in the standings and the bracket alike', () => {
  beforeEach(() => inMemoryPrisma.reset())

  it('1-1 and 0-0-2 are level on record: the team with more points takes the better seed', async () => {
    const p = inMemoryPrisma.client
    await p.league.create({ data: { id: 'L', sport: 'NFL', platform: 'sleeper', medianGame: false, settings: {} } })
    await p.redraftSeason.create({ data: { id: 'S', leagueId: 'L', sport: 'NFL', season: 2026, totalWeeks: 4, playoffStartWeek: 3, medianGame: false } })
    for (const id of ['a', 'b', 'c', 'd']) await p.redraftRoster.create({ data: { id, seasonId: 'S', leagueId: 'L', ownerId: `u-${id}`, ownerName: id } })
    const game = (week: number, home: string, away: string, homeScore: number, awayScore: number) =>
      p.redraftMatchup.create({ data: { seasonId: 'S', leagueId: 'L', week, homeRosterId: home, awayRosterId: away, homeScore, awayScore, status: 'final' } })
    await game(1, 'a', 'c', 100, 90) // a W
    await game(1, 'b', 'd', 120, 120) // b T
    await game(2, 'a', 'd', 95, 110) // a L
    await game(2, 'b', 'c', 118, 118) // b T
    await updateStandings('S', 2)

    const rows = inMemoryPrisma.table('redraftRoster')
    const seedOf = (id: string) => rows.find((r) => r.id === id)!.playoffSeed
    // d 1-0-1 (.750); a 1-1 and b 0-0-2 both .500, b with 238 points to a's 195; c 0-1-1.
    expect(rows.find((r) => r.id === 'a')).toMatchObject({ wins: 1, losses: 1, ties: 0 })
    expect(rows.find((r) => r.id === 'b')).toMatchObject({ wins: 0, losses: 0, ties: 2 })
    expect([seedOf('d'), seedOf('b'), seedOf('a'), seedOf('c')]).toEqual([1, 2, 3, 4])
    expect(bracketOrder(rows.map((r) => ({ rosterId: r.id, wins: r.wins, losses: r.losses, ties: r.ties, pointsFor: r.pointsFor })))).toEqual(['d', 'b', 'a', 'c'])
  })

  it('the bracket compares the exact win percentage: .48913 is ahead of .48889 whatever the points', () => {
    // Odd-team league median: one team played a game fewer (an extra bye). 22-23-1 over 46 is the
    // better record than 22-23 over 45, though both print as .489.
    const order = bracketOrder([
      { rosterId: 'top', wins: 30, losses: 13, ties: 0, pointsFor: 4000 },
      { rosterId: 'fewer-games', wins: 22, losses: 23, ties: 0, pointsFor: 5000 },
      { rosterId: 'better-record', wins: 22, losses: 23, ties: 1, pointsFor: 4100 },
      { rosterId: 'bottom', wins: 10, losses: 34, ties: 0, pointsFor: 3000 },
    ])
    expect(order).toEqual(['top', 'better-record', 'fewer-games', 'bottom'])
  })

  /*
   * Known gaps, each a design call for the owner rather than a one-line fix:
   *
   * - The stored seed ranks win %, points for, points against — the league DEFAULT chain minus
   *   head-to-head. A commissioner's own `settings.tiebreaker_order` (e.g. head-to-head first), or any
   *   non-default `standings_tiebreakers`, reaches the bracket (`customTiebreakers`) but not
   *   `updateStandings`, so `LeagueTeam.currentRank` on the league page can disagree with the seeds.
   *   Fixing it means resolving the league's rules inside the standings recompute.
   * - In a league-median week the team on a bye plays the median game on its score, but that score is
   *   counted in nobody's points for (head-to-head games only, plus the extra matchup). Its points-for
   *   tiebreak is a week short for every bye it had. Whether a bye week's score is "points for" is a
   *   rule, not a bug, until the owner says which.
   */
  it.todo("BUG (design): updateStandings ignores the commissioner's tiebreaker order and head-to-head — the stored seed and LeagueTeam.currentRank can disagree with the bracket")
  it.todo('BUG (design): a bye team\'s score in a league-median week never counts toward its points for')
})
