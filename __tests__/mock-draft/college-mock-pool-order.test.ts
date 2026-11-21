/**
 * College football mock pool order (2026-11-20): QB / RB / WR / TE only, ordered by this season's
 * production, each player once. Before, the pool was stale ADP (half of it centers) and then the
 * alphabet, so about 33 of the 300 shown had any stats.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CFBPlayerStats } from '@/lib/cfb-player-data'

const pool = vi.fn()
const outage = { on: false }
const devyStats = vi.fn()
vi.mock('@/lib/sport-teams/SportPlayerPoolResolver', () => ({
  getPlayerPoolForSport: (...a: unknown[]) => pool(...a),
  getPlayerPoolForLeague: vi.fn(),
}))
vi.mock('@/lib/devy/devyPlayerReads', () => ({
  // A flag, not a rejecting mock: a rejection kept in a mock's results fails this file at teardown.
  getDevyStatsByNameFromDb: async () => {
    if (outage.on) throw new Error('db down')
    return devyStats()
  },
}))
vi.mock('@/lib/draft-room/getResolvedDraftPoolForLeague', () => ({ loadLatestAveragedAdpRowsFromDb: vi.fn() }))
vi.mock('@/lib/draft-room/nbaSurvivorRosterEligibility', () => ({
  loadNbaSurvivorRosterEligibility: vi.fn(),
  nbaSurvivorPlayerIdMatches: vi.fn(),
}))

import { collegeProductionScore, orderCollegeMockPool } from '@/lib/mock-draft/collegeMockPoolOrder'
import { loadSportAwareDraftPlayerPool } from '@/lib/mock-draft/sport-player-pool'

const line = (position: string, s: Partial<CFBPlayerStats>): CFBPlayerStats => ({
  playerId: 1, playerName: '', team: '', position,
  passingYards: 0, passingTDs: 0, rushingYards: 0, rushingTDs: 0, receivingYards: 0, receivingTDs: 0, receptions: 0,
  ...s,
})

const stats = new Map<string, CFBPlayerStats>([
  ['arch manning', line('QB', { passingYards: 3163, passingTDs: 26, rushingYards: 399, rushingTDs: 10 })],
  ['jeremiah smith', line('WR', { receptions: 87, receivingYards: 1243, receivingTDs: 11 })],
  ['backup tight end', line('TE', { receptions: 5, receivingYards: 40 })],
  ['aj abbott', line('QB', { passingYards: 100 })],
])

const poolRow = (full_name: string, position: string, extra: Record<string, unknown> = {}) => ({
  player_id: `id-${full_name}-${position}`, full_name, position, team_abbreviation: 'TEAM', external_source_id: null, age: null, ...extra,
})

beforeEach(() => {
  pool.mockReset()
  devyStats.mockReset()
  outage.on = false
})

describe('collegeProductionScore', () => {
  it('ordinary football points, half a point per catch', () => {
    expect(collegeProductionScore(line('QB', { passingYards: 250, passingTDs: 2, rushingYards: 30, rushingTDs: 1 }))).toBe(10 + 8 + 3 + 6)
    expect(collegeProductionScore(line('WR', { receptions: 10, receivingYards: 100, receivingTDs: 1 }))).toBe(5 + 10 + 6)
  })
})

describe('orderCollegeMockPool', () => {
  const rows = [
    { name: 'A.D. Miller', position: 'WR' },
    { name: 'Alex Padgett', position: 'C' },
    { name: 'A.J. Abbott', position: 'WR' },
    { name: 'Backup Tight End', position: 'TE' },
    { name: 'Arch Manning', position: 'QB' },
    { name: 'Arch Manning', position: 'QB' },
    { name: 'Jeremiah Smith', position: 'WR' },
    { name: 'A.J. Abbott', position: 'QB' },
  ]

  it('production first, then the rest in pool order; non-skill positions and repeats dropped', () => {
    expect(orderCollegeMockPool(rows, stats, 10).map((r) => `${r.name} ${r.position}`)).toEqual([
      'Arch Manning QB',
      'Jeremiah Smith WR',
      'Backup Tight End TE', // 5 catches, 40 yards: 6.5
      'A.J. Abbott QB', // 100 passing yards: 4
      'A.D. Miller WR',
      'A.J. Abbott WR',
    ])
  })

  it('a same-named player at another position does not borrow the line', () => {
    const ordered = orderCollegeMockPool(rows, stats, 10)
    expect(ordered.findIndex((r) => r.name === 'A.J. Abbott' && r.position === 'WR'))
      .toBeGreaterThan(ordered.findIndex((r) => r.name === 'A.D. Miller'))
  })

  it('keeps the first copy of a player, so the pool\'s preferred row survives', () => {
    const copies = [{ name: 'Arch Manning', position: 'QB', id: 'with-photo' }, { name: 'Arch Manning', position: 'QB', id: 'no-photo' }]
    expect(orderCollegeMockPool(copies, stats, 5).map((r) => r.id)).toEqual(['with-photo'])
  })

  it('honours the limit', () => {
    expect(orderCollegeMockPool(rows, stats, 2).map((r) => r.name)).toEqual(['Arch Manning', 'Jeremiah Smith'])
  })
})

describe('loadSportAwareDraftPlayerPool — NCAAF', () => {
  beforeEach(() => {
    pool.mockImplementation(async (_sport: string, opts: { position: string }) => ({
      QB: [poolRow('A.J. Abbott', 'QB'), poolRow('Arch Manning', 'QB', { external_source_id: '777' })],
      RB: [],
      WR: [poolRow('A.D. Miller', 'WR'), poolRow('Jeremiah Smith', 'WR')],
      TE: [poolRow('Backup Tight End', 'TE')],
    })[opts.position] ?? [])
  })

  it('reads each skill position whole and returns them ranked, ADP by rank', async () => {
    devyStats.mockResolvedValue(stats)
    const out = await loadSportAwareDraftPlayerPool({ sport: 'NCAAF', limit: 300 })
    expect(pool.mock.calls.map((c) => c[1].position)).toEqual(['QB', 'RB', 'WR', 'TE'])
    expect(pool.mock.calls.every((c) => c[0] === 'NCAAF' && c[1].limit >= 20_000)).toBe(true)
    expect(out.map((p) => p.name)).toEqual(['Arch Manning', 'Jeremiah Smith', 'Backup Tight End', 'A.J. Abbott', 'A.D. Miller'])
    expect(out.map((p) => p.adp)).toEqual([1, 2, 3, 4, 5])
    expect(out[0]).toMatchObject({ playerId: '777', sport: 'NCAAF', position: 'QB' })
  })

  it('without the college stats the same positions come back in pool order', async () => {
    outage.on = true
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const out = await loadSportAwareDraftPlayerPool({ sport: 'NCAAF', limit: 300 })
    expect(out.map((p) => p.name)).toEqual(['A.J. Abbott', 'Arch Manning', 'A.D. Miller', 'Jeremiah Smith', 'Backup Tight End'])
    warn.mockRestore()
  })
})
