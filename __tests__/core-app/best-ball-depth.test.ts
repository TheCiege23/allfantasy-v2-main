import { describe, expect, it } from 'vitest'
import { bestBallDepthAlerts, neededByPosition, type DepthPlayer } from '@/lib/core-app/bestBallDepth'

const p = (name: string, position: string, status: string | null = null, unavailable = false, inactive = false): DepthPlayer => ({
  name, position, status, unavailable, inactive,
})
const SLOTS = ['QB', 'RB', 'RB', 'WR', 'WR', 'WR', 'TE', 'FLEX', 'SUPER_FLEX']

describe('bestBallDepthAlerts', () => {
  it("flags the founder's example: 3 QBs, 1 healthy, 1 out, 1 questionable", () => {
    const alerts = bestBallDepthAlerts(SLOTS, [
      p('Healthy QB', 'QB'),
      p('Out QB', 'QB', 'Out', true),
      p('Q QB', 'QB', 'Questionable'),
    ])
    expect(alerts).toHaveLength(1)
    expect(alerts[0]).toMatchObject({ position: 'QB', rostered: 3, healthy: 1, out: 1, questionable: 1, needed: 1, tone: 'warn' })
  })

  it('stays quiet when only a small share of a deep room is hurt', () => {
    const wrs = ['A', 'B', 'C', 'D', 'E', 'F'].map((n) => p(n, 'WR'))
    wrs[0] = p('A', 'WR', 'Out', true)
    expect(bestBallDepthAlerts(SLOTS, wrs)).toEqual([])
  })

  it('stays quiet when half are hurt but healthy players still exceed the slots', () => {
    const rbs = [p('a', 'RB'), p('b', 'RB'), p('c', 'RB'), p('d', 'RB', 'Out', true), p('e', 'RB', 'Questionable'), p('f', 'RB', 'IR', true)]
    expect(bestBallDepthAlerts(SLOTS, rbs)).toEqual([])
  })

  it("is 'bad' when even the questionable players cannot fill the slots", () => {
    const alerts = bestBallDepthAlerts(SLOTS, [p('a', 'RB'), p('b', 'RB', 'Out', true), p('c', 'RB', 'Out', true)])
    expect(alerts[0]).toMatchObject({ position: 'RB', tone: 'bad', healthy: 1, needed: 2 })
  })

  it('ignores IR/taxi players and positions the lineup never uses', () => {
    expect(bestBallDepthAlerts(SLOTS, [p('k', 'K', 'Out', true), p('qb', 'QB'), p('qb2', 'QB', 'IR', true, true)])).toEqual([])
  })

  it('counts dedicated slots only, never flex', () => {
    expect(Object.fromEntries(neededByPosition(SLOTS))).toEqual({ QB: 1, RB: 2, WR: 3, TE: 1 })
  })
})
