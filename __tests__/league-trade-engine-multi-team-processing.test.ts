import { describe, expect, it, vi } from 'vitest'
import { applyTradeAssetsInTransaction } from '@/lib/league-trade-engine/tradeProcessor'

describe('multi-team trade processing', () => {
  it('moves players, picks and FAAB across all three rosters atomically', async () => {
    const rosters = [
      { id: 'a', leagueId: 'league', playerData: { players: ['p-a'], draftPicks: [{ id: 'pick-a', season: 2027, round: 1 }] }, faabRemaining: 50 },
      { id: 'b', leagueId: 'league', playerData: { players: ['p-b'], draftPicks: [] }, faabRemaining: 20 },
      { id: 'c', leagueId: 'league', playerData: { players: ['p-c'], draftPicks: [] }, faabRemaining: 10 },
    ]
    const saved = new Map<string, { playerData: unknown; faabRemaining: number }>()
    const tx = {
      roster: {
        findMany: vi.fn().mockResolvedValue(rosters),
        update: vi.fn().mockImplementation(async ({ where, data }) => {
          saved.set(where.id, data)
          return { id: where.id, ...data }
        }),
      },
    }

    await applyTradeAssetsInTransaction(tx as never, {
      leagueId: 'league',
      proposerRosterId: 'a',
      receiverRosterId: 'b',
      participantRosterIds: ['a', 'b', 'c'],
      assets: [
        { itemType: 'player', itemReference: 'p-a', fromRosterId: 'a', toRosterId: 'b' },
        { itemType: 'player', itemReference: 'p-b', fromRosterId: 'b', toRosterId: 'c' },
        { itemType: 'future_pick', itemReference: 'pick-a', fromRosterId: 'a', toRosterId: 'c' },
        { itemType: 'faab', faabAmount: 7, fromRosterId: 'c', toRosterId: 'a' },
      ],
    })

    expect(saved.get('a')?.playerData).toMatchObject({ players: [], draftPicks: [] })
    expect(saved.get('a')?.faabRemaining).toBe(57)
    expect(saved.get('b')?.playerData).toMatchObject({ players: ['p-a'] })
    expect(saved.get('c')?.playerData).toMatchObject({ players: ['p-c', 'p-b'], draftPicks: [{ id: 'pick-a' }] })
    expect(saved.get('c')?.faabRemaining).toBe(3)
    expect(tx.roster.update).toHaveBeenCalledTimes(3)
  })
})
