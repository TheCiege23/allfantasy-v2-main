import { beforeEach, describe, expect, it, vi } from 'vitest'
const helpers = vi.hoisted(() => ({ player: vi.fn() }))
vi.mock('@/lib/survivor-guillotine/playerCatalog', () => ({ verifiedSGNativePlayer: helpers.player }))
vi.mock('@/lib/redraft/rosterConfigResolver', () => ({ resolveRedraftRosterConfig: () => ({ maxRosterSize: 2, benchSlots: 1 }) }))
import { applyLegacyWaiverToCanonical, mirrorCanonicalRosters } from '@/lib/redraft/legacyWaiverBridge'

function database() {
  return {
    $queryRaw: vi.fn(async () => []),
    league: { findUniqueOrThrow: vi.fn(async () => ({ leagueVariant: 'survivor_guillotine', sport: 'NBA', settings: {} })) },
    roster: { findFirst: vi.fn(async () => ({ redraftRosterId: 'native', playerData: { players: ['existing', 'new'] }, faabRemaining: 70 })) },
    redraftRoster: {
      findFirst: vi.fn(async () => ({ id: 'native', seasonId: 'season', isEliminated: false, season: { sport: 'NBA' } })),
      findUnique: vi.fn(async () => ({ faabBalance: 70 })), updateMany: vi.fn(async () => ({ count: 1 })),
    },
    redraftSeason: { findUnique: vi.fn(async () => ({ status: 'active' })) },
    redraftRosterPlayer: {
      findFirst: vi.fn(async () => null),
      findMany: vi.fn(async () => [{ slotType: 'PG', playerId: 'existing' }]),
      updateMany: vi.fn(async () => ({ count: 1 })), create: vi.fn(async () => ({})),
    },
  }
}
beforeEach(() => { vi.resetAllMocks(); helpers.player.mockResolvedValue({ name: 'Verified NBA player', position: 'PG', team: 'BOS' }) })
describe('Survivor scoring-roster waiver settlement', () => {
  const args = { leagueId: 'L', rosterId: 'R', addPlayerId: 'new', dropPlayerId: null, faabSpent: 30 }
  it('requires a verified sport-specific identity before writing the scoring roster', async () => {
    const db = database()
    helpers.player.mockResolvedValue(null)
    await expect(applyLegacyWaiverToCanonical(db as never, args)).rejects.toThrow('Verified native player identity')
    expect(db.redraftRosterPlayer.create).not.toHaveBeenCalled()
    expect(db.redraftRoster.updateMany).not.toHaveBeenCalled()
  })
  it('creates the scoring player and debits only the linked scoring roster', async () => {
    const db = database()
    await applyLegacyWaiverToCanonical(db as never, args)
    expect(helpers.player).toHaveBeenCalledWith(db, 'NBA', 'new')
    expect(db.redraftRosterPlayer.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ rosterId: 'native', playerId: 'new', slotType: 'BENCH' }) }))
    expect(db.redraftRoster.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'native', faabBalance: { gte: 30 } } }))
  })
  it('rejects a generic/scoring roster mismatch so the caller can roll back', async () => {
    const db = database()
    await expect(mirrorCanonicalRosters(db as never, ['native'])).rejects.toThrow('rosters disagree')
  })
})
