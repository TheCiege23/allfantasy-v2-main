// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/zombie/zombieRules', () => ({ getZombieRulesForSport: vi.fn(async () => ({ bashingThreshold: 60, maulingThreshold: 60, weaponAxeMargin: 20, weaponShieldThreshold: 100, weaponAmbushThreshold: 120 })) }))
vi.mock('@/lib/zombie/ZombieInfectionEngine', () => ({ loadNativeWeekResults: vi.fn(async () => [{ matchupId: 'M', homeRosterId: 'a', awayRosterId: 'b', homeScore: 120, awayScore: 100, final: true }]) }))
import { captureZombieSettlementSnapshot } from '@/lib/zombie/weeklySettlementSnapshot'
function client() {
  return {
    zombieWeeklyWinnings: { findMany: vi.fn(async () => [{ rosterId: 'a', amount: 5, source: 'weekly_settlement_2025' }, { rosterId: 'b', amount: 20, source: 'weekly_settlement_2025' }]) },
    roster: { findMany: vi.fn(async () => [{ id: 'a', platformUserId: 'ua' }, { id: 'b', platformUserId: 'ub' }]) },
    zombieLeagueTeam: { findMany: vi.fn(async () => [{ id: 'A', rosterId: 'a', status: 'Survivor', revivedAt: null }, { id: 'B', rosterId: 'b', status: 'Zombie', revivedAt: null }]) },
    zombieTeamItem: { findMany: vi.fn(async () => []) }, whispererRecord: { findUnique: vi.fn(async () => null) }, zombieCoWhisperer: { findMany: vi.fn(async () => []) },
    zombieLeagueConfig: { findUnique: vi.fn(async () => null) }, zombieLeague: { findUnique: vi.fn(async () => ({ experienceMode: 'enhanced' })) },
    redraftMatchup: { findMany: vi.fn(async () => [{ id: 'M', lineupSnapshots: { zombieItems: { policy: 'beta_2025', homeBaseScore: 100, awayBaseScore: 100, home: { bonus: 20, weaponBonus: 10 }, away: { bonus: 0, weaponBonus: 0 } } } }]) },
  }
}
describe('2025 snapshot evidence on the inventory transaction', () => {
  it('captures original roles, balances, item policy and unboosted scores from the supplied transaction', async () => {
    const db = client()
    const snapshot = await captureZombieSettlementSnapshot('L', 'z', 'NFL', 4, 2026, db as any)
    expect(snapshot).toMatchObject({ itemsPolicy: 'beta_2025', winnings: { openingByRoster: { a: 5, b: 20 } }, itemMatchups: [{ homeScore: 120, homeBaseScore: 100, homeWeaponBonus: 10 }] })
    expect(db.zombieTeamItem.findMany).toHaveBeenCalledOnce()
  })
  it('holds legacy winnings before any new inventory side effects', async () => {
    const db = client(); db.zombieWeeklyWinnings.findMany.mockResolvedValueOnce([{ rosterId: 'a', amount: 5, source: 'weekly_settlement' }])
    await expect(captureZombieSettlementSnapshot('L', 'z', 'NFL', 4, 2026, db as any)).rejects.toThrow('POLICY_REVIEW_REQUIRED')
    expect(db.zombieTeamItem.findMany).not.toHaveBeenCalled()
  })
  it('does not seal a week without evidence of applied bonuses and base scores', async () => {
    const db = client(); db.redraftMatchup.findMany.mockResolvedValueOnce([])
    await expect(captureZombieSettlementSnapshot('L', 'z', 'NFL', 4, 2026, db as any)).rejects.toThrow('MISSING_SCORE_RECEIPT')
  })
})
