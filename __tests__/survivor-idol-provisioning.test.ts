import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

describe('native Survivor idol provisioning', () => {
  it('seeds a real drafted player and reveals the headshot only in its owner’s private chat', async () => {
    const db = {
      survivorIdol: { count: vi.fn(async () => 0), create: vi.fn(async () => ({ id: 'idol-1' })) },
      league: { findUnique: vi.fn(async () => ({ settings: {}, survivorIdolCount: 1, userId: 'commissioner' })) },
      survivorTribe: { count: vi.fn(async () => 1) },
      draftSession: { findFirst: vi.fn(async () => ({ id: 'draft-1', status: 'completed', sessionKind: 'real' })) },
      survivorPlayer: {
        findMany: vi.fn(async () => [{ userId: 'user-1', redraftRosterId: 'generic-1' }]),
        findUnique: vi.fn(async () => ({ idolIds: [] })),
        update: vi.fn(async () => ({})),
      },
      roster: { findMany: vi.fn(async () => [{ id: 'generic-1', redraftRosterId: 'season-1' }]) },
      draftPick: { findMany: vi.fn(async () => [{ playerId: 'nba-1', playerName: 'Player One', rosterId: 'generic-1', assetType: 'player' }]) },
      survivorLeagueConfig: { findUnique: vi.fn(async () => ({ id: 'config-1', idolCount: 1, idolPowerPool: ['vote_shield'] })) },
      survivorIdolLedgerEntry: { create: vi.fn(async () => ({})) },
      sportsPlayer: { findFirst: vi.fn(async () => ({ name: 'Player One', imageUrl: 'https://example.com/player-one.png' })) },
      leagueChatMessage: { create: vi.fn(async () => ({})) },
      survivorAuditEntry: { create: vi.fn(async () => ({})) },
    }
    const { seedSurvivorIdols } = await import('@/lib/survivor/survivorIdolProvisioning')
    const result = await seedSurvivorIdols('league-1', { db: db as never, seed: 123 })

    expect(result).toMatchObject({ ok: true, seeded: true, voteShieldCount: 1, ownerCount: 1 })
    expect(db.survivorIdol.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ playerId: 'nba-1', rosterId: 'generic-1', currentOwnerUserId: 'user-1', isSecret: true }),
    }))
    expect(db.leagueChatMessage.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      isPrivate: true, visibleToUserId: 'user-1', imageUrl: 'https://example.com/player-one.png',
      metadata: expect.objectContaining({ survivorIdolReveal: true, playerId: 'nba-1' }),
    }) }))
    expect(db.survivorAuditEntry.create.mock.calls[0][0].data.data).not.toHaveProperty('seed')
  })
})
