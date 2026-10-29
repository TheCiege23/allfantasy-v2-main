import { describe, expect, it, vi } from 'vitest'
import { movePlayerBoundIdolsInTransaction } from '@/lib/survivor/playerBoundIdolTransfer'

function fixture() {
  const idol = { id: 'idol-1', rosterId: 'draft-a', currentOwnerUserId: 'user-a' as string | null, status: 'hidden', powerType: 'vote_shield' }
  const inventories: Record<string, string[]> = { 'user-a': ['idol-1'], 'user-b': [] }
  const ledger: Array<Record<string, unknown>> = []
  const notices: Array<Record<string, unknown>> = []
  const db = {
    survivorIdol: {
      findMany: vi.fn(async () => [{ ...idol }]),
      updateMany: vi.fn(async ({ where, data }: { where: { currentOwnerUserId: string | null }; data: { rosterId: string; currentOwnerUserId: string | null } }) => {
        if (idol.currentOwnerUserId !== where.currentOwnerUserId) return { count: 0 }
        idol.rosterId = data.rosterId
        idol.currentOwnerUserId = data.currentOwnerUserId
        return { count: 1 }
      }),
    },
    roster: { findMany: vi.fn(async () => [
      { id: 'draft-a', redraftRosterId: 'season-a' },
      { id: 'draft-b', redraftRosterId: 'season-b' },
    ]) },
    survivorPlayer: {
      findFirst: vi.fn(async ({ where }: { where: { redraftRosterId: string } }) =>
        where.redraftRosterId === 'draft-b' ? { userId: 'user-b' } : { userId: 'user-a' }),
      findUnique: vi.fn(async ({ where }: { where: { leagueId_userId: { userId: string } } }) =>
        ({ idolIds: inventories[where.leagueId_userId.userId] })),
      update: vi.fn(async ({ where, data }: { where: { leagueId_userId: { userId: string } }; data: { idolIds: string[] } }) => {
        inventories[where.leagueId_userId.userId] = data.idolIds
      }),
    },
    survivorIdolLedgerEntry: { create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { ledger.push(data); return { id: `ledger-${ledger.length}` } }) },
    league: { findUnique: vi.fn(async () => ({ userId: 'commish' })) },
    sportsPlayer: { findFirst: vi.fn(async () => ({ name: 'Jalen Brunson', imageUrl: 'https://img/brunson.png' })) },
    leagueChatMessage: { create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { notices.push(data) }) },
  }
  return { db, idol, inventories, ledger, notices }
}

describe('player-bound Survivor idol settlement', () => {
  it('moves private ownership and inventory with a traded player', async () => {
    const { db, idol, inventories, ledger } = fixture()
    await movePlayerBoundIdolsInTransaction(db as never, {
      leagueId: 'league', playerId: 'player', fromRedraftRosterId: 'season-a', toRedraftRosterId: 'season-b', reason: 'trade',
    })
    expect(idol).toMatchObject({ rosterId: 'draft-b', currentOwnerUserId: 'user-b' })
    expect(inventories).toEqual({ 'user-a': [], 'user-b': ['idol-1'] })
    expect(ledger[0]).toMatchObject({ fromRosterId: 'draft-a', toRosterId: 'draft-b', metadata: { reason: 'trade', playerId: 'player' } })
  })

  it('leaves the idol on the waived player and assigns it only to a winning claimant', async () => {
    const { db, idol, inventories, ledger } = fixture()
    await movePlayerBoundIdolsInTransaction(db as never, {
      leagueId: 'league', playerId: 'player', fromRedraftRosterId: 'season-a', toRedraftRosterId: null, reason: 'waiver_drop',
    })
    expect(idol).toMatchObject({ rosterId: '__survivor_waivers__', currentOwnerUserId: null })
    expect(inventories['user-a']).toEqual([])
    await movePlayerBoundIdolsInTransaction(db as never, {
      leagueId: 'league', playerId: 'player', fromRedraftRosterId: null, toRedraftRosterId: 'season-b', reason: 'waiver_claim',
    })
    expect(idol).toMatchObject({ rosterId: 'draft-b', currentOwnerUserId: 'user-b' })
    expect(inventories['user-b']).toEqual(['idol-1'])
    expect(ledger.map(entry => entry.eventType)).toEqual(['waived', 'transferred'])
  })

  it('refuses movement when an idol no longer belongs to the source roster', async () => {
    const { db, idol } = fixture()
    idol.rosterId = 'draft-b'
    await expect(movePlayerBoundIdolsInTransaction(db as never, {
      leagueId: 'league', playerId: 'player', fromRedraftRosterId: 'season-a', toRedraftRosterId: 'season-b', reason: 'trade',
    })).rejects.toThrow('no longer belongs to the source roster')
    expect(db.survivorIdol.updateMany).not.toHaveBeenCalled()
  })

  it('tells only the new holder, privately, when an idol arrives with a player', async () => {
    const { db, notices } = fixture()
    await movePlayerBoundIdolsInTransaction(db as never, {
      leagueId: 'league', playerId: 'player', fromRedraftRosterId: 'season-a', toRedraftRosterId: null, reason: 'waiver_drop',
    })
    expect(notices).toHaveLength(0)
    await movePlayerBoundIdolsInTransaction(db as never, {
      leagueId: 'league', playerId: 'player', fromRedraftRosterId: null, toRedraftRosterId: 'season-b', reason: 'waiver_claim',
    })
    expect(notices).toEqual([expect.objectContaining({
      id: 'survivor-idol:ledger-2:arrival', isPrivate: true, visibleToUserId: 'user-b', messageSubtype: 'chimmy_private',
      message: expect.stringContaining('Jalen Brunson arrived carrying a hidden Vote Shield Idol'),
    })])
  })
})
