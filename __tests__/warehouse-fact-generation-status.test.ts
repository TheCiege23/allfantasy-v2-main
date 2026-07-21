import { beforeEach, describe, expect, it, vi } from 'vitest'

// Zero source rows must surface as MISSING_SOURCE_DATA — for months the generator returned
// {playerFacts: 0} truthfully and every caller folded it into a normal success, so the
// warehouse UI rendered "no history" as if it were real. Also covers the idempotency repair:
// the fact tables have NO unique key, so regeneration must delete-then-recreate, not append.

const playerGameStatFindMany = vi.fn()
const teamGameStatFindMany = vi.fn()
const playerGameFactDeleteMany = vi.fn()
const playerGameFactCreateMany = vi.fn()
const teamGameFactDeleteMany = vi.fn()
const teamGameFactCreateMany = vi.fn()
const transaction = vi.fn(async (ops: unknown[]) => ops)

vi.mock('@/lib/prisma', () => ({
  prisma: {
    playerGameStat: { findMany: (...a: unknown[]) => playerGameStatFindMany(...a) },
    teamGameStat: { findMany: (...a: unknown[]) => teamGameStatFindMany(...a) },
    playerGameFact: {
      deleteMany: (...a: unknown[]) => playerGameFactDeleteMany(...a),
      createMany: (...a: unknown[]) => playerGameFactCreateMany(...a),
    },
    teamGameFact: {
      deleteMany: (...a: unknown[]) => teamGameFactDeleteMany(...a),
      createMany: (...a: unknown[]) => teamGameFactCreateMany(...a),
    },
    $transaction: (...a: unknown[]) => transaction(...(a as [unknown[]])),
  },
}))

import { generateGameFactsFromExistingStats } from '@/lib/data-warehouse/HistoricalFactGenerator'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('generateGameFactsFromExistingStats', () => {
  it('reports MISSING_SOURCE_DATA when both source tables are empty (writes nothing)', async () => {
    playerGameStatFindMany.mockResolvedValue([])
    teamGameStatFindMany.mockResolvedValue([])

    const result = await generateGameFactsFromExistingStats('NFL', 2025, 3)
    expect(result.status).toBe('MISSING_SOURCE_DATA')
    expect(result.playerFacts).toBe(0)
    expect(result.sourcePlayerGameStats).toBe(0)
    expect(result.warnings[0]).toMatch(/no source rows/i)
    expect(transaction).not.toHaveBeenCalled()
  })

  it('regenerates the week scope atomically (delete + createMany, not append)', async () => {
    playerGameStatFindMany.mockResolvedValue([
      { playerId: '4046', gameId: 'NFL-2025-W03', statPayload: { pass_yd: 305 }, normalizedStatMap: { passing_yards: 305 }, fantasyPoints: 24.9 },
    ])
    teamGameStatFindMany.mockResolvedValue([])

    const result = await generateGameFactsFromExistingStats('NFL', 2025, 3)
    expect(result.status).toBe('COMPLETED')
    expect(result.playerFacts).toBe(1)
    expect(result.sourcePlayerGameStats).toBe(1)
    expect(transaction).toHaveBeenCalledTimes(1)
    expect(playerGameFactDeleteMany).toHaveBeenCalledWith({ where: { sport: 'NFL', season: 2025, weekOrRound: 3 } })
    expect(playerGameFactCreateMany).toHaveBeenCalledTimes(1)
    const created = playerGameFactCreateMany.mock.calls[0][0] as { data: Array<Record<string, unknown>> }
    expect(created.data[0]).toMatchObject({ playerId: '4046', sport: 'NFL', season: 2025, weekOrRound: 3, fantasyPoints: 24.9 })
  })

  it('flags PARTIAL when only team stats exist', async () => {
    playerGameStatFindMany.mockResolvedValue([])
    teamGameStatFindMany.mockResolvedValue([
      { teamId: 'KC', gameId: 'g1', statPayload: { points: 27, opponentPoints: 20 } },
    ])

    const result = await generateGameFactsFromExistingStats('NFL', 2025, 3)
    expect(result.status).toBe('PARTIAL')
    expect(result.teamFacts).toBe(1)
    expect(result.warnings[0]).toMatch(/PlayerGameStat has no source rows/i)
  })
})
