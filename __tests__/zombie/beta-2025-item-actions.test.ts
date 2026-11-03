// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
const h = vi.hoisted(() => ({
  z: { id: 'z', leagueId: 'L', sport: 'NFL', season: 2026, status: 'active', currentWeek: 4, experienceMode: 'enhanced' },
  team: {} as any, opponent: 'Zombie', players: [] as any[], starts: new Map<string, Date>(), logs: new Map<string, any>(),
  score: vi.fn(), updates: vi.fn(), tx: null as any,
}))
vi.mock('@/lib/redraft/lineupLock', () => ({ buildWeekKickoffMap: vi.fn(async () => ({ byTeam: h.starts })), lockTeamLookupKeys: (_: string, team: string) => [team] }))
vi.mock('@/lib/redraft/lineupLockCurrentTeam', () => ({ resolveCurrentLockTeams: vi.fn(async () => new Map()) }))
vi.mock('@/lib/redraft/weekLineupSlots', () => ({ loadWeekLineups: vi.fn(async () => new Map()), weekSlotType: (p: any) => p.slotType }))
vi.mock('@/lib/redraft/scoringEngine', () => ({ updateMatchupScores: h.score }))
vi.mock('@/lib/prisma', () => {
  const db = {
    $queryRaw: vi.fn(async () => []),
    zombieLeague: { findUnique: vi.fn(async () => h.z) },
    zombieWeeklyResolution: { findUnique: vi.fn(async () => null) },
    redraftSeason: { findFirst: vi.fn(async () => ({ id: 'season' })) },
    redraftRoster: { findFirst: vi.fn(async () => ({ id: 'RR' })), findUnique: vi.fn(async () => ({ ownerId: 'other' })) },
    redraftRosterPlayer: { findMany: vi.fn(async () => h.players) },
    redraftMatchup: { findFirst: vi.fn(async () => ({ id: 'M', homeRosterId: 'RR', awayRosterId: 'OTHER', status: 'active' })), findMany: vi.fn(async () => [{ id: 'M' }]) },
    roster: { findFirst: vi.fn(async (a: any) => ({ id: a.where.OR ? 'opponent' : 'R' })) },
    zombieLeagueTeam: { findUnique: vi.fn(async (a: any) => a.where.leagueId_rosterId?.rosterId === 'opponent' ? { status: h.opponent } : h.team) },
    zombieTeamItem: { updateMany: vi.fn(async (a: any) => {
      h.updates(a)
      const held = h.team.items.filter((i: any) => a.where.id.in.includes(i.id) && !i.isUsed && !i.isExpired)
      held.forEach((i: any) => Object.assign(i, a.data)); return { count: held.length }
    }) },
    zombieChimmyAction: {
      create: vi.fn(async (a: any) => { const row = { id: `log-${h.logs.size}`, ...a.data, resolvedAt: null }; h.logs.set(row.id, row); return { ...row } }),
      upsert: vi.fn(async (a: any) => { if (!h.logs.has(a.where.id)) h.logs.set(a.where.id, { ...a.create, resolvedAt: null }); return { ...h.logs.get(a.where.id) } }),
      findUniqueOrThrow: vi.fn(async (a: any) => ({ ...h.logs.get(a.where.id) })),
      update: vi.fn(async (a: any) => { Object.assign(h.logs.get(a.where.id), a.data); return { ...h.logs.get(a.where.id) } }),
    },
    $transaction: vi.fn(async (run: any) => {
      const items = structuredClone(h.team.items), logs = structuredClone(h.logs)
      try { return await run(db) } catch (e) { h.team.items = items; h.logs = logs; throw e }
    }),
  }
  h.tx = db
  return { prisma: db }
})
import { assertLastStarterWindow, processBetaItemUse, loadBetaItemScoreReceipt } from '@/lib/zombie/beta2025ItemService'
import { reviveBetaTeamInTransaction } from '@/lib/zombie/beta2025ItemSettlement'
const serum = (id: string) => ({ id, teamStatusId: 'T', itemType: 'serum', isUsed: false, isExpired: false, activationState: 'ready' })
beforeEach(() => {
  vi.clearAllMocks(); h.logs.clear(); h.opponent = 'Zombie'
  h.team = { id: 'T', status: 'Survivor', items: [serum('s1'), serum('s2'), serum('s3')] }
  h.players = [{ playerId: 'early', team: 'EARLY', slotType: 'WR' }, { playerId: 'late', team: 'LATE', slotType: 'FLEX' }]
  h.starts = new Map([['EARLY', new Date(Date.now() - 60_000)], ['LATE', new Date(Date.now() + 60_000)]])
})
describe('2025 item action transaction', () => {
  it('uses multiple serums after early games started and refreshes real scoring', async () => {
    const result = await processBetaItemUse('L', 'u', '@Chimmy use 2 serums', 4, 'serum')
    expect(result.isValid).toBe(true); expect(h.team.items.filter((i: any) => i.isUsed)).toHaveLength(2)
    expect(result.effect).toMatchObject({ bonus: 20 }); expect(h.score).toHaveBeenCalledWith('M')
  })
  it('allows a Whisperer against a Zombie', async () => { h.team.status = 'Whisperer'; expect((await processBetaItemUse('L', 'u', 'use serum', 4, 'serum')).isValid).toBe(true) })
  it.each(['Survivor', 'Whisperer'])('rejects serums against a %s without spending', async role => {
    h.opponent = role; expect((await processBetaItemUse('L', 'u', 'use serum', 4, 'serum')).isValid).toBe(false); expect(h.updates).not.toHaveBeenCalled()
  })
  it('rejects Zombie use', async () => { h.team.status = 'Zombie'; expect((await processBetaItemUse('L', 'u', 'use serum', 4, 'serum')).isValid).toBe(false); expect(h.updates).not.toHaveBeenCalled() })
  it('refuses an unaffordable quantity atomically', async () => { expect((await processBetaItemUse('L', 'u', 'use 4 serums', 4, 'serum')).isValid).toBe(false); expect(h.team.items.every((i: any) => !i.isUsed)).toBe(true) })
  it('a repeated request id debits once', async () => {
    const id = '11111111-1111-1111-1111-111111111111'
    const first = await processBetaItemUse('L', 'u', 'use serum', 4, 'serum', id)
    const second = await processBetaItemUse('L', 'u', 'use serum', 4, 'serum', id)
    expect(second.id).toBe(first.id); expect(h.updates).toHaveBeenCalledTimes(1)
  })
  it('a score-refresh failure reports saved consumption without inviting a second debit', async () => {
    h.score.mockRejectedValueOnce(new Error('worker unavailable'))
    const result = await processBetaItemUse('L', 'u', 'use serum', 4, 'serum')
    expect(result.isValid).toBe(true); expect(result.privateResponse).toContain('Do not submit it again'); expect(h.updates).toHaveBeenCalledOnce()
  })
  it('spends a bomb once and rejects a second bomb in the same week', async () => {
    h.team.items = ['b1', 'b2'].map(id => ({ ...serum(id), itemType: 'weapon_bomb' }))
    expect((await processBetaItemUse('L', 'u', 'use bomb', 4, 'bomb')).isValid).toBe(true)
    expect((await processBetaItemUse('L', 'u', 'use bomb', 4, 'bomb')).isValid).toBe(false)
    expect(h.updates).toHaveBeenCalledTimes(1)
  })
})
describe('last-starter timing', () => {
  it('locks at the exact last starter kickoff', async () => { h.starts.set('LATE', new Date(Date.now())); await expect(assertLastStarterWindow(h.tx, { leagueId: 'L', userId: 'u', week: 4 })).rejects.toThrow('last starter') })
  it('a bench player cannot extend the window', async () => { h.players[1].slotType = 'BENCH'; await expect(assertLastStarterWindow(h.tx, { leagueId: 'L', userId: 'u', week: 4 })).rejects.toThrow('last starter') })
  it('a bye cannot extend the window', async () => { h.players[1].byeWeek = 4; await expect(assertLastStarterWindow(h.tx, { leagueId: 'L', userId: 'u', week: 4 })).rejects.toThrow('last starter') })
  it('unknown schedule data holds the action', async () => { h.starts.delete('LATE'); await expect(assertLastStarterWindow(h.tx, { leagueId: 'L', userId: 'u', week: 4 })).rejects.toThrow('unavailable') })
  it('client-selected old weeks cannot reopen the window', async () => { await expect(assertLastStarterWindow(h.tx, { leagueId: 'L', userId: 'u', week: 3 })).rejects.toThrow('active') })
})
describe('mandatory revival', () => {
  it('does not revive in the week of infection', async () => { h.team.status = 'Zombie'; h.team.weekBecameZombie = 4; expect(await reviveBetaTeamInTransaction(h.tx, 'T', 4)).toBe(false); expect(h.updates).not.toHaveBeenCalled() })
  it('requires two available serums', async () => { h.team.status = 'Zombie'; h.team.items = [serum('s')]; expect(await reviveBetaTeamInTransaction(h.tx, 'T', 4)).toBe(false) })
  it('spends exactly two and restores Survivor status', async () => {
    h.team.status = 'Zombie'; h.team.weekBecameZombie = 3
    const update = vi.fn(async () => ({ count: 1 })); const audit = vi.fn(async () => ({}))
    const tx = { ...h.tx, zombieLeagueTeam: { ...h.tx.zombieLeagueTeam, updateMany: update }, zombieAuditLog: { create: audit } }
    expect(await reviveBetaTeamInTransaction(tx as any, 'T', 4)).toBe(true)
    expect(h.team.items.filter((i: any) => i.isUsed)).toHaveLength(2); expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'Survivor' }) })); expect(audit).toHaveBeenCalledOnce()
  })
})

