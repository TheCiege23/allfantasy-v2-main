import { describe, expect, it } from 'vitest'
import { planUniverseMovement, type MovementStanding } from '@/lib/zombie/universeMovementPlan'
const levels = [{ id: 'g', name: 'Gamma', rankOrder: 1 }, { id: 'b', name: 'Beta', rankOrder: 2 }, { id: 'a', name: 'Alpha', rankOrder: 3 }]
const policy = { promotionEnabled: true, relegationEnabled: true, promotionCount: 1, relegationCount: 1 }
const rows: MovementStanding[] = levels.flatMap(l => [0,1,2,3].map(i => ({
  levelId: l.id, leagueId: l.id + '-league', rosterId: l.id + i, wins: 4-i, losses: i, ties: 0, totalPoints: 400-i*40,
})))
describe('universe movement allocation', () => {
  it('moves the best and worst within each level to an actual adjacent level', () => {
    const plan = planUniverseMovement(rows, levels, policy)
    expect(plan.find(r => r.rosterId === 'g0')).toMatchObject({ projectedLevelId: 'b', reason: 'promotion', toTierLabel: 'Beta' })
    expect(plan.find(r => r.rosterId === 'b0')).toMatchObject({ projectedLevelId: 'a', reason: 'promotion' })
    expect(plan.find(r => r.rosterId === 'b3')).toMatchObject({ projectedLevelId: 'g', reason: 'relegation' })
    expect(plan.find(r => r.rosterId === 'a0')?.reason).toBe('watch')
    expect(plan.find(r => r.rosterId === 'g3')?.reason).toBe('watch')
    expect(plan.filter(r => r.reason !== 'watch')).toHaveLength(4)
  })
  it('honors disabled directions and zero counts without slice(-0) relegating everybody', () => {
    expect(planUniverseMovement(rows, levels, { ...policy, promotionCount: 0, relegationCount: 0 }).every(r => r.reason === 'watch')).toBe(true)
    expect(planUniverseMovement(rows, levels, { ...policy, promotionEnabled: false, relegationEnabled: false }).every(r => r.reason === 'watch')).toBe(true)
  })
  it('uses record before PPW, and stable roster identity for exact ties', () => {
    const tied = rows.map(r => ({ ...r, wins: 2, losses: 1, ties: 1, totalPoints: 40 }))
    const one = planUniverseMovement(tied, levels, policy)
    expect(planUniverseMovement([...tied].reverse(), [...levels].reverse(), policy)).toEqual(one)
    expect(one[0].winPct).toBe(.625)
    expect(one[0].pointsPerWeek).toBe(10)
  })
  it('keeps unplayed managers and never assigns both movements in overlapping zones', () => {
    const single = [{ ...rows[4], wins: 0, losses: 0, ties: 0 }]
    expect(planUniverseMovement(single, levels, policy)[0].reason).toBe('watch')
    const plan = planUniverseMovement([rows[4]], levels, { ...policy, promotionCount: 5, relegationCount: 5 })
    expect(plan).toHaveLength(1)
    expect(plan[0].reason).toBe('promotion')
  })
  it('refuses ambiguous levels, duplicate rosters and invalid numeric standings', () => {
    expect(() => planUniverseMovement(rows, [...levels, levels[0]], policy)).toThrow('MOVEMENT_LEVELS_AMBIGUOUS')
    expect(() => planUniverseMovement([...rows, rows[0]], levels, policy)).toThrow('MOVEMENT_ROSTERS_AMBIGUOUS')
    expect(() => planUniverseMovement([{...rows[0], totalPoints: NaN}], levels, policy)).toThrow('MOVEMENT_STANDINGS_INVALID')
    expect(() => planUniverseMovement(rows, levels, {...policy, promotionCount: -1})).toThrow('MOVEMENT_COUNT_INVALID')
  })
})
