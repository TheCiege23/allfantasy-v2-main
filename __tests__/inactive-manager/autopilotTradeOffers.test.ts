/**
 * Chimmy sending a trade offer (docs/chimmy-manager/IN_SEASON_MANAGER_PLAN.md, phase 4): the pure plan
 * and its timing. One bench player for one bench player, a clear upgrade, fair to the other side.
 */
import { describe, expect, it } from 'vitest'
import { BLOCK_BONUS, FAIR_FLOOR, INTEREST_BONUS, TWO_FOR_ONE_PREMIUM, offerHourFor, planTradeOffer, sendsThisHour, teamsToShopToday, type OtherTeam, type PricedPlayer } from '@/lib/inactive-manager/autopilotTradeOffers'
import { resolveManagerProfile } from '@/lib/inactive-manager/managerProfile'

const p = (playerId: string, position: string, value: number): PricedPlayer => ({ playerId, playerName: `P ${playerId}`, position, value })
const balanced = resolveManagerProfile({ rosterId: 'r1', savedPersonality: 'BALANCED' })
const starters = [p('qb', 'QB', 3000), p('rb1', 'RB', 2500), p('rb2', 'RB', 1000), p('wr1', 'WR', 2400)]
const bench = [p('bwr', 'WR', 1900), p('bte', 'TE', 600)]
const plan = (others: OtherTeam[], over: Partial<Parameters<typeof planTradeOffer>[0]> = {}) =>
  planTradeOffer({ profile: balanced, starters, bench, others, ...over })

