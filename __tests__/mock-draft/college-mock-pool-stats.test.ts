/**
 * College football mock pool (2026-11-20): each row carries its school season line from
 * `DevyPlayer`, and each position shows its own columns — a QB passing, a WR catches.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const devyStats = vi.fn()
// The outage is a flag, not a mock that rejects: a rejection kept in a mock's results is reported
// as a failure when this file tears down, even though the code under test handled it.
const outage = { on: false }
vi.mock('@/lib/devy/devyPlayerReads', () => ({
  getDevyStatsByNameFromDb: async (...a: unknown[]) => {
    if (outage.on) throw new Error('db down')
    return devyStats(...a)
  },
}))

import { attachSeasonStatsToMockPool, collegeStatFields } from '@/lib/mock-draft/mockPoolSeasonStats'
import { mockPoolPhoneStatLine, mockPoolStatCells } from '@/components/mock-draft/MockDraftSleeperRoomClient'
import type { CFBPlayerStats } from '@/lib/cfb-player-data'

const line = (name: string, position: string, s: Partial<CFBPlayerStats>): CFBPlayerStats => ({
  playerId: 1, playerName: name, team: 'Ohio State', position,
  passingYards: 0, passingTDs: 0, rushingYards: 0, rushingTDs: 0, receivingYards: 0, receivingTDs: 0, receptions: 0,
  ...s,
})

const byName = new Map<string, CFBPlayerStats>([
  ['arch manning', line('Arch Manning', 'QB', { passingYards: 3163, passingTDs: 26, rushingYards: 399, rushingTDs: 10 })],
  ['jeremiah smith', line('Jeremiah Smith', 'WR', { receptions: 87, receivingYards: 1243, receivingTDs: 11 })],
  ['aj abbott', line('A.J. Abbott', 'QB', { passingYards: 900, passingTDs: 6 })],
  ['travis hunter', line('Travis Hunter Jr.', 'WR', { receptions: 70, receivingYards: 900, receivingTDs: 9 })],
])

beforeEach(() => devyStats.mockReset())

describe('collegeStatFields', () => {
  it('joins on name and position; suffixes and punctuation do not matter', () => {
    const fields = collegeStatFields(
      [
        { name: 'Arch Manning', position: 'QB' },
        { name: 'Travis Hunter Jr.', position: 'WR' },
      ],
      byName,
    )
    expect(fields[0]?.stats).toMatchObject({ pass_yds: 3163, pass_td: 26, rush_yds: 399, rush_td: 10 })
    expect(fields[1]?.stats).toMatchObject({ rec: 70, rec_yds: 900, rec_td: 9 })
  })

  it('a same-named player at another position gets nothing, not the other one\'s line', () => {
    const fields = collegeStatFields([{ name: 'A.J. Abbott', position: 'QB' }, { name: 'A.J. Abbott', position: 'WR' }], byName)
    expect(fields[0]?.stats?.pass_yds).toBe(900)
    expect(fields[1]).toBeNull()
  })

  it('no line for a name the data does not have, or a non-skill position', () => {
    expect(collegeStatFields([{ name: 'Nobody Here', position: 'RB' }, { name: 'Arch Manning', position: 'K' }], byName)).toEqual([null, null])
  })
})

describe('attachSeasonStatsToMockPool — NCAAF', () => {
  it('puts the season line into display.stats, keeping what was there', async () => {
    devyStats.mockResolvedValue(byName)
    const [row] = await attachSeasonStatsToMockPool(
      [{ name: 'Jeremiah Smith', position: 'WR', display: { stats: { byeWeek: 7 } } }],
      { sport: 'NCAAF' },
    )
    expect((row as { display: { stats: Record<string, number> } }).display.stats).toMatchObject({ byeWeek: 7, rec: 87, rec_yds: 1243, rec_td: 11 })
  })

  it('a failed read leaves the pool as it was', async () => {
    outage.on = true
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const rows = [{ name: 'Jeremiah Smith', position: 'WR' }]
    expect(await attachSeasonStatsToMockPool(rows, { sport: 'NCAAF' })).toBe(rows)
    outage.on = false
    warn.mockRestore()
  })
})

describe('college mock columns', () => {
  const row = (position: string, stats: Record<string, number>) =>
    ({ position, adp: 10, display: { stats }, nflDraftProjectionSplits: null }) as never

  it('each position gets its own columns', () => {
    const qb = mockPoolStatCells(row('QB', { pass_yds: 3163, pass_td: 26, rush_yds: 399, rush_td: 10 }), 'NCAAF')
    expect(qb.map((c) => `${c.label} ${c.value}`)).toEqual(['PA YDS 3,163', 'PA TD 26', 'RU YDS 399', 'RU TD 10'])
    const wr = mockPoolStatCells(row('WR', { rec: 87, rec_yds: 1243, rec_td: 11, rush_yds: 4 }), 'NCAAF')
    expect(wr.map((c) => c.label)).toEqual(['REC', 'REC YDS', 'REC TD', 'RU YDS'])
    expect(wr.map((c) => c.label).some((l) => l.startsWith('PA'))).toBe(false)
    const rb = mockPoolStatCells(row('RB', { rush_yds: 1200 }), 'NCAAF')
    expect(rb.map((c) => c.label)).toEqual(['RU YDS', 'RU TD', 'REC', 'REC YDS'])
    expect(rb.map((c) => c.value)).toEqual(['1,200', '—', '—', '—'])
    expect(mockPoolStatCells(row('TE', {}), 'NCAAF').map((c) => c.label)).toEqual(['REC', 'REC YDS', 'REC TD'])
  })

  it('phone line: the position\'s first two stats', () => {
    expect(mockPoolPhoneStatLine(row('WR', { rec: 87, rec_yds: 1243, rec_td: 11 }), 'NCAAF')).toBe('REC 87 · REC YDS 1,243')
    expect(mockPoolPhoneStatLine(row('QB', { pass_yds: 3163, pass_td: 26 }), 'NCAAF')).toBe('PA YDS 3,163 · PA TD 26')
  })

  it('NFL columns are unchanged', () => {
    const cells = mockPoolStatCells(
      { position: 'WR', adp: 5, display: { stats: { fantasyPointsPerGame: 18.2 } }, nflDraftProjectionSplits: { receiving: { rec: 110, yds: 1500 } } as never },
      'NFL',
    )
    expect(cells.map((c) => c.label)).toEqual(['PTS', 'AVG', 'REC', 'REC YDS'])
  })
})
