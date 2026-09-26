import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ db: {} as Record<string, unknown>, config: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: mocks.db }))
vi.mock('@/lib/salary-cap/SalaryCapLeagueConfig', () => ({ getSalaryCapConfig: mocks.config }))
import { applyCut } from '@/lib/salary-cap/DeadMoneyService'
import { applyExtension } from '@/lib/salary-cap/ExtensionService'
import { applyFranchiseTag } from '@/lib/salary-cap/FranchiseTagService'

const rules = { leagueId: 'L', configId: 'cfg', season: 2026, extensionsEnabled: true,
  contractMaxYears: 4, franchiseTagEnabled: true, deadMoneyEnabled: true, deadMoneyPercentPerYear: 50 }
const original = () => ({ id: 'contract', leagueId: 'L', configId: 'cfg', rosterId: 'a', playerId: 'p',
  playerName: 'Player', position: 'RB', salary: 20, yearSigned: 2026, yearsTotal: 1, contractYear: 1,
  status: 'active', deadMoneyRemaining: null, updatedAt: new Date('2026-01-01T00:00:00Z') })

function world() {
  const state = { contracts: [original()], events: [] as unknown[],
    rosters: [{ id: 'a', leagueId: 'L', platformUserId: 'owner', playerData: {} as Record<string, unknown> },
      { id: 'b', leagueId: 'L', platformUserId: 'other', playerData: {} as Record<string, unknown> }],
    teams: [] as Array<{ id: string; leagueId: string; externalId: string; platformUserId: string;
      claimedByUserId: string; role: string; isCommissioner: boolean }> }
  const db = {
    league: { findFirst: vi.fn(async ({ where }) => where.id === 'L' ? { userId: 'commissioner' } : null) },
    leagueTeam: {
      findFirst: vi.fn(async ({ where }) => state.teams.find(t => t.leagueId === where.leagueId
        && t.claimedByUserId === where.claimedByUserId && t.isCommissioner && t.role !== 'viewer') ?? null),
      findMany: vi.fn(async () => structuredClone(state.teams)),
    },
    roster: { findFirst: vi.fn(async ({ where }) => structuredClone(state.rosters.find(r => r.id === where.id && r.leagueId === where.leagueId) ?? null)) },
    playerContract: {
      findFirst: vi.fn(async ({ where }) => structuredClone(state.contracts.find(c => c.id === where.id
        && c.leagueId === where.leagueId && c.configId === where.configId && (!where.rosterId || c.rosterId === where.rosterId)) ?? null)),
      count: vi.fn(async () => state.contracts.filter(c => c.status === 'tagged').length),
      updateMany: vi.fn(async ({ where, data }) => {
        const contract = state.contracts.find(c => c.id === where.id && c.rosterId === where.rosterId
          && c.status === where.status && c.updatedAt.getTime() === where.updatedAt.getTime())
        if (!contract) return { count: 0 }
        Object.assign(contract, data)
        return { count: 1 }
      }),
      create: vi.fn(async ({ data }) => { state.contracts.push({ ...original(), ...data, id: 'extension' }); return data }),
    },
    salaryCapEventLog: { create: vi.fn(async ({ data }) => { state.events.push(data); return data }) },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>, _options?: unknown) => {
      const before = structuredClone(state)
      try { return await fn(db) } catch (error) { Object.assign(state, before); throw error }
    }),
  }
  Object.assign(mocks.db, db)
  return { db, state }
}
const actions = [
  ['cut', (actor: string) => applyCut('L', 'contract', 2026, actor)],
  ['extension', (actor: string) => applyExtension('L', 'contract', 2, 30, actor)],
  ['tag', (actor: string) => applyFranchiseTag('L', 'contract', actor)],
] as const

beforeEach(() => { vi.clearAllMocks(); mocks.config.mockResolvedValue(rules) })