describe('planTradeOffer', () => {
  it('offers a bench player for a bench player who clearly upgrades its weakest starter', () => {
    const o = plan([{ rosterId: 't2', bench: [p('xrb', 'RB', 2000)] }])
    expect(o).toMatchObject({ toRosterId: 't2', give: [{ playerId: 'bwr' }], get: { playerId: 'xrb' }, replaces: { playerId: 'rb2' }, onBlock: false })
    expect(o!.reason).toBe('Chimmy is offering P bwr for P xrb: it needs help at RB.')
    expect(o!.reason).not.toMatch(/\bAI\b/)
  })

  it('takes the biggest upgrade across the league, and gives up as little as the deal allows', () => {
    const o = plan(
      [{ rosterId: 't2', bench: [p('xrb', 'RB', 1500)] }, { rosterId: 't3', bench: [p('yrb', 'RB', 2000)] }],
      { bench: [p('b1', 'WR', 1950), p('b2', 'WR', 1850), p('b3', 'WR', 1400)] },
    )
    expect(o).toMatchObject({ toRosterId: 't3', get: { playerId: 'yrb' }, give: [{ playerId: 'b2' }] })
  })

  it('makes no offer without a clear upgrade or without a fair player to give', () => {
    // Barely better than the starter he would replace.
    expect(plan([{ rosterId: 't2', bench: [p('xrb', 'RB', 1050)] }])).toBeNull()
    // A real upgrade, but nothing on the bench is worth enough to be fair (or it would overpay).
    expect(plan([{ rosterId: 't2', bench: [p('xrb', 'RB', 3000)] }])).toBeNull()
    expect(plan([{ rosterId: 't2', bench: [p('xrb', 'RB', 1500)] }])).toBeNull()
    // A position it does not start.
    expect(plan([{ rosterId: 't2', bench: [p('xk', 'K', 2000)] }])).toBeNull()
    expect(plan([])).toBeNull()
    expect(plan([{ rosterId: 't2', bench: [p('xrb', 'RB', 2000)] }], { bench: [] })).toBeNull()
  })

  it('what it gives is always a bench player worth at least the fair floor of what it asks for', () => {
    const o = plan([{ rosterId: 't2', bench: [p('xrb', 'RB', 2000)] }])!
    expect(o.give).toHaveLength(1)
    expect(o.give[0]!.value).toBeGreaterThanOrEqual(o.get.value * FAIR_FLOOR)
    expect(o.give[0]!.value).toBeLessThanOrEqual(o.get.value)
    expect(starters.map((s) => s.playerId)).not.toContain(o.give[0]!.playerId)
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

describe('the trade block', () => {
  it('may ask for a starter the other manager has listed, and says so', () => {
    // xs starts for the other team: off limits unless listed.
    expect(plan([{ rosterId: 't2', bench: [] }])).toBeNull()
    const o = plan([{ rosterId: 't2', bench: [], block: [p('xs', 'RB', 2000)] }])
    expect(o).toMatchObject({ get: { playerId: 'xs' }, give: [{ playerId: 'bwr' }], onBlock: true })
    expect(o!.reason).toBe('Chimmy is offering P bwr for P xs: you have him on the trade block, and it needs help at RB.')
  })

  it('prefers a listed player over a slightly bigger upgrade that is not listed', () => {
    // Not listed: +1000 on the weakest back. Listed: +900, which the block bonus lifts past it.
    const o = plan([
      { rosterId: 't2', bench: [p('xrb', 'RB', 2000)] },
      { rosterId: 't3', bench: [], block: [p('zrb', 'RB', 1900)] },
    ])
    expect(900 * BLOCK_BONUS).toBeGreaterThan(1000)
    expect(o).toMatchObject({ toRosterId: 't3', get: { playerId: 'zrb' }, onBlock: true })
  })

  it('leans to the listing that asks for a position Chimmy is giving', () => {
    const o = plan([
      { rosterId: 't2', bench: [], block: [{ ...p('arb', 'RB', 2000), askingForPositions: ['TE'] }] },
      { rosterId: 't3', bench: [], block: [{ ...p('brb', 'RB', 2000), askingForPositions: ['wr'] }] },
    ])
    expect(o).toMatchObject({ toRosterId: 't3', get: { playerId: 'brb' } })
  })

  it('a listed player still has to be a clear upgrade and fairly paid for', () => {
    expect(plan([{ rosterId: 't2', bench: [], block: [p('xs', 'RB', 1050)] }])).toBeNull()
    expect(plan([{ rosterId: 't2', bench: [], block: [p('xs', 'RB', 9000)] }])).toBeNull()
  })
})

describe('two for one', () => {
  const twoBench = [p('b1', 'WR', 1300), p('b2', 'TE', 1200), p('b3', 'WR', 400)]

  it('gives two bench players when no single one is enough for the player it wants', () => {
    // 2400 back: no bench player is worth 2160+, but 1300 + 1200 = 2500 is within 20% over.
    const o = plan([{ rosterId: 't2', bench: [p('xrb', 'RB', 2400)] }], { bench: twoBench })
    expect(o!.give.map((g) => g.playerId)).toEqual(['b1', 'b2'])
    expect(o!.reason).toBe('Chimmy is offering P b1 and P b2 for P xrb: it needs help at RB.')
    const sum = o!.give.reduce((n, g) => n + g.value, 0)
    expect(sum).toBeGreaterThanOrEqual(2400)
    expect(sum).toBeLessThanOrEqual(2400 * (1 + TWO_FOR_ONE_PREMIUM))
  })

  it('still gives one player when one is enough', () => {
    const o = plan([{ rosterId: 't2', bench: [p('xrb', 'RB', 1400)] }], { bench: twoBench })
    expect(o!.give.map((g) => g.playerId)).toEqual(['b1'])
  })

  it('will not underpay with two, or overpay by more than the premium', () => {
    // 1300 + 1200 = 2500: short of 2600, and more than 20% over 2000 is 2400.
    expect(plan([{ rosterId: 't2', bench: [p('xrb', 'RB', 2600)] }], { bench: twoBench })).toBeNull()
    expect(plan([{ rosterId: 't2', bench: [p('xrb', 'RB', 2050)] }], { bench: [p('b1', 'WR', 1300), p('b2', 'TE', 1200)] })).toBeNull()
  })
})

describe('interest lists', () => {
  const twoGives = [p('b1', 'WR', 1850), p('b2', 'WR', 1900)]

  it('gives the player the other manager asked about, when he is a fair price', () => {
    // Either receiver is fair for a 2000 back. Without interest Chimmy gives the cheaper one.
    expect(plan([{ rosterId: 't2', bench: [p('xrb', 'RB', 2000)] }], { bench: twoGives })!.give[0]!.playerId).toBe('b1')
    const o = plan([{ rosterId: 't2', bench: [p('xrb', 'RB', 2000)], wants: ['b2'] }], { bench: twoGives })!
    expect(o).toMatchObject({ give: [{ playerId: 'b2' }], wanted: true })
    expect(o.reason).toBe('Chimmy is offering P b2 for P xrb: you were interested in P b2, and it needs help at RB.')
  })

  it('leans to the manager who wants what Chimmy is giving, and names every reason', () => {
    const o = plan([
      { rosterId: 't2', bench: [p('arb', 'RB', 2000)] },
      { rosterId: 't3', bench: [], block: [p('brb', 'RB', 2000)], wants: ['bwr'] },
    ])!
    expect(o).toMatchObject({ toRosterId: 't3', onBlock: true, wanted: true })
    expect(o.reason).toBe('Chimmy is offering P bwr for P brb: you were interested in P bwr, you have him on the trade block, and it needs help at RB.')
    expect(INTEREST_BONUS).toBeGreaterThan(1)
  })

  it('interest never makes an unfair or pointless offer', () => {
    // He wants the 600 tight end, but that is nowhere near a fair price for a 2000 back.
    expect(plan([{ rosterId: 't2', bench: [p('xrb', 'RB', 2000)], wants: ['bte'] }])).toMatchObject({ give: [{ playerId: 'bwr' }], wanted: false })
    // Wanting a player does not create an offer when Chimmy has nothing to gain.
    expect(plan([{ rosterId: 't2', bench: [p('xrb', 'RB', 1050)], wants: ['bwr'] }])).toBeNull()
  })
})
