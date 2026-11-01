import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Two zombie rules that existed in config and were never in force.
 *
 * 1. 🛑 `zombieTradeBlocked` — "Zombies cannot trade"; Whisperers never trade. It lived in the zombie spec's `rosterGuard`, which
 *    no trade path consults and which is looked up by `leagueVariant` (null on every native zombie
 *    league). It is now enforced in `assertRosterTransactionsAllowed`, the gate trade create, accept and
 *    processing all pass through.
 * 2. 🛑 Bash/maul margins fell back to 30/50 — NFL numbers — for every sport, because the rules-template
 *    table is filled only by a seed nothing runs. An NBA week bashed on nearly every win.
 */

const db = vi.hoisted(() => ({
  zombieLeagueConfig: { findUnique: vi.fn() },
  zombieLeagueTeam: { findMany: vi.fn() },
  zombieRulesTemplate: { findUnique: vi.fn() },
  league: { findUnique: vi.fn() },
  survivorGuillotineLeague: { findUnique: vi.fn() },
  roster: { findFirst: vi.fn() },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/league/commissioner-roster-lock', () => ({ isCommissionerRosterLocked: vi.fn(async () => false) }))
vi.mock('@/server/services/permissionService', () => ({ isElevatedCommissioner: vi.fn(async () => false) }))
vi.mock('@/lib/roster-legality/loadLegalityEvaluationContext', () => ({
  evaluateLegalityForPersistedRoster: vi.fn(async () => null),
}))

import { assertRosterTransactionsAllowed } from '@/lib/roster-legality/rosterTransactionGates'
import { getZombieRulesForSport } from '@/lib/zombie/zombieRules'
import { getSpecialtySpecByVariant } from '@/lib/specialty-league/registry'

const league = { id: 'L1', settings: {} }

beforeEach(() => {
  vi.clearAllMocks()
  db.zombieLeagueConfig.findUnique.mockResolvedValue({ zombieTradeBlocked: true })
  db.zombieLeagueTeam.findMany.mockResolvedValue([])
  db.zombieRulesTemplate.findUnique.mockResolvedValue(null)
  db.survivorGuillotineLeague.findUnique.mockResolvedValue(null)
})

describe('zombie trade block', () => {
  it('refuses a trade when either side is a Zombie', async () => {
    db.zombieLeagueTeam.findMany.mockResolvedValue([{ status: 'Survivor' }, { status: 'Zombie' }])
    const result = await assertRosterTransactionsAllowed({
      leagueId: 'L1', league, rosterIds: ['a', 'b'], userId: 'u', kind: 'trade',
    })
    expect(result).toEqual({
      ok: false,
      error: 'Zombies cannot trade in this league.',
      code: 'ZOMBIE_TRADE_BLOCKED',
    })
    expect(db.zombieLeagueTeam.findMany).toHaveBeenCalledWith({
      where: { leagueId: 'L1', rosterId: { in: ['a', 'b'] } },
      select: { status: true },
    })
  })

  it('allows a Whisperer and Survivor to trade under the 2025 rules', async () => {
    db.zombieLeagueTeam.findMany.mockResolvedValue([{ status: 'Survivor' }, { status: 'Whisperer' }])
    await expect(assertRosterTransactionsAllowed({ leagueId: 'L1', league, rosterIds: ['a','b'], userId: 'u', kind: 'trade' }))
      .resolves.toEqual({ ok: true })
  })

  it('lets two Humans trade', async () => {
    db.zombieLeagueTeam.findMany.mockResolvedValue([{ status: 'Survivor' }, { status: 'Survivor' }])
    await expect(
      assertRosterTransactionsAllowed({ leagueId: 'L1', league, rosterIds: ['a', 'b'], userId: 'u', kind: 'trade' }),
    ).resolves.toEqual({ ok: true })
  })

  it('blocks a Zombie even when an old saved setting allowed trades', async () => {
    db.zombieLeagueConfig.findUnique.mockResolvedValue({ zombieTradeBlocked: false })
    db.zombieLeagueTeam.findMany.mockResolvedValue([{ status: 'Zombie' }])
    await expect(
      assertRosterTransactionsAllowed({ leagueId: 'L1', league, rosterIds: ['a', 'b'], userId: 'u', kind: 'trade' }),
    ).resolves.toMatchObject({ ok: false, code: 'ZOMBIE_TRADE_BLOCKED' })
  })

  it('does not touch waiver claims — Zombies keep claiming players', async () => {
    db.zombieLeagueTeam.findMany.mockResolvedValue([{ status: 'Zombie' }])
    await expect(
      assertRosterTransactionsAllowed({ leagueId: 'L1', league, rosterIds: ['a'], userId: 'u', kind: 'waiver_claim' }),
    ).resolves.toEqual({ ok: true })
    expect(db.zombieLeagueTeam.findMany).not.toHaveBeenCalled()
  })

  it('does not load a config when no Zombie team is involved', async () => {
    db.zombieLeagueTeam.findMany.mockResolvedValue([])
    await expect(
      assertRosterTransactionsAllowed({ leagueId: 'L1', league, rosterIds: ['a', 'b'], userId: 'u', kind: 'trade' }),
    ).resolves.toEqual({ ok: true })
    expect(db.zombieLeagueConfig.findUnique).not.toHaveBeenCalled()
  })

  it('the zombie spec carries no roster guard, so Zombies are never locked out of lineups', () => {
    const spec = getSpecialtySpecByVariant('zombie')
    expect(spec?.id).toBe('zombie')
    expect(spec?.rosterGuard).toBeUndefined()
  })
})

describe('bash/maul thresholds fall back to the sport, not to NFL', () => {
  it('NBA uses its own 128/211 margins when no rules-template row exists', async () => {
    // Calibrated to NFL's bash/maul rates (52% / 29% of wins); 45/70 fired on 82% / 73% of NBA wins.
    const r = await getZombieRulesForSport('NBA')
    expect([r.bashingThreshold, r.maulingThreshold]).toEqual([128, 211])
  })

  it('NFL uses the 2025 60-point combat thresholds', async () => {
    const r = await getZombieRulesForSport('NFL')
    expect([r.bashingThreshold, r.maulingThreshold]).toEqual([60, 60])
  })

  it('[control] a seeded rules-template row still wins', async () => {
    db.zombieRulesTemplate.findUnique.mockResolvedValue({ bashingThreshold: 80, maulingThreshold: 130 })
    const r = await getZombieRulesForSport('NBA')
    expect([r.bashingThreshold, r.maulingThreshold]).toEqual([80, 130])
  })
})

/*
 * 🛑 Weapons were NFL lines for every sport: a Knife at 100, a Bow at 120, an Axe for a 20-point win.
 * An NBA zombie team scores ~1,200 a week, so every NBA team held a Knife and a Bow every week.
 */
describe('weapon thresholds fall back to the sport, not to NFL', () => {
  it('NBA: Knife 900, Bow 1,050, Axe for a win by 90', async () => {
    const r = await getZombieRulesForSport('NBA')
    expect([r.weaponShieldThreshold, r.weaponAmbushThreshold, r.weaponAxeMargin]).toEqual([900, 1050, 90])
  })

  it('[control] NFL keeps 100 / 120 / 20', async () => {
    const r = await getZombieRulesForSport('NFL')
    expect([r.weaponShieldThreshold, r.weaponAmbushThreshold, r.weaponAxeMargin]).toEqual([100, 120, 20])
  })

  it('[control] a sport with no calibration of its own keeps the defaults rather than borrowing NBA', async () => {
    const r = await getZombieRulesForSport('NHL')
    expect([r.weaponShieldThreshold, r.weaponAmbushThreshold, r.weaponAxeMargin]).toEqual([100, 120, 20])
  })

  it('a seeded rules-template row still wins for the score lines', async () => {
    db.zombieRulesTemplate.findUnique.mockResolvedValue({ weaponShieldThreshold: 800, weaponAmbushThreshold: 1000 })
    const r = await getZombieRulesForSport('NBA')
    expect([r.weaponShieldThreshold, r.weaponAmbushThreshold, r.weaponAxeMargin]).toEqual([800, 1000, 90])
  })
})
