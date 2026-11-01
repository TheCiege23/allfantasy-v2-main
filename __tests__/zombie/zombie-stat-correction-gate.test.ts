// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/zombie/ZombieInfectionEngine', () => ({ loadNativeWeekResults: vi.fn() }))
vi.mock('@/lib/zombie/weeklyWinningsEngine', () => ({ computeWeeklyWinnings: vi.fn() }))
vi.mock('@/lib/zombie/zombieRules', () => ({ getZombieRulesForSport: vi.fn() }))

import { scoreOnlyCorrectionIsSafe } from '@/lib/zombie/statCorrectionReconciler'

const rules = {
  sport: 'NFL', bashingThreshold: 30, maulingThreshold: 50,
  weaponShieldThreshold: 100, weaponAmbushThreshold: 120,
  weaponAxeMargin: 20, reviveThreshold: 3, serumMaxHold: 5, lineupLockDesc: null,
}
const oldRows = [
  { homeUserId: 'a', awayUserId: 'b', homeScore: 90, awayScore: 85 },
  { homeUserId: 'c', awayUserId: 'd', homeScore: 80, awayScore: 75 },
]
const current = [
  { id: 'm1', homeRosterId: 'a', awayRosterId: 'b', homeScore: 91, awayScore: 85 },
  { id: 'm2', homeRosterId: 'c', awayRosterId: 'd', homeScore: 80, awayScore: 75 },
]

describe('Zombie score-only correction gate', () => {
  it('accepts changed scores that preserve every role, combat, and item award decision', () => {
    expect(scoreOnlyCorrectionIsSafe(oldRows, current, rules)).toBe(true)
  })

  it('requires full reconciliation when a matchup winner changes', () => {
    expect(scoreOnlyCorrectionIsSafe(oldRows, [{ ...current[0], homeScore: 84 }, current[1]], rules)).toBe(false)
  })

  it('requires full reconciliation when a combat or weapon threshold changes', () => {
    expect(scoreOnlyCorrectionIsSafe(oldRows, [{ ...current[0], homeScore: 111 }, current[1]], rules)).toBe(false)
    expect(scoreOnlyCorrectionIsSafe(oldRows, [{ ...current[0], homeScore: 101, awayScore: 96 }, current[1]], rules)).toBe(false)
  })

  it('requires full reconciliation when the serum high scorer changes', () => {
    expect(scoreOnlyCorrectionIsSafe(oldRows, [{ ...current[0], homeScore: 89 }, { ...current[1], homeScore: 95 }], rules)).toBe(false)
  })
})
