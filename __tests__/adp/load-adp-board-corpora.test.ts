import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const findMany = vi.hoisted(() => vi.fn())
vi.mock('@/lib/prisma', () => ({ prisma: { allFantasyAdpSnapshot: { findMany } } }))

import { loadAdpBoard } from '@/lib/adp/loadAdpBoard'

const CTX = {
  sport: 'NFL',
  leagueType: 'redraft',
  draftType: 'snake',
  scoringFormat: 'ppr',
  rosterFormat: 'standard',
  teamCount: 12,
  season: '2026',
}

const pool = (playerKey: string, draftType: string, averageOverallPick: number, sampleSize: number) => ({
  playerKey,
  playerName: playerKey.split('|')[0],
  teamCount: 12,
  draftType,
  averageOverallPick,
  sampleSize,
  lastUpdatedAt: new Date(),
})

beforeEach(() => {
  findMany.mockReset()
})

describe('loadAdpBoard corpora — AllFantasy and imported drafts kept apart', () => {
  it('reports own and imported values separately for the same player', async () => {
    findMany
      .mockResolvedValueOnce([]) // exact board: empty
      .mockResolvedValueOnce([pool('bijan robinson|rb', 'snake', 3, 50), pool('bijan robinson|rb', 'imported', 5, 200)])
    const board = await loadAdpBoard(CTX)
    const split = board.corpora.get('bijan robinson|rb')!
    expect(split.own).toEqual({ adp: 3, sampleSize: 50 })
    expect(split.imported).toEqual({ adp: 5, sampleSize: 200 })
  })

  it('an exact AllFantasy row wins the own slot over a cross-size projection', async () => {
    findMany
      .mockResolvedValueOnce([
        {
          playerKey: 'bijan robinson|rb',
          playerName: 'Bijan Robinson',
          sampleSize: 9,
          averageOverallPick: 2,
          averageRound: 1,
          averagePickInRound: 2,
          minOverallPick: 1,
          maxOverallPick: 4,
          standardDeviation: 1,
          sevenDayTrend: null,
          thirtyDayTrend: null,
          lastUpdatedAt: new Date(),
        },
      ])
      .mockResolvedValueOnce([pool('bijan robinson|rb', 'snake', 7, 300), pool('bijan robinson|rb', 'imported', 5, 200)])
    const board = await loadAdpBoard(CTX)
    const split = board.corpora.get('bijan robinson|rb')!
    expect(split.own).toEqual({ adp: 2, sampleSize: 9 })
    expect(split.imported?.adp).toBe(5)
  })
})
