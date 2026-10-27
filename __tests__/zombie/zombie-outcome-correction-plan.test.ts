// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { planZombieOutcomeReplay } from '@/lib/zombie/outcomeCorrectionPlanner'
import type { ZombieSettlementSnapshotV1 } from '@/lib/zombie/weeklySettlementSnapshot'

const base: ZombieSettlementSnapshotV1 = {
  version: 1, capturedAt: '2026-10-27T00:00:00.000Z',
  owners: [
    { rosterId: 'horde', userId: 'z' },
    { rosterId: 'human', userId: 'h' },
  ],
  teams: [
    {
      id: 'tz', rosterId: 'horde', status: 'Zombie', weekBecameZombie: 1,
      killedByRosterId: null, revivedAt: null, ambushesRemaining: 0,
      ambushesUsed: 0, infectionCount: 0, isWhisperer: false,
      killedAtWeek: null, killedByUserId: null, survivorWinStreak: 0,
      zombieAttacksSurvived: 0,
    },
    {
      id: 'th', rosterId: 'human', status: 'Survivor', weekBecameZombie: null,
      killedByRosterId: null, revivedAt: null, ambushesRemaining: 0,
      ambushesUsed: 0, infectionCount: 0, isWhisperer: false,
      killedAtWeek: null, killedByUserId: null, survivorWinStreak: 0,
      zombieAttacksSurvived: 0,
    },
  ],
  items: [],
  whisperer: null,
  coWhisperers: [],
  config: {
    infectionLossToWhisperer: true, infectionLossToZombie: true,
    serumAwardHighScore: true, serumAwardOnBashMaul: true,
    autoSerumRevive: false, serumReviveCount: 2,
  },
  rules: {
    bashingThreshold: 30, maulingThreshold: 50, weaponAxeMargin: 20,
    weaponShieldThreshold: 100, weaponAmbushThreshold: 120,
  },
}
const row = (homeScore: number, awayScore: number) => [{
  matchupId: 'm', homeRosterId: 'horde', awayRosterId: 'human',
  homeScore, awayScore,
}]

describe('snapshot-based outcome correction plan', () => {
  it('reverses a prior win and plans a new infection and awards', () => {
    const plan = planZombieOutcomeReplay(row(101, 90), base, 3, 'enhanced')
    expect(plan?.infections).toEqual([expect.objectContaining({
      victimRosterId: 'human', infectorRosterId: 'horde', matchupId: 'm',
    })])
    expect(plan?.statusByRoster.get('human')).toBe('Zombie')
    expect(plan?.serumAwards).toEqual([{ rosterId: 'horde', reason: 'weekly_high_score' }])
    expect(plan?.weaponAwards).toContainEqual({
      rosterId: 'horde', itemType: 'weapon_knife', label: '🔪 Knife',
    })
    expect(planZombieOutcomeReplay(row(90, 101), base, 3, 'enhanced')?.infections).toEqual([])
  })

  it('consumes a pre-armed serum only when it blocks a threat', () => {
    const snapshot = {
      ...base,
      items: [{
        id: 's', teamStatusId: 'th', userId: 'h', itemType: 'serum',
        itemLabel: '🧪 Serum', isUsed: false, isExpired: false,
        activationState: 'pending_activation', activatesAtWeek: 3,
        usedAtWeek: null, usedOnUserId: null, usedEffect: null,
        acquiredAtWeek: 2, awardKey: 'old',
      }],
    }
    const threatened = planZombieOutcomeReplay(row(101, 90), snapshot, 3, 'simple')
    expect(threatened?.infections).toEqual([])
    expect(threatened?.spentItemIds).toEqual(['s'])
    expect(threatened?.weaponAwards).toEqual([])
    expect(planZombieOutcomeReplay(row(90, 101), snapshot, 3, 'simple')?.spentItemIds).toEqual([])
  })

  it('returns an armed weapon when that infection rule is disabled', () => {
    const snapshot: ZombieSettlementSnapshotV1 = {
      ...base,
      config: { ...base.config!, infectionLossToZombie: false },
      items: [{
        id: 'w', teamStatusId: 'th', userId: 'h', itemType: 'weapon_knife',
        itemLabel: '🔪 Knife', isUsed: false, isExpired: false,
        activationState: 'pending_activation', activatesAtWeek: 3,
        usedAtWeek: null, usedOnUserId: null, usedEffect: 'infection_shield',
        acquiredAtWeek: 2, awardKey: null,
      }],
    }
    expect(planZombieOutcomeReplay(row(101, 90), snapshot, 3, 'enhanced')?.spentItemIds).toEqual([])
  })

  it('declines combat and automatic revival weeks for commissioner review', () => {
    expect(planZombieOutcomeReplay(row(130, 90), base, 3, 'enhanced')).toBeNull()
    expect(planZombieOutcomeReplay(row(101, 90), {
      ...base, config: { ...base.config!, autoSerumRevive: true },
    }, 3, 'enhanced')).toBeNull()
  })
})
