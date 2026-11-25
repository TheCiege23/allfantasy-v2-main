/**
 * Chimmy sending a trade offer (docs/chimmy-manager/IN_SEASON_MANAGER_PLAN.md, phase 4): the pure plan
 * and its timing. One bench player for one bench player, a clear upgrade, fair to the other side.
 */
import { describe, expect, it } from 'vitest'
import { FAIR_FLOOR, offerHourFor, planTradeOffer, sendsThisHour, teamsToShopToday, type PricedPlayer } from '@/lib/inactive-manager/autopilotTradeOffers'
import { resolveManagerProfile } from '@/lib/inactive-manager/managerProfile'

const p = (playerId: string, position: string, value: number): PricedPlayer => ({ playerId, playerName: `P ${playerId}`, position, value })
const balanced = resolveManagerProfile({ rosterId: 'r1', savedPersonality: 'BALANCED' })
const starters = [p('qb', 'QB', 3000), p('rb1', 'RB', 2500), p('rb2', 'RB', 1000), p('wr1', 'WR', 2400)]
const bench = [p('bwr', 'WR', 1900), p('bte', 'TE', 600)]
const plan = (others: Array<{ rosterId: string; bench: PricedPlayer[] }>, over: Partial<Parameters<typeof planTradeOffer>[0]> = {}) =>
  planTradeOffer({ profile: balanced, starters, bench, others, ...over })

describe('planTradeOffer', () => {
  it('offers a bench player for a bench player who clearly upgrades its weakest starter', () => {
    const o = plan([{ rosterId: 't2', bench: [p('xrb', 'RB', 2000)] }])
    expect(o).toMatchObject({ toRosterId: 't2', give: { playerId: 'bwr' }, get: { playerId: 'xrb' }, replaces: { playerId: 'rb2' } })
    expect(o!.reason).toBe('Chimmy is offering P bwr for P xrb: it needs help at RB.')
    expect(o!.reason).not.toMatch(/\bAI\b/)
  })

  it('takes the biggest upgrade across the league, and gives up as little as the deal allows', () => {
    const o = plan(
      [{ rosterId: 't2', bench: [p('xrb', 'RB', 1500)] }, { rosterId: 't3', bench: [p('yrb', 'RB', 2000)] }],
      { bench: [p('b1', 'WR', 1950), p('b2', 'WR', 1850), p('b3', 'WR', 1400)] },
    )
    expect(o).toMatchObject({ toRosterId: 't3', get: { playerId: 'yrb' }, give: { playerId: 'b2' } })
  })

  it('makes no offer without a clear upgrade or without a fair player to give', () => {
    // Barely better than the starter he would replace.
    expect(plan([{ rosterId: 't2', bench: [p('xrb', 'RB', 1050)] }])).toBeNull()
    // A real upgrade, but nothing on the bench is worth enough to be fair (or it would overpay).
    expect(plan([{ rosterId: 't2', bench: [p('xrb', 'RB', 2400)] }])).toBeNull()
    expect(plan([{ rosterId: 't2', bench: [p('xrb', 'RB', 1500)] }])).toBeNull()
    // A position it does not start.
    expect(plan([{ rosterId: 't2', bench: [p('xk', 'K', 2000)] }])).toBeNull()
    expect(plan([])).toBeNull()
    expect(plan([{ rosterId: 't2', bench: [p('xrb', 'RB', 2000)] }], { bench: [] })).toBeNull()
  })

  it('what it gives is always a bench player worth at least the fair floor of what it asks for', () => {
    const o = plan([{ rosterId: 't2', bench: [p('xrb', 'RB', 2000)] }])!
    expect(o.give.value).toBeGreaterThanOrEqual(o.get.value * FAIR_FLOOR)
    expect(o.give.value).toBeLessThanOrEqual(o.get.value)
    expect(starters.map((s) => s.playerId)).not.toContain(o.give.playerId)
  })

  it('will not give a position it prizes for one it sells', () => {
    // Zero-RB values its receiver more than the back: the swap loses on its own scale.
    const zeroRb = resolveManagerProfile({ rosterId: 'r1', savedPersonality: 'ZERO_RB' })
    expect(plan([{ rosterId: 't2', bench: [p('xrb', 'RB', 2000)] }], { profile: zeroRb })).toBeNull()
  })

  it('ignores unpriced players on both sides', () => {
    expect(plan([{ rosterId: 't2', bench: [p('xrb', 'RB', 0)] }])).toBeNull()
    expect(plan([{ rosterId: 't2', bench: [p('xrb', 'RB', 2000)] }], { bench: [p('bwr', 'WR', 0)] })).toBeNull()
  })
})

describe('when a team sends', () => {
  it('has one fixed hour a day', () => {
    const hour = offerHourFor('roster-a')
    expect(hour).toBe(offerHourFor('roster-a'))
    const hits = Array.from({ length: 24 }, (_, h) => sendsThisHour('roster-a', new Date(Date.UTC(2026, 10, 25, h, 5)))).filter(Boolean)
    expect(hits).toHaveLength(1)
    expect(sendsThisHour('roster-a', new Date(Date.UTC(2026, 10, 25, hour, 59)))).toBe(true)
    // Teams are spread over the day rather than all sending together.
    expect(new Set(Array.from({ length: 40 }, (_, i) => offerHourFor(`roster-${i}`))).size).toBeGreaterThan(8)
  })

  it('shops a different slice of the league each day and covers every team over time', () => {
    const teams = Array.from({ length: 11 }, (_, i) => ({ rosterId: `t${String(i).padStart(2, '0')}` }))
    const day = (d: number) => teamsToShopToday(teams, 'me', new Date(Date.UTC(2026, 10, d, 12)), 4).map((t) => t.rosterId)
    expect(day(1)).toHaveLength(4)
    expect(day(1)).toEqual(day(1))
    expect(day(1)).not.toEqual(day(2))
    expect(new Set([1, 2, 3, 4, 5, 6].flatMap(day)).size).toBe(11)
    // A small league is shopped whole.
    expect(teamsToShopToday(teams.slice(0, 3), 'me', new Date(), 4)).toHaveLength(3)
  })
})
