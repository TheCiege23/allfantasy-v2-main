import { describe, expect, it } from 'vitest'
import { rookieAuctionStructureChangeError } from '@/lib/live-draft-engine/auction/rookieAuctionSettings'
import { planRookieAuction } from '@/lib/live-draft-engine/auction/rookieAuctionPickPolicy'

const slotOrder = [{ slot: 1, rosterId: 'a', displayName: 'A' }, { slot: 2, rosterId: 'b', displayName: 'B' }, { slot: 3, rosterId: 'c', displayName: 'C' }]
const base = { slotOrder, rounds: 2, budgetPerTeam: 20, valuesByRound: { '1': 6, '2': 3 }, trades: [{ round: 1, originalRosterId: 'a', newRosterId: 'b' }] }

describe('rookie auction traded pick conversion', () => {
  it('blocks outstanding trades by default', () => {
    expect(() => planRookieAuction({ ...base, policy: 'block' })).toThrow(/resolved/)
    expect(planRookieAuction({ ...base, trades: [], policy: 'block' }).budgets).toEqual({ a: 20, b: 20, c: 20 })
  })
  it('transfers the configured value from the original team to the pick owner', () => {
    const plan = planRookieAuction({ ...base, policy: 'budget' })
    expect(plan.budgets).toEqual({ a: 14, b: 26, c: 20 })
    expect(plan.trades).toEqual(base.trades)
    expect(() => planRookieAuction({ ...base, policy: 'budget', valuesByRound: {} })).toThrow(/round 1/)
    expect(() => planRookieAuction({ ...base, policy: 'budget', valuesByRound: { '1': 19 } })).toThrow(/unable/)
  })
  it('transfers the original nomination turn once, preserving all other turns', () => {
    const plan = planRookieAuction({ ...base, policy: 'nominations' })
    expect(plan.nominationOrder.map(s => s.rosterId)).toEqual(['b', 'b', 'c', 'a', 'b', 'c'])
    expect(plan.budgets).toEqual({ a: 20, b: 20, c: 20 })
  })
  it('refuses unresolved, duplicated, or unseated rights', () => {
    expect(() => planRookieAuction({ ...base, policy: 'nominations', trades: [...base.trades, ...base.trades] })).toThrow(/matched/)
    expect(() => planRookieAuction({ ...base, policy: 'budget', trades: [{ ...base.trades[0], newRosterId: 'missing' }] })).toThrow(/matched/)
    expect(() => planRookieAuction({ ...base, policy: 'budget', trades: [{ ...base.trades[0], round: 3 }] })).toThrow(/matched/)
  })
})


describe('created rookie auction structure', () => {
  const auction = { draftModeLabel: 'rookie', draftType: 'auction', rounds: 2, auctionBudgetPerTeam: 20 }
  it('refuses changes that would discard or change converted rights', () => {
    expect(rookieAuctionStructureChangeError(auction, { draftType: 'linear' })).toMatch(/cannot be changed/)
    expect(rookieAuctionStructureChangeError(auction, { rounds: 3 })).toMatch(/cannot be changed/)
    expect(rookieAuctionStructureChangeError(auction, { auctionBudgetPerTeam: 30 })).toMatch(/cannot be changed/)
    expect(rookieAuctionStructureChangeError({ ...auction, draftType: 'linear' }, { draftType: 'auction' })).toMatch(/cannot be changed/)
  })
  it('allows unchanged values and ordinary startup draft edits', () => {
    expect(rookieAuctionStructureChangeError(auction, { draftType: 'auction', rounds: 2, auctionBudgetPerTeam: 20 })).toBeNull()
    expect(rookieAuctionStructureChangeError({ ...auction, draftModeLabel: 'startup' }, { rounds: 3 })).toBeNull()
  })
})
