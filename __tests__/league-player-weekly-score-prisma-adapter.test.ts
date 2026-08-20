import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  findMany: vi.fn(),
  upsert: vi.fn(),
  transaction: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    leaguePlayerWeeklyScore: {
      findMany: m.findMany,
    },
    $transaction: m.transaction,
  },
}))

import { PrismaLeaguePlayerWeeklyScoreAdapter } from '@/lib/scoring/league-player-weekly-score-prisma-adapter'
import type { LeaguePlayerWeeklyScoreCandidateRow } from '@/lib/scoring/league-player-weekly-score-store'

function row(overrides: Partial<LeaguePlayerWeeklyScoreCandidateRow> = {}): LeaguePlayerWeeklyScoreCandidateRow {
  return {
    leagueId: 'L1',
    playerId: 'P1',
    season: 2026,
    week: 3,
    sport: 'NFL',
    fantasyPts: 10,
    stats: null,
    isFinalized: false,
    source: 'rollup_pgs_shadow',
    lineageJobName: null,
    rollupVersion: 1,
    scoringProfileId: null,
    scoringRulesHash: 'hash-1',
    ...overrides,
  }
}

describe('PrismaLeaguePlayerWeeklyScoreAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    m.transaction.mockImplementation(async (fn: (tx: unknown) => Promise<void>) => {
      await fn({
        leaguePlayerWeeklyScore: {
          upsert: m.upsert,
        },
      })
    })
  })

  it('upserts with composite unique key and returns create/update counts', async () => {
    m.findMany.mockResolvedValue([
      {
        leagueId: 'L1',
        playerId: 'P1',
        season: 2026,
        week: 3,
        sport: 'NFL',
        fantasyPts: 8,
        isFinalized: false,
      },
    ])
    m.upsert.mockResolvedValue({})

    const adapter = new PrismaLeaguePlayerWeeklyScoreAdapter()
    const result = await adapter.upsertMany([row(), row({ playerId: 'P2', fantasyPts: 12 })])

    expect(m.findMany).toHaveBeenCalledTimes(1)
    expect(m.upsert).toHaveBeenCalledTimes(2)
    expect(m.upsert.mock.calls[0]?.[0]?.where).toMatchObject({
      leagueId_playerId_week_season_sport: {
        leagueId: 'L1',
        playerId: 'P1',
        week: 3,
        season: 2026,
        sport: 'NFL',
      },
    })
    expect(result).toEqual({
      wroteRows: 2,
      writtenCreate: 1,
      writtenUpdate: 1,
      skipped: 0,
    })
  })

  it('preserves finalized rows and skips near-equal points when no finalize promotion needed', async () => {
    m.findMany.mockResolvedValue([
      {
        leagueId: 'L1',
        playerId: 'P1',
        season: 2026,
        week: 3,
        sport: 'NFL',
        fantasyPts: 10.005,
        isFinalized: true,
      },
      {
        leagueId: 'L1',
        playerId: 'P2',
        season: 2026,
        week: 3,
        sport: 'NFL',
        fantasyPts: 5.001,
        isFinalized: false,
      },
    ])
    m.upsert.mockResolvedValue({})

    const adapter = new PrismaLeaguePlayerWeeklyScoreAdapter()
    const result = await adapter.upsertMany([
      row({ playerId: 'P1', fantasyPts: 10, isFinalized: false }),
      row({ playerId: 'P2', fantasyPts: 5, isFinalized: false }),
      row({ playerId: 'P3', fantasyPts: 9, isFinalized: true }),
    ])

    // P1 skipped (finalized already + within epsilon), P2 skipped (within epsilon), P3 created.
    expect(m.upsert).toHaveBeenCalledTimes(1)
    const updatePayload = m.upsert.mock.calls[0]?.[0]?.update
    expect(updatePayload?.isFinalized ?? true).toBe(true)
    expect(result).toEqual({
      wroteRows: 1,
      writtenCreate: 1,
      writtenUpdate: 0,
      skipped: 2,
    })
  })
})