describe('item score freezing across trades and historical weeks', () => {
  function scoreContext() {
    h.tx.roster.findMany = vi.fn(async () => [{ id: 'R', redraftRosterId: 'RR', platformUserId: 'u' }, { id: 'opp', redraftRosterId: 'OTHER', platformUserId: 'other' }])
    h.tx.redraftRoster.findMany = vi.fn(async () => [{ id: 'RR', ownerId: 'u' }, { id: 'OTHER', ownerId: 'other' }])
    h.tx.zombieLeagueTeam.findMany = vi.fn(async () => [{ ...h.team, rosterId: 'R' }, { id: 'OPP', rosterId: 'opp', status: 'Zombie', items: [] }])
    h.tx.zombieWeeklyResolution.findUnique.mockResolvedValue(null)
    return { leagueId: 'L', week: 4, season: 2026, homeRosterId: 'RR', awayRosterId: 'OTHER', previousSnapshots: null as any }
  }
  it('keeps the bonus already played after a weapon changes owner', async () => {
    const input = scoreContext(); h.starts.set('LATE', new Date(Date.now() - 1000))
    const saved = { policy: 'beta_2025', home: { rosterId: 'R', role: 'Survivor', frozen: true, weaponIds: ['traded-gun'], serumIds: [], bombId: null, weaponBonus: 10, serumBonus: 0, bonus: 10 }, away: { rosterId: 'opp', role: 'Zombie', frozen: true, weaponIds: [], serumIds: [], bombId: null, weaponBonus: 0, serumBonus: 0, bonus: 0 } }
    input.previousSnapshots = { zombieItems: saved }
    expect(await loadBetaItemScoreReceipt(input, h.tx)).toEqual(saved)
  })
  it('ordinary inventory changes before the deadline update the score', async () => {
    const input = scoreContext(); h.team.items.push({ id: 'gun', teamStatusId: 'T', itemType: 'weapon_gun', isUsed: false, isExpired: false, activationState: 'ready' })
    expect(await loadBetaItemScoreReceipt(input, h.tx)).toMatchObject({ home: { weaponBonus: 10, frozen: false } })
  })
  it('never converts a settled historical shield week into the new policy', async () => {
    const input = scoreContext(); h.tx.zombieWeeklyResolution.findUnique.mockResolvedValueOnce({ status: 'complete', settlementSnapshot: { version: 1 } })
    expect(await loadBetaItemScoreReceipt(input, h.tx)).toBeNull()
  })
})
