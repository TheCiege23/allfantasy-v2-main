// @vitest-environment node
import { beforeEach, describe, it, expect, vi } from 'vitest'
const h = vi.hoisted(() => ({ items: [] as any[], status: 'Survivor', closed: false, tx: null as any }))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/zombie/beta2025ItemService', () => ({
  lockItemLeague: vi.fn(async () => undefined),
  lastStarterDeadline: vi.fn(async () => new Date(Date.now() + (h.closed ? -60_000 : 60_000))),
  loadBetaItemScoreReceipt: vi.fn(async () => ({ policy: 'beta_2025', home: { bonus: 0 }, away: { bonus: 0 } })),
}))
import { validateBetaTradeItems, settleBetaTradeItems } from '@/lib/zombie/beta2025ItemTrades'
const assets = [{ assetType: 'zombie_item', fromRosterId: 'RR-A', toRosterId: 'RR-B', metadata: { zombieItemId: 'gun' } }]
beforeEach(() => {
  vi.clearAllMocks(); h.status = 'Survivor'; h.closed = false
  h.items = [{ id: 'gun', teamStatusId: 'A', itemType: 'weapon_gun', itemLabel: 'Gun', isUsed: false, isExpired: false, activationState: 'ready' }]
  h.tx = {
    $queryRaw: vi.fn(async () => []),
    zombieLeague: { findUnique: vi.fn(async () => ({ id: 'z', leagueId: 'L', sport: 'NFL', status: 'active', currentWeek: 4, season: 2026 })) },
    zombieWeeklyResolution: { findUnique: vi.fn(async () => null) },
    redraftRoster: { findMany: vi.fn(async () => [{ id: 'RR-A', ownerId: 'ua' }, { id: 'RR-B', ownerId: 'ub' }]) },
    roster: { findMany: vi.fn(async () => [{ id: 'a', redraftRosterId: 'RR-A', platformUserId: 'ua' }, { id: 'b', redraftRosterId: 'RR-B', platformUserId: 'ub' }]) },
    zombieLeagueTeam: { findMany: vi.fn(async () => [{ id: 'A', rosterId: 'a', status: h.status, items: h.items.filter(i => i.teamStatusId === 'A') }, { id: 'B', rosterId: 'b', status: 'Whisperer', items: h.items.filter(i => i.teamStatusId === 'B') }]) },
    redraftMatchup: { findMany: vi.fn(async () => [{ id: 'M', homeRosterId: 'RR-A', awayRosterId: 'RR-B', lineupSnapshots: {} }]), update: vi.fn(async () => ({})) },
    zombieTeamItem: { updateMany: vi.fn(async (a: any) => { const item = h.items.find(i => i.id === a.where.id && i.teamStatusId === a.where.teamStatusId && !i.isUsed); if (!item) return { count: 0 }; Object.assign(item, a.data); return { count: 1 } }) },
    zombieAuditLog: { create: vi.fn(async () => ({})) },
    league: { findUnique: vi.fn(async () => ({ userId: 'commish' })) },
    leagueChatMessage: { upsert: vi.fn(async () => ({})) },
  }
})
describe('2025 native item trades', () => {
  it('refuses multi-team item trades before any inventory is read', async () => {
    await expect(validateBetaTradeItems(h.tx, 'L', ['RR-A', 'RR-B', 'RR-C'], assets)).rejects.toThrow('two teams')
    expect(h.tx.zombieLeague.findUnique).not.toHaveBeenCalled()
  })
  it('allows Survivor and Whisperer inventory through the common proposal workflow', async () => {
    await expect(validateBetaTradeItems(h.tx, 'L', ['RR-A', 'RR-B'], assets)).resolves.toMatchObject({ z: { id: 'z' } })
  })
  it('rechecks infection at execution', async () => { h.status = 'Zombie'; await expect(settleBetaTradeItems(h.tx, { leagueId: 'L', rosterIds: ['RR-A', 'RR-B'], assets, tradeId: 'trade' })).rejects.toThrow('cannot trade'); expect(h.tx.zombieTeamItem.updateMany).not.toHaveBeenCalled() })
  it('refuses duplicate or spent item ids', async () => {
    await expect(validateBetaTradeItems(h.tx, 'L', ['RR-A', 'RR-B'], [...assets, ...assets])).rejects.toThrow('twice')
    h.items[0].isUsed = true; await expect(validateBetaTradeItems(h.tx, 'L', ['RR-A', 'RR-B'], assets)).rejects.toThrow('unavailable')
  })
  it('moves ownership and posts an idempotent chat receipt in the same transaction', async () => {
    await settleBetaTradeItems(h.tx, { leagueId: 'L', rosterIds: ['RR-A', 'RR-B'], assets, tradeId: 'trade' })
    expect(h.items[0]).toMatchObject({ teamStatusId: 'B', userId: 'ub', acquiredReason: 'trade:trade', activatesAtWeek: 4 })
    expect(h.tx.leagueChatMessage.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'zombie-item-trade:trade' } }))
    expect(h.tx.zombieAuditLog.create).toHaveBeenCalledOnce()
  })
  it('received items activate next week after the last starter has begun', async () => {
    h.closed = true
    await settleBetaTradeItems(h.tx, { leagueId: 'L', rosterIds: ['RR-A', 'RR-B'], assets, tradeId: 'trade' })
    expect(h.items[0].activatesAtWeek).toBe(5)
    expect(h.tx.redraftMatchup.update).toHaveBeenCalled() // pre-trade bonus receipt is preserved
  })
  it('holds item trades during weekly settlement', async () => { h.tx.zombieWeeklyResolution.findUnique.mockResolvedValueOnce({ status: 'resolving' }); await expect(validateBetaTradeItems(h.tx, 'L', ['RR-A', 'RR-B'], assets)).rejects.toThrow('held') })
  it('an arbitrary inventory id cannot steal another team item', async () => { h.items[0].teamStatusId = 'elsewhere'; await expect(validateBetaTradeItems(h.tx, 'L', ['RR-A', 'RR-B'], assets)).rejects.toThrow('owned') })
})
