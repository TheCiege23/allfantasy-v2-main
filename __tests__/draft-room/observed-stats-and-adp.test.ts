import { describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ stats: vi.fn(), identities: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { playerSeasonStats: { findMany: mocks.stats }, playerIdentityMap: { findMany: mocks.identities } } }))
import { loadPlayerSeasonStatsFallback } from '@/lib/draft/analytics/nfl-rolling-insights-draft-analytics'
import { canonicalName } from '@/lib/draft-room/player-canonical-identity'
import { nflDraftSeasonLine } from '@/lib/draft-room/nflDraftSeasonLine'
import { observedAdpSeason } from '@/lib/draft-room/observedAdpSeason'
import { extractNbaDraftSeasonRates } from '@/lib/draft-room/sportsPlayerRecordDraftEnrichment'
import { getDraftStatColumnsForSport, getStatValueForDraftPlayer } from '@/lib/draft-room/draftSportStatColumns'
import { applyPoolSort } from '@/components/app/draft-room/SleeperPoolSort'

const row = { season: '2026', gamesPlayed: 3, fantasyPointsPerGame: 6.37, fantasyPointsSeason: 19.1, updatedAt: new Date(),
  stats: { games_played: 3, receptions: 9, receiving_yards: 101, receiving_touchdowns: 0 } }
describe('observed draft statistics', () => {
  it('shows the identity-checked NFL fallback box and computes this league\'s half-PPR points', () => {
    const actual = nflDraftSeasonLine(row, undefined, 'WR', 2026, stats => stats.rec_yds * .1 + stats.rec * .5)
    expect(actual?.season).toBe('2026')
    expect(actual?.splits.receiving).toEqual({ rec: 9, tar: null, yds: 101, td: 0 })
    expect(actual?.splits.projectedPoints).toBeCloseTo(14.6)
    expect(actual?.fantasyPointsPerGame).toBeCloseTo(14.6 / 3)
    expect(actual?.splits.rushing.att).toBeNull()
  })
  it('reads the documented RI passing-interceptions key and does not fabricate absent seasons', () => {
    const qb = nflDraftSeasonLine({ ...row, gamesPlayed: 1, stats: { passing_yards: 250, passing_touchdowns: 2, passing_interceptions: 1 } },
      undefined, 'QB', 2026, stats => stats.pass_yds * .04 + stats.pass_td * 4 - stats.pass_int * 2)
    expect(qb?.splits.projectedPoints).toBe(16)
    expect(qb?.splits.passing.int).toBe(1)
    expect(nflDraftSeasonLine({ ...row, season: '2023' }, undefined, 'WR', 2026, () => 999)).toBeNull()
    expect(nflDraftSeasonLine({ ...row, gamesPlayed: 0 }, undefined, 'WR', 2026, () => 999)).toBeNull()
  })
  it('wires NBA rate columns to known games, including real zeroes and shooting percentages', () => {
    const stats = extractNbaDraftSeasonRates({ games_played: 2, points: 20, assists: 6, steals: 0, blocks: 2,
      three_points_made: 4, field_goals_made: 8, field_goals_attempted: 20, free_throws_made: 0, free_throws_attempted: 0 })
    expect(stats).toMatchObject({ assistsPerGame: 3, stealsPerGame: 0, blocksPerGame: 1, threePointersMadePerGame: 2, fieldGoalPercentage: .4, freeThrowPercentage: null })
    const cols = getDraftStatColumnsForSport('NBA')
    expect(getStatValueForDraftPlayer({ display: { stats: stats! } }, cols.find(c => c.key === 'ast')!)).toBe(3)
    expect(getStatValueForDraftPlayer({ display: { stats: stats! } }, cols.find(c => c.key === 'stl')!)).toBe(0)
  })
})
describe('market ADP is the default across the four sports', () => {
  it.each(['NFL', 'NBA', 'NHL', 'MLB'])('%s orders by observed ADP ahead of first name', sport => {
    const sorted = applyPoolSort([{ name: 'Aaron', adp: 20 }, { name: 'Zach', adp: 1 }, { name: 'Aardvark', adp: null }],
      { key: 'adp', direction: 'asc' }, sport)
    expect(sorted.map(p => p.name)).toEqual(['Zach', 'Aaron', 'Aardvark'])
  })
  it('uses current observations for a forward draft without retagging historical boards', () => {
    const now = new Date('2026-10-29')
    expect(observedAdpSeason(2027, now)).toBe(2026)
    expect(observedAdpSeason(2025, now)).toBe(2025)
    expect(observedAdpSeason(undefined, now)).toBeUndefined()
  })
})

it('keeps the selected NFL box with its played season when the new season has zero games', async () => {
  mocks.identities.mockResolvedValue([])
  const previous = { ...row, playerId: '4876', playerName: 'A.J. Brown', position: 'WR', season: '2025', gamesPlayed: 10 }
  mocks.stats.mockResolvedValue([{ ...previous, season: '2026', gamesPlayed: 0, fantasyPointsPerGame: null, stats: {} }, previous])
  const result = await loadPlayerSeasonStatsFallback({ rows: [{
    poolKey: 'brown|wr', nk: canonicalName('A.J. Brown'), pk: 'wr', sleeperCandidate: '5859', existingRiId: null,
  }] })
  expect(result.seasonByPoolKey.get('brown|wr')).toMatchObject({ season: '2025', gamesPlayed: 10, stats: row.stats })
})
