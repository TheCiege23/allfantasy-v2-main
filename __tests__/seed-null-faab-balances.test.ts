import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  league: { findUnique: vi.fn() },
  leagueWaiverSettings: { findUnique: vi.fn(), upsert: vi.fn() },
  roster: { updateMany: vi.fn() },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

const { seedNullFaabBalances, upsertLeagueWaiverSettings } = await import('@/lib/waiver-wire/settings-service')

const LEAGUE = { id: 'L1', sport: 'NBA', leagueVariant: 'guillotine', settings: {} }

describe('FAAB balances are seeded when a league runs FAAB', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    db.league.findUnique.mockResolvedValue(LEAGUE)
    db.roster.updateMany.mockResolvedValue({ count: 16 })
  })

  it('gives every team with no balance the league budget, and only those teams', async () => {
    db.leagueWaiverSettings.findUnique.mockResolvedValue({ waiverType: 'faab', faabBudget: 1000 })
    expect(await seedNullFaabBalances('L1')).toEqual({ seeded: 16, budget: 1000 })
    expect(db.roster.updateMany).toHaveBeenCalledWith({
      where: { leagueId: 'L1', faabRemaining: null },
      data: { faabRemaining: 1000 },
    })
  })

  it('does nothing for a non-FAAB league or a FAAB league with no budget', async () => {
    for (const row of [
      { waiverType: 'rolling', faabBudget: 1000 },
      { waiverType: 'faab', faabBudget: null },
      { waiverType: 'faab', faabBudget: 0 },
    ]) {
      db.leagueWaiverSettings.findUnique.mockResolvedValueOnce(row)
      expect((await seedNullFaabBalances('L1')).seeded).toBe(0)
    }
    expect(db.roster.updateMany).not.toHaveBeenCalled()
  })

  it('saving waiver settings as FAAB seeds the balances (the commissioner path)', async () => {
    db.leagueWaiverSettings.findUnique.mockResolvedValueOnce({ waiverType: 'rolling', faabBudget: null })
    db.leagueWaiverSettings.upsert.mockResolvedValue({ waiverType: 'faab', faabBudget: 500 })
    db.leagueWaiverSettings.findUnique.mockResolvedValueOnce({ waiverType: 'faab', faabBudget: 500 })
    await upsertLeagueWaiverSettings('L1', { waiverType: 'faab', faabBudget: 500 })
    expect(db.roster.updateMany).toHaveBeenCalledWith({
      where: { leagueId: 'L1', faabRemaining: null },
      data: { faabRemaining: 500 },
    })
  })

  it('a seed failure does not fail the settings save', async () => {
    db.leagueWaiverSettings.findUnique.mockResolvedValueOnce(null)
    db.leagueWaiverSettings.upsert.mockResolvedValue({ waiverType: 'faab', faabBudget: 500 })
    db.leagueWaiverSettings.findUnique.mockResolvedValueOnce({ waiverType: 'faab', faabBudget: 500 })
    db.roster.updateMany.mockRejectedValueOnce(new Error('db down'))
    await expect(upsertLeagueWaiverSettings('L1', { waiverType: 'faab', faabBudget: 500 })).resolves.toMatchObject({ faabBudget: 500 })
  })
})
