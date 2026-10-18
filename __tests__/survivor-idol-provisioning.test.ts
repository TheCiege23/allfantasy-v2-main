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

  it('seeds exactly the league idol types sealed at draft lock, one idol per slot, repeats included', async () => {
    const resolved = ['immunity', 'steal-three', 'vote-steal', 'vote-steal', 'vote-steal', 'extra-vote', 'extra-vote']
    const picks = Array.from({ length: 9 }, (_, index) => ({ playerId: `nba-${index}`, playerName: `Player ${index}`, rosterId: 'generic-1', assetType: 'player' }))
    const db = {
      $queryRaw: vi.fn(async () => [{ t: 'survivor_idol_types', c: 'survivor_idol_configs' }]),
      survivorIdolType: { findMany: vi.fn(async () => []) },
      survivorIdolConfig: {
        findUnique: vi.fn(async () => ({ mode: 'random', count: 7, hideFromCommish: true, pickedTypeIds: [], resolvedTypeIds: resolved, resolvedAt: new Date(), pointSurgePct: 15, tributePct: 10 })),
      },
      survivorIdol: { count: vi.fn(async () => 0), create: vi.fn(async () => ({ id: `idol-${Math.random()}` })) },
      league: { findUnique: vi.fn(async () => ({ settings: {}, survivorIdolCount: 9, userId: 'commissioner' })) },
      survivorTribe: { count: vi.fn(async () => 1) },
      draftSession: { findFirst: vi.fn(async () => ({ id: 'draft-1', status: 'completed', sessionKind: 'real' })) },
      survivorPlayer: {
        findMany: vi.fn(async () => [{ userId: 'user-1', redraftRosterId: 'generic-1' }]),
        findUnique: vi.fn(async () => ({ idolIds: [] })),
        update: vi.fn(async () => ({})),
      },
      roster: { findMany: vi.fn(async () => [{ id: 'generic-1', redraftRosterId: 'season-1' }]) },
      draftPick: { findMany: vi.fn(async () => picks) },
      survivorLeagueConfig: { findUnique: vi.fn(async () => ({ id: 'config-1', idolCount: 7, idolPowerPool: null })), update: vi.fn(async () => ({})) },
      survivorIdolLedgerEntry: { create: vi.fn(async () => ({})) },
      sportsPlayer: { findFirst: vi.fn(async () => ({ name: 'Player', imageUrl: null })) },
      leagueChatMessage: { create: vi.fn(async () => ({})) },
      survivorAuditEntry: { create: vi.fn(async () => ({})) },
    }
    const { seedSurvivorIdols } = await import('@/lib/survivor/survivorIdolProvisioning')
    const result = await seedSurvivorIdols('league-1', { db: db as never, seed: 5 })
    expect(result).toMatchObject({ ok: true, seeded: true, voteShieldCount: 7 })
    const created = db.survivorIdol.create.mock.calls.map(([arg]: any) => arg.data)
    expect(created.map((idol: any) => idol.powerType).sort()).toEqual(['extra_vote', 'extra_vote', 'triple_steal', 'vote_shield', 'vote_steal', 'vote_steal', 'vote_steal'])
    expect(created.find((idol: any) => idol.powerType === 'triple_steal')).toMatchObject({ powerLabel: 'Steal 3', powerCategory: 'roster', isSecret: true })
    expect(created.every((idol: any) => typeof idol.auditLog.idolTypeId === 'string')).toBe(true)
    const dm = db.leagueChatMessage.create.mock.calls.map(([arg]: any) => arg.data.metadata)
    expect(dm.map((meta: any) => meta.idolTypeId).sort()).toEqual([...resolved].sort())
  })
})

describe('seeding never creates an idol without a play engine', () => {
  it('redraws a sealed draw holding coming-soon types before seeding', async () => {
    const stale = ['immunity', 'tribe-immunity', 'vote-steal', 'point-surge', 'captain', 'first-claim', 'decoy']
    let row: any = { mode: 'random', count: 7, hideFromCommish: false, pickedTypeIds: [], resolvedTypeIds: stale, resolvedAt: new Date(), pointSurgePct: 15, tributePct: 10 }
    const picks = Array.from({ length: 9 }, (_, index) => ({ playerId: `nba-${index}`, playerName: `Player ${index}`, rosterId: 'generic-1', assetType: 'player' }))
    const db = {
      $queryRaw: vi.fn(async () => [{ t: 'survivor_idol_types', c: 'survivor_idol_configs' }]),
      survivorIdolType: { findMany: vi.fn(async () => []) },
      survivorIdolConfig: {
        findUnique: vi.fn(async () => row),
        updateMany: vi.fn(async ({ data }: any) => { row = { ...row, ...data }; return { count: 1 } }),
      },
      survivorIdol: { count: vi.fn(async () => 0), create: vi.fn(async () => ({ id: `idol-${Math.random()}` })) },
      league: { findUnique: vi.fn(async () => ({ settings: {}, survivorIdolCount: 7, userId: 'commissioner' })) },
      survivorTribe: { count: vi.fn(async () => 1) },
      draftSession: { findFirst: vi.fn(async () => ({ id: 'draft-1', status: 'completed', sessionKind: 'real' })) },
      survivorPlayer: { findMany: vi.fn(async () => [{ userId: 'user-1', redraftRosterId: 'generic-1' }]), findUnique: vi.fn(async () => ({ idolIds: [] })), update: vi.fn(async () => ({})) },
      roster: { findMany: vi.fn(async () => [{ id: 'generic-1', redraftRosterId: 'season-1' }]) },
      draftPick: { findMany: vi.fn(async () => picks) },
      survivorLeagueConfig: { findUnique: vi.fn(async () => ({ id: 'config-1', idolCount: 7, idolPowerPool: null })), update: vi.fn(async () => ({})) },
      survivorIdolLedgerEntry: { create: vi.fn(async () => ({})) },
      sportsPlayer: { findFirst: vi.fn(async () => ({ name: 'Player', imageUrl: null })) },
      leagueChatMessage: { create: vi.fn(async () => ({})) },
      survivorAuditEntry: { create: vi.fn(async () => ({})) },
    }
    const { seedSurvivorIdols } = await import('@/lib/survivor/survivorIdolProvisioning')
    const result = await seedSurvivorIdols('league-1', { db: db as never, seed: 9 })
    expect(result).toMatchObject({ ok: true, seeded: true, voteShieldCount: 7 })
    const powers = db.survivorIdol.create.mock.calls.map(([arg]: any) => arg.data.powerType)
    expect(powers).toHaveLength(7)
    expect(powers.every((power: string) => ['vote_shield', 'extra_vote', 'vote_steal', 'triple_steal'].includes(power))).toBe(true)
  })
})
