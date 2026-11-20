/**
 * The mock pool carries the live room's season stat columns (2026-11-19): the same Postgres
 * readers the live pool uses, joined by identity, scored with the mock's own PPR setting. A row
 * with no match keeps its dashes, and a failed read leaves the pool as it was.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const riSeason = vi.fn()
const riDetail = vi.fn()
const stored = vi.fn()

vi.mock('@/lib/draft/analytics/nfl-rolling-insights-draft-analytics', () => ({
  defaultNflPlayerStatsSeason: () => '2025',
  loadRollingInsightsSeasonByDraftPoolKey: (...a: unknown[]) => riSeason(...a),
  loadRollingInsightsStatsDetailByPlayerIds: (...a: unknown[]) => riDetail(...a),
}))
vi.mock('@/lib/draft-room/storedDraftSeasonStats', () => ({
  loadStoredDraftSeasonStats: (...a: unknown[]) => stored(...a),
}))

import { attachSeasonStatsToMockPool, mergeSeasonStatsIntoEntry, mockScoringPreset } from '@/lib/mock-draft/mockPoolSeasonStats'
import { mockPoolStatCells } from '@/components/mock-draft/MockDraftSleeperRoomClient'

beforeEach(() => {
  riSeason.mockReset()
  riDetail.mockReset()
  stored.mockReset()
})

describe('mock scoring → scoring preset', () => {
  it('maps the three football settings, PPR by default', () => {
    expect(['PPR', 'Half PPR', 'half-ppr', 'Standard', null, 'Points'].map(mockScoringPreset)).toEqual([
      'PPR', 'HALF_PPR', 'HALF_PPR', 'STANDARD', 'PPR', 'PPR',
    ])
  })
})

describe('mergeSeasonStatsIntoEntry', () => {
  it('adds numbers to display.stats and keeps the rest of the row', () => {
    const row = { name: 'A', display: { assets: { headshotUrl: 'h' }, stats: { old: 1 } } }
    const out = mergeSeasonStatsIntoEntry(row, { stats: { pointsPerGame: 27.1, bad: null }, statSeason: '2025–26' })
    expect(out).toEqual({
      name: 'A',
      display: { assets: { headshotUrl: 'h' }, stats: { old: 1, pointsPerGame: 27.1 } },
      statSeason: '2025–26',
    })
    expect(mergeSeasonStatsIntoEntry(row, null)).toBe(row)
  })
})

describe('attachSeasonStatsToMockPool', () => {
  it('NBA: joins stored season rates on the Rolling Insights id; an unmatched row keeps its dashes', async () => {
    stored.mockResolvedValue(new Map([['111', { nbaDraftStats: { pointsPerGame: 26.4, reboundsPerGame: 12.4, minutesPerGame: 34.6 }, seasonStatLine: null, statSeason: '2025–26' }]]))
    const out = await attachSeasonStatsToMockPool(
      [{ name: 'Nikola Jokic', position: 'C', playerId: '111' }, { name: 'Nobody', position: 'PG', playerId: 'name:x' }],
      { sport: 'NBA' },
    )
    expect(stored).toHaveBeenCalledWith('NBA', ['111'], expect.any(Number))
    expect((out[0] as { display: { stats: Record<string, number> } }).display.stats.pointsPerGame).toBe(26.4)
    expect(out[1]).toEqual({ name: 'Nobody', position: 'PG', playerId: 'name:x' })
  })

  it('NFL: identity → season box → splits, one season for the pool', async () => {
    riSeason.mockResolvedValue({ identityByPoolKey: new Map([['bijan robinson|rb', { rollingInsightsPlayerId: 'ri-1', confidence: 'high' }]]), riSeasonByPlayerId: new Map() })
    riDetail.mockResolvedValue(new Map([['ri-1', {
      stats: { rushing_attempts: 300, rushing_yards: 1450, rushing_touchdowns: 14, receptions: 60, receiving_yards: 500, receiving_touchdowns: 2 },
      fantasyPoints: null, fantasyPointsPerGame: null, season: '2025', gamesPlayed: 17,
    }]]))
    const out = await attachSeasonStatsToMockPool(
      [{ name: 'Bijan Robinson', position: 'RB', sleeperId: '9509', playerId: '9509' }],
      { sport: 'NFL', scoring: 'PPR' },
    )
    expect(riSeason).toHaveBeenCalledWith({ rows: [{ nk: 'bijan robinson', pk: 'rb', sleeperCandidate: '9509' }] })
    expect(riDetail).toHaveBeenCalledWith(['ri-1'], { candidateSeasons: ['2025', '2024'] })
    const row = out[0] as { nflDraftProjectionSplits?: { rushing?: { yds?: number } }; statSeason?: string }
    expect(row.nflDraftProjectionSplits?.rushing?.yds).toBe(1450)
    expect(row.statSeason).toBe('2025')
  })

  it('a failed read leaves the pool exactly as it was', async () => {
    stored.mockRejectedValue(new Error('db down'))
    const rows = [{ name: 'A', position: 'C', playerId: '1' }]
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await attachSeasonStatsToMockPool(rows, { sport: 'MLB' })).toBe(rows)
    warn.mockRestore()
  })
})

describe('mockPoolStatCells', () => {
  it('a receiver gets points, average, catches and yards; a missing value is a dash', () => {
    const cells = mockPoolStatCells(
      { position: 'WR', adp: 5, display: { stats: { fantasyPointsPerGame: 18.2 } }, nflDraftProjectionSplits: { receiving: { rec: 110, yds: 1500 } } as never },
      'NFL',
    )
    expect(cells.map((c) => c.label)).toEqual(['PTS', 'AVG', 'REC', 'REC YDS'])
    expect(cells.map((c) => c.value)).toEqual(['—', '18.2', '110', '1,500'])
  })

  it('a basketball row gets basketball columns', () => {
    const cells = mockPoolStatCells({ position: 'C', adp: 1, display: { stats: { pointsPerGame: 26.4 } }, nflDraftProjectionSplits: null }, 'NBA')
    expect(cells.length).toBeGreaterThan(0)
    expect(cells.some((c) => c.value === '26.4')).toBe(true)
    expect(cells.every((c) => !/YDS|REC/.test(c.label))).toBe(true)
  })
})