describe('salary contract mutation ownership', () => {
  it.each(actions)('rejects another manager’s %s without writing', async (_name, action) => {
    const { db } = world()
    expect(await action('other')).toMatchObject({ ok: false, status: 403 })
    expect(db.playerContract.updateMany).not.toHaveBeenCalled()
    expect(db.playerContract.create).not.toHaveBeenCalled()
    expect(db.salaryCapEventLog.create).not.toHaveBeenCalled()
  })

  it.each(actions)('allows the native owner to %s', async (_name, action) => {
    const { db } = world()
    expect(await action('owner')).toEqual({ ok: true })
    expect(db.$transaction.mock.calls[0][1]).toEqual({ isolationLevel: 'Serializable', timeout: 20_000 })
    expect(db.playerContract.updateMany.mock.calls[0][0].where).toMatchObject({
      id: 'contract', leagueId: 'L', configId: 'cfg', rosterId: 'a', status: 'active', updatedAt: original().updatedAt,
    })
  })

  it.each(actions)('allows the league commissioner to %s', async (_name, action) => {
    world()
    expect(await action('commissioner')).toEqual({ ok: true })
  })

  it.each(actions)('rejects stale ownership after a trade before %s', async (_name, action) => {
    const { db, state } = world()
    state.contracts[0].rosterId = 'b'
    expect(await action('owner')).toMatchObject({ ok: false, status: 403 })
    expect(db.playerContract.updateMany).not.toHaveBeenCalled()
  })

  it.each(actions)('returns a conflict when the guarded %s write lost its version', async (_name, action) => {
    const { db } = world()
    db.playerContract.updateMany.mockResolvedValue({ count: 0 })
    expect(await action('owner')).toMatchObject({ ok: false, status: 409 })
    expect(db.playerContract.create).not.toHaveBeenCalled()
    expect(db.salaryCapEventLog.create).not.toHaveBeenCalled()
  })

  it('accepts a claimed provider owner through the roster’s durable source identity', async () => {
    const { state } = world()
    state.rosters[0].platformUserId = 'unresolved-platform-owner'
    state.rosters[0].playerData.source_manager_id = 'platform-owner'
    state.teams.push({ id: 'team', leagueId: 'L', externalId: '1', platformUserId: 'platform-owner',
      claimedByUserId: 'claimant', role: 'member', isCommissioner: false })
    expect(await applyCut('L', 'contract', 2026, 'claimant')).toEqual({ ok: true })
  })

  it('rejects a viewer claim even when its provider identity matches', async () => {
    const { state } = world()
    state.rosters[0].platformUserId = 'platform-owner'
    state.rosters[0].playerData.source_manager_id = 'platform-owner'
    state.teams.push({ id: 'team', leagueId: 'L', externalId: '1', platformUserId: 'platform-owner',
      claimedByUserId: 'viewer', role: 'viewer', isCommissioner: false })
    expect(await applyCut('L', 'contract', 2026, 'viewer')).toMatchObject({ ok: false, status: 403 })
  })

  it('does not authorize a provider claim in another league', async () => {
    const { state } = world()
    state.rosters[0].platformUserId = 'platform-owner'
    state.rosters[0].playerData.source_manager_id = 'platform-owner'
    state.teams.push({ id: 'a', leagueId: 'elsewhere', externalId: 'a', platformUserId: 'platform-owner',
      claimedByUserId: 'claimant', role: 'member', isCommissioner: false })
    expect(await applyCut('L', 'contract', 2026, 'claimant')).toMatchObject({ ok: false, status: 403 })
  })

  it('keeps an active contract when creating its extension fails', async () => {
    const { db, state } = world()
    db.playerContract.create.mockRejectedValue(new Error('insert failed'))
    await expect(applyExtension('L', 'contract', 2, 30, 'owner')).rejects.toThrow('insert failed')
    expect(state.contracts).toEqual([original()])
  })

  it('rolls back a cut if its event cannot be recorded', async () => {
    const { db, state } = world()
    db.salaryCapEventLog.create.mockRejectedValue(new Error('event failed'))
    await expect(applyCut('L', 'contract', 2026, 'owner')).rejects.toThrow('event failed')
    expect(state.contracts).toEqual([original()])
  })

  it.each([NaN, Infinity, 1.5])('rejects invalid extension years %s without expiring the original', async newYears => {
    const { db } = world()
    expect(await applyExtension('L', 'contract', newYears, 30, 'owner')).toMatchObject({ ok: false, status: 400 })
    expect(db.playerContract.updateMany).not.toHaveBeenCalled()
  })

  it.each([NaN, Infinity, 30.5])('rejects invalid extension salary %s', async newSalary => {
    const { db } = world()
    expect(await applyExtension('L', 'contract', 2, newSalary, 'owner')).toMatchObject({ ok: false, status: 400 })
    expect(db.playerContract.updateMany).not.toHaveBeenCalled()
  })

  it('prevents backdating dead money into a different season', async () => {
    const { db } = world()
    expect(await applyCut('L', 'contract', 2020, 'owner')).toMatchObject({ ok: false, status: 400 })
    expect(db.playerContract.updateMany).not.toHaveBeenCalled()
  })
})
