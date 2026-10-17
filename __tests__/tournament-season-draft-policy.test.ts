import { describe, expect, it } from 'vitest'
import { defaultSeasonBlueprint } from '@/lib/tournament/seasonBlueprint'
import { defaultSeasonRules } from '@/lib/tournament/seasonRules'
import { seasonRosterPickError, seasonPlayerPositions, selectSeasonAutodraft, assessSeasonDraftPool, seasonAuctionBidDeadline, seasonAuctionMaxBid, matchSeasonDraftSlots, type SeasonDraftPlayer } from '@/lib/tournament/seasonDraftPolicy'
const config = (sport: 'NFL' | 'NBA') => ({ ...defaultSeasonBlueprint(sport), rules: defaultSeasonRules(sport, sport === 'NFL' ? 'ppr' : 'nba_points') })
const player = (id: number, position: string, adp = id): SeasonDraftPlayer => ({ playerId: 'p' + id, playerName: 'Player ' + id, position, adp, team: 'TEST' })
describe('frozen draft legality', () => {
  it('preserves a feasible full starter roster and excludes IR from draft capacity', () => {
    const c = config('NFL'), qbs = Array.from({ length: 7 }, (_, i) => player(i, 'QB'))
    expect(seasonRosterPickError(c, qbs, player(8, 'QB'))).toContain('legal completed')
    expect(seasonRosterPickError(c, qbs, player(9, 'RB'))).toBeNull()
    expect(seasonRosterPickError(c, Array.from({ length: 15 }, (_, i) => player(i, 'RB')), player(20, 'WR'))).toContain('IR slots')
  })
  it('matches overlapping NBA positions rather than consuming slots greedily', () => {
    const c = config('NBA'); c.rules.starters = [{ position: 'PG', count: 1 }, { position: 'SG', count: 1 }]; c.rules.bench = 0; c.rosterSize = 2
    expect(matchSeasonDraftSlots(c, [player(1, 'PG/SG'), player(2, 'PG')])).toBe(2)
    expect(seasonRosterPickError(c, [player(1, 'PG/SG')], player(2, 'PG'))).toBeNull()
    expect(seasonRosterPickError(c, [player(1, 'PG')], player(2, 'PG'))).not.toBeNull()
  })
  it('accepts NFL defense aliases and rejects cross-sport or unknown positions', () => {
    expect(seasonPlayerPositions('NFL', 'D/ST')).toEqual(['DST'])
    expect(seasonPlayerPositions('NBA', 'PG/SG')).toEqual(['PG', 'SG'])
    expect(seasonRosterPickError(config('NBA'), [], player(1, 'QB'))).not.toBeNull()
    expect(seasonRosterPickError(config('NFL'), [], player(1, 'UNKNOWN'))).not.toBeNull()
  })
  it('autodrafts the highest ranked legal untaken player with a stable tie break', () => {
    const c = config('NFL'), own = Array.from({ length: 7 }, (_, i) => player(i, 'QB'))
    const pool = [player(8, 'QB', 1), player(9, 'WR', 2), player(10, 'RB', 3)]
    expect(selectSeasonAutodraft(c, own, pool, new Set(['p9']))?.playerId).toBe('p10')
    expect(selectSeasonAutodraft(c, own, [player(12, 'WR', 3), player(11, 'RB', 3)], new Set())?.playerId).toBe('p11')
    expect(selectSeasonAutodraft(c, own, [player(8, 'QB')], new Set())).toBeNull()
  })
  it('uses measured NBA rank ahead of stale-looking ADP when both are present', () => {
    const c = config('NBA')
    const pool = [{ ...player(1, 'PG', 1), rank: 50 }, { ...player(2, 'PG', 20), rank: 1 }]
    expect(selectSeasonAutodraft(c, [], pool, new Set())?.playerId).toBe('p2')
  })
  it('blocks positional scarcity and duplicate identities even when raw pool count is large', () => {
    const c = config('NBA'), pool = Array.from({ length: 200 }, (_, i) => player(i, 'PG'))
    expect(assessSeasonDraftPool(c, pool, 8).ready).toBe(false)
    expect(assessSeasonDraftPool(c, [player(1, 'PG'), player(1, 'SG')], 1).blockers.join(' ')).toContain('duplicate')
  })
  it.each(['NFL', 'NBA'] as const)('simulates a complete eight-team %s snake draft with legal rosters and unique players', sport => {
    const c = config(sport), positions = sport === 'NFL' ? ['QB', 'RB', 'WR', 'TE', 'K', 'DST'] : ['PG', 'SG', 'SF', 'PF', 'C']
    const pool = Array.from({ length: 300 }, (_, i) => player(i + 1, positions[i % positions.length]!))
    expect(assessSeasonDraftPool(c, pool, 8).ready).toBe(true)
    const teams: SeasonDraftPlayer[][] = Array.from({ length: 8 }, () => []), taken = new Set<string>()
    for (let round = 0; round < c.rosterSize; round++) for (let slot = 0; slot < 8; slot++) {
      const team = teams[round % 2 ? 7 - slot : slot]!, selected = selectSeasonAutodraft(c, team, pool, taken)
      expect(selected).not.toBeNull(); team.push(selected!); taken.add(selected!.playerId)
    }
    expect(taken.size).toBe(8 * c.rosterSize)
    for (const team of teams) expect(matchSeasonDraftSlots(c, team)).toBe(c.rosterSize)
  })
})
describe('published auction terms', () => {
  it('reserves the minimum for every remaining draft slot', () => {
    expect(seasonAuctionMaxBid(200, 12, 1)).toBe(189)
    expect(seasonAuctionMaxBid(12, 12, 1)).toBe(1)
    expect(seasonAuctionMaxBid(5, 0, 1)).toBe(0)
  })
  it('extends only late bids, never shortens an early clock, and refuses expired bidding', () => {
    expect(seasonAuctionBidDeadline(30000, 1000, 10)).toBe(30000)
    expect(seasonAuctionBidDeadline(30000, 25000, 10)).toBe(35000)
    expect(() => seasonAuctionBidDeadline(30000, 30000, 10)).toThrow('expired')
  })
})

it('blocks an unranked catalog instead of certifying alphabetical autodraft as best available', () => {
  const pool = Array.from({ length: 300 }, (_, i) => ({ ...player(i, ['PG', 'SG', 'SF', 'PF', 'C'][i % 5]!), adp: null }))
  expect(assessSeasonDraftPool(config('NBA'), pool, 8).blockers.join(' ')).toContain('Ranked player coverage')
})
