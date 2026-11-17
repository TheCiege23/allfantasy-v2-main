/**
 * Team defenses for the NFL mock pool (2026-11-16). The latest week's consensus board held 4 defenses,
 * so an 8-team mock had 4 for 8 teams; every defense's last consensus price this season fills the rest.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const db = vi.hoisted(() => ({ findFirst: vi.fn(), findMany: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { adpDataRecord: { findFirst: db.findFirst, findMany: db.findMany } } }))

import { __resetSeasonDefenseAdpCache, getSeasonDefenseAdp } from '@/lib/adp/liveAdpFallback'
import { fillPoolFromConsensus, type MockPoolEntry } from '@/lib/mock-draft/nflPoolConsensusFill'

/* Rows come back newest week first, as the query orders them. */
const ROWS = [
  { playerName: 'Buffalo Defense', team: 'BUF', adp: 157, week: 47, scoring: '2qb' },
  { playerName: 'Buffalo Defense', team: 'BUF', adp: 160, week: 47, scoring: 'standard' },
  { playerName: 'Houston Defense', team: 'HOU', adp: 96.3, week: 47, scoring: 'standard' },
  { playerName: 'Seattle Defense', team: 'SEA', adp: 96.5, week: 41, scoring: '2qb' },
  // Older and cheaper: the most RECENT price wins, not the lowest.
  { playerName: 'Seattle Defense', team: 'SEA', adp: 90, week: 30, scoring: 'standard' },
  { playerName: 'Miami Defense', team: 'MIA', adp: 180, week: 34, scoring: 'ppr' },
  { playerName: 'Broken Defense', team: 'XXX', adp: 0, week: 47, scoring: 'standard' },
]

beforeEach(() => {
  vi.clearAllMocks()
  __resetSeasonDefenseAdpCache()
  db.findFirst.mockResolvedValue({ season: 2026 })
  db.findMany.mockResolvedValue(ROWS)
})

describe('getSeasonDefenseAdp', () => {
  it("keeps each defense's most recent price, standard scoring winning a tie, best ADP first", async () => {
    const out = await getSeasonDefenseAdp({ now: 1 })
    expect(out.map((d) => [d.name, d.adp])).toEqual([
      ['Houston Defense', 96.3],
      ['Seattle Defense', 96.5],
      ['Buffalo Defense', 160],
      ['Miami Defense', 180],
    ])
    expect(db.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ season: 2026, source: 'consensus', format: 'redraft', position: { in: ['DEF', 'DST', 'D/ST'] } }) }),
    )
  })

  it('reads the table once per cache window, and a failed read is an empty list', async () => {
    await getSeasonDefenseAdp({ now: 1 })
    await getSeasonDefenseAdp({ now: 2 })
    expect(db.findMany).toHaveBeenCalledTimes(1)
    __resetSeasonDefenseAdpCache()
    db.findMany.mockRejectedValue(new Error('db down'))
    expect(await getSeasonDefenseAdp({ now: 3 })).toEqual([])
  })
})

describe('the pool gets enough defenses', () => {
  it('a pool with 4 defenses gains the rest at their own ADPs, and keeps the ones it had', async () => {
    const def = (name: string, adp: number): MockPoolEntry => ({
      name, position: 'DEF', team: null, adp, adpFormatted: null, adpTrend: null, age: null, value: null, source: 'ffc',
      ffcPlayerId: 9, timesDrafted: 1, adpHigh: null, adpLow: null, adpStdev: null, bye: null,
    })
    const before = [def('Buffalo Defense', 157), def('Houston Defense', 96.3)]
    const defenses = await getSeasonDefenseAdp({ now: 1 })
    const pool = fillPoolFromConsensus(before, defenses.map((d) => ({ name: d.name, adp: d.adp, position: 'DEF', team: d.team })), 300)
    expect(pool.filter((p) => p.position === 'DEF').map((p) => p.name)).toEqual(['Houston Defense', 'Seattle Defense', 'Buffalo Defense', 'Miami Defense'])
    expect(pool.find((p) => p.name === 'Buffalo Defense')).toMatchObject({ adp: 157, source: 'ffc' })
  })
})
