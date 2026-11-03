import { describe, expect, it } from 'vitest'
import { buildProjectedZombieSlate, projectedZombieLineupPoints } from '@/lib/zombie/projectedWeeklySlate'

const player = (id: string, positions: string[], points: number | null) => ({ id, positions, points, available: true as const })

describe('projected Zombie weekly slates', () => {
  it('assigns a multi-position player without blocking the only legal starter elsewhere', () => {
    const players = [player('flex', ['RB', 'WR'], 20), player('back', ['RB'], 12)]
    expect(projectedZombieLineupPoints(players, [['RB'], ['WR']])).toBe(32)
    expect(projectedZombieLineupPoints(players, [['RB'], ['WR'], ['QB']])).toBeNull()
  })

  it('rejects missing projections and partial schedules instead of inventing scores', () => {
    const schedule = [{ matchupId: 'm', homeRosterId: 'home', awayRosterId: 'away' }]
    const rosters = new Map([
      ['home', [player('qb1', ['QB'], 15)]],
      ['away', [player('qb2', ['QB'], 20)]],
    ])
    const seats = [['QB']]
    expect(buildProjectedZombieSlate({ schedule, rosters, seats })).toEqual([
      { ...schedule[0], homeBaseScore: 15, awayBaseScore: 20, homeScore: 15, awayScore: 20, homeWeaponBonus: 0, awayWeaponBonus: 0 },
    ])
    expect(buildProjectedZombieSlate({ schedule: [], rosters, seats })).toBeNull()
    rosters.set('away', [player('qb2', ['QB'], null)])
    expect(buildProjectedZombieSlate({ schedule, rosters, seats })).toBeNull()
  })
})
