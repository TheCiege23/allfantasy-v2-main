/**
 * A FAAB budget change reaches what teams can bid (lib/waiver-wire/faabBudgetRebase.ts, 2026-11-15).
 *
 * 🛑 Balances were seeded once and never moved again, so raising the budget from $100 to $200 showed $200 in settings
 * while every team still had $100 to spend. The change now moves each seeded balance by the same amount, keeping
 * what a team already spent spent, through the one save every budget editor uses.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  league: { findUnique: vi.fn() },
  leagueWaiverSettings: { findUnique: vi.fn(), upsert: vi.fn() },
  roster: { findMany: vi.fn(), updateMany: vi.fn() },
  redraftRoster: { updateMany: vi.fn(), findMany: vi.fn() },
  $transaction: vi.fn(async (ops: unknown[]) => Promise.all(ops)),
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

const { rebasedFaabBalance, rebaseFaabBalancesForBudgetChange, faabBudgetRebaseApplies } = await import('@/lib/waiver-wire/faabBudgetRebase')
const { upsertLeagueWaiverSettings } = await import('@/lib/waiver-wire/settings-service')

beforeEach(() => {
  vi.clearAllMocks()
  db.roster.updateMany.mockResolvedValue({ count: 0 })
  db.redraftRoster.updateMany.mockResolvedValue({ count: 0 })
})

describe('the new balance', () => {
  it('keeps what was spent, and never goes below $0', () => {
    expect(rebasedFaabBalance(63, 100, 200)).toBe(163)
    expect(rebasedFaabBalance(63, 100, 50)).toBe(13)
    expect(rebasedFaabBalance(20, 100, 50)).toBe(0)
    expect(rebasedFaabBalance(null, 100, 200)).toBeNull() // unseeded: the seed gives it the budget
    expect(rebasedFaabBalance(40, null, 200)).toBe(40) // no known old budget: nothing to measure from
  })
})

describe('moving the league\'s balances', () => {
  it('moves every seeded team by the difference, clamps at $0, and mirrors the season balance', async () => {
    db.roster.findMany
      .mockResolvedValueOnce([{ id: 'r1' }, { id: 'r2' }]) // seeded teams
      .mockResolvedValueOnce([{ id: 'r1', faabRemaining: 163, redraftRosterId: 'rr1' }, { id: 'r2', faabRemaining: 200, redraftRosterId: 'rr2' }])
    expect(await rebaseFaabBalancesForBudgetChange('L1', 100, 200)).toEqual({ rebased: 2, delta: 100 })
    expect(db.roster.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['r1', 'r2'] } }, data: { faabRemaining: { increment: 100 } } })
    expect(db.roster.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['r1', 'r2'] }, faabRemaining: { lt: 0 } }, data: { faabRemaining: 0 } })
    expect(db.redraftRoster.updateMany).toHaveBeenCalledWith({ where: { id: 'rr1' }, data: { faabBalance: 163 } })
  })

  it('an unchanged budget touches nothing', async () => {
    expect(await rebaseFaabBalancesForBudgetChange('L1', 100, 100)).toEqual({ rebased: 0, delta: 0 })
    expect(db.roster.findMany).not.toHaveBeenCalled()
  })

  it('applies to leagues AllFantasy runs, not imported or survivor guillotine ones', () => {
    expect(faabBudgetRebaseApplies({ platform: 'allfantasy', platformLeagueId: null })).toBe(true)
    expect(faabBudgetRebaseApplies({ platform: null, platformLeagueId: null })).toBe(true)
    expect(faabBudgetRebaseApplies({ platform: 'sleeper', platformLeagueId: '123' })).toBe(false)
    expect(faabBudgetRebaseApplies({ platform: 'allfantasy', leagueVariant: 'survivor_guillotine' })).toBe(false)
  })
})

describe('saving waiver settings (every budget editor saves through here)', () => {
  it('a budget change moves the balances from the budget that was in force', async () => {
    db.league.findUnique.mockResolvedValue({ sport: 'NFL', leagueVariant: null, platform: 'allfantasy', platformLeagueId: null })
    db.leagueWaiverSettings.findUnique.mockResolvedValue({ waiverType: 'faab', faabBudget: 100 })
    db.leagueWaiverSettings.upsert.mockResolvedValue({ waiverType: 'faab', faabBudget: 200 })
    db.roster.findMany.mockResolvedValue([])
    await upsertLeagueWaiverSettings('L1', { faabBudget: 200 })
    expect(db.roster.findMany).toHaveBeenCalledWith({ where: { leagueId: 'L1', faabRemaining: { not: null } }, select: { id: true } })
  })

  it('an imported league\'s balances are left to its platform sync', async () => {
    db.league.findUnique.mockResolvedValue({ sport: 'NFL', leagueVariant: null, platform: 'sleeper', platformLeagueId: '99' })
    db.leagueWaiverSettings.findUnique.mockResolvedValue({ waiverType: 'faab', faabBudget: 100 })
    db.leagueWaiverSettings.upsert.mockResolvedValue({})
    await upsertLeagueWaiverSettings('L1', { faabBudget: 200 })
    expect(db.roster.findMany).not.toHaveBeenCalledWith(expect.objectContaining({ where: { leagueId: 'L1', faabRemaining: { not: null } } }))
  })
})
