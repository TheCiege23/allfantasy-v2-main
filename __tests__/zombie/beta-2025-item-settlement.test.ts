// @vitest-environment node
import { beforeEach, describe, it, expect, vi } from 'vitest'
const h = vi.hoisted(() => ({ state: {} as any, db: null as any }))
vi.mock('@/lib/redraft/lineupLock', () => ({ buildWeekKickoffMap: vi.fn(), lockTeamLookupKeys: vi.fn() }))
vi.mock('@/lib/redraft/lineupLockCurrentTeam', () => ({ resolveCurrentLockTeams: vi.fn() }))
vi.mock('@/lib/prisma', () => {
  const db = {
    $queryRaw: vi.fn(async () => []),
    zombieLeague: { findUnique: vi.fn(async () => ({ id: 'z', leagueId: 'L', sport: 'NFL', currentWeek: 4, status: 'active' })) },
    zombieWeeklyResolution: { findUnique: vi.fn(async () => h.state.resolution), update: vi.fn(async (a: any) => Object.assign(h.state.resolution, a.data)) },
    zombieLeagueTeam: { findUnique: vi.fn(async (a: any) => { const team = h.state.teams.find((t: any) => t.id === a.where.id); return { ...team, items: h.state.items.filter((i: any) => i.teamStatusId === team.id) } }), updateMany: vi.fn(async (a: any) => { const team = h.state.teams.find((t: any) => t.id === a.where.id && t.status === a.where.status); if (!team) return { count: 0 }; Object.assign(team, a.data); return { count: 1 } }) },
    zombieTeamItem: {
      updateMany: vi.fn(async (a: any) => {
        const ids = a.where.id.in ?? [a.where.id]
        const items = h.state.items.filter((i: any) => ids.includes(i.id) && (!a.where.teamStatusId || i.teamStatusId === a.where.teamStatusId) && !i.isUsed && !i.isExpired)
        items.forEach((i: any) => Object.assign(i, a.data)); return { count: items.length }
      }),
      upsert: vi.fn(async (a: any) => { const old = h.state.items.find((i: any) => i.awardKey === a.where.awardKey); if (old) return old; const item = { id: `award-${h.state.items.length}`, isUsed: false, isExpired: false, activationState: 'ready', ...a.create }; h.state.items.push(item); return item }),
    },
    zombieAuditLog: { create: vi.fn(async () => ({})) },
    $transaction: vi.fn(async (run: any) => { const before = structuredClone(h.state); try { return await run(db) } catch (e) { h.state = before; throw e } }),
  }
  h.db = db; return { prisma: db }
})
import { settleBetaItems, readBetaItemMatchup } from '@/lib/zombie/beta2025ItemSettlement'
const item = (id: string, type: string) => ({ id, itemType: type, itemLabel: type, teamStatusId: 'B', userId: 'b', isUsed: false, isExpired: false, activationState: 'ready', activatesAtWeek: null, usedAtWeek: null, usedOnUserId: null, usedEffect: null, acquiredAtWeek: 2, awardKey: null })
beforeEach(() => {
  vi.clearAllMocks()
  const teams = [{ id: 'A', rosterId: 'a', status: 'Survivor', weekBecameZombie: null, killedAtWeek: null }, { id: 'B', rosterId: 'b', status: 'Zombie', weekBecameZombie: 2, killedAtWeek: 2 }]
  const items = [item('s1', 'serum'), item('s2', 'serum'), item('gun', 'weapon_gun')]
  h.state = { teams: structuredClone(teams), items: structuredClone(items), resolution: { itemEvents: null, settlementSnapshot: { version: 1, itemsPolicy: 'beta_2025', itemWeaponsEnabled: true, capturedAt: '', owners: [{ rosterId: 'a', userId: 'ua' }, { rosterId: 'b', userId: 'ub' }], teams, items, coWhisperers: [], whisperer: null, config: { serumAwardHighScore: true, serumAwardOnBashMaul: true }, rules: { bashingThreshold: 60, maulingThreshold: 60, weaponAxeMargin: 20, weaponShieldThreshold: 100, weaponAmbushThreshold: 120 }, winnings: { policy: 'beta_2025', openingByRoster: { a: 5, b: 20 } }, itemMatchups: [{ matchupId: 'M', homeRosterId: 'a', awayRosterId: 'b', homeScore: 110, awayScore: 100, homeBaseScore: 110, awayBaseScore: 100, homeWeaponBonus: 0, awayWeaponBonus: 0 }] } } }
})
describe('atomic 2025 item settlement', () => {
  it('moves loot and awards one weapon from each unboosted score band', async () => {
    const receipt = await settleBetaItems('z', 4) as any
    expect(receipt.complete).toBe(true)
    expect(h.state.items.find((i: any) => i.id === 'gun')).toMatchObject({ teamStatusId: 'A', userId: 'ua', activatesAtWeek: 5 })
    expect(h.state.items.filter((i: any) => i.acquiredReason === 'score_band').map((i: any) => i.itemType)).toEqual(['weapon_bow', 'weapon_knife'])
    expect(h.state.items.filter((i: any) => i.acquiredReason === 'weekly_high_score')).toHaveLength(1)
  })
  it('retries a committed settlement without new items or repeated loot', async () => {
    await settleBetaItems('z', 4); const count = h.state.items.length
    await settleBetaItems('z', 4)
    expect(h.state.items).toHaveLength(count)
    expect(h.db.zombieTeamItem.updateMany).toHaveBeenCalledTimes(2)
  })
  it('rolls back prior loot if a later ownership check fails', async () => {
    h.state.items.find((i: any) => i.id === 'gun').teamStatusId = 'elsewhere'
    await expect(settleBetaItems('z', 4)).rejects.toThrow('LOOT_CHANGED')
    expect(h.state.items.find((i: any) => i.id === 's1').teamStatusId).toBe('B')
    expect(h.state.resolution.itemEvents).toBeNull()
    expect(h.state.items).toHaveLength(3)
  })
  it('refuses to apply new item rules to a historical snapshot', async () => {
    delete h.state.resolution.settlementSnapshot.itemsPolicy
    await expect(settleBetaItems('z', 4)).rejects.toThrow('MISSING_SNAPSHOT')
    expect(h.db.zombieTeamItem.updateMany).not.toHaveBeenCalled()
  })
  it('seals final score receipts and rejects a missing or mismatched receipt', () => {
    const input = { matchupId: 'M', homeRosterId: 'a', awayRosterId: 'b', homeScore: 120, awayScore: 100, lineupSnapshots: { zombieItems: { policy: 'beta_2025', homeBaseScore: 100, awayBaseScore: 100, home: { bonus: 20, weaponBonus: 10 }, away: { bonus: 0, weaponBonus: 0 } } } }
    expect(readBetaItemMatchup(input)).toMatchObject({ homeBaseScore: 100, homeWeaponBonus: 10 })
    expect(() => readBetaItemMatchup({ ...input, homeScore: 121 })).toThrow('MISMATCH')
    expect(() => readBetaItemMatchup({ ...input, lineupSnapshots: {} })).toThrow('MISSING')
  })
})
