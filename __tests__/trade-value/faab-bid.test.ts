import { describe, expect, it } from 'vitest'

import { faabBidCeiling } from '@/lib/trade-intel/faabBid'
import { survivorHorizon, SURVIVOR_ALL_STARS_2026 } from '@/lib/trade-intel/survivorSchedule'

const S = SURVIVOR_ALL_STARS_2026

/*
 * Survivor All-Stars: $1000 for the season, no trades, waivers on eliminated teams' rosters.
 * The anchor is the market payload's own — a full budget ≈ the ~48th-ranked asset's value.
 */
const ANCHOR = 3000

const base = {
  budgetRemaining: 1000,
  budgetTotal: 1000,
  anchorValue: ANCHOR,
  horizon: survivorHorizon(S, 1),
}

describe('faabBidCeiling — the question this league actually asks', () => {
  it('🛑 A NON-UPGRADE IS ZERO, whatever the name on the shirt', () => {
    /*
     * The most expensive mistake in a fixed-budget league is bidding on a name rather than on an
     * improvement, and the chart cannot tell you the difference — only your own lineup can.
     */
    const same = faabBidCeiling({ ...base, playerValue: 4000, replacedValue: 4000 })!
    expect(same.ceiling).toBe(0)
    expect(same.reason).toMatch(/does not improve your starting lineup/)

    const worse = faabBidCeiling({ ...base, playerValue: 3000, replacedValue: 4500 })!
    expect(worse.ceiling).toBe(0)
    expect(worse.marginalValue).toBeLessThan(0)
  })

  it('prices the MARGIN, so the same player is worth different money to different teams', () => {
    const thin = faabBidCeiling({ ...base, playerValue: 6000, replacedValue: 1000 })!
    const deep = faabBidCeiling({ ...base, playerValue: 6000, replacedValue: 5000 })!
    expect(thin.marginalValue).toBe(5000)
    expect(deep.marginalValue).toBe(1000)
    expect(thin.ceiling).toBeGreaterThan(deep.ceiling)
  })

  it('inverts the league’s OWN published anchor rather than a second exchange rate', () => {
    /* faabValue: $X of $B = (X/B) × anchor. Inverted: a player worth exactly the anchor costs a
     * full budget. Asserted as an exact round trip so the two rates cannot drift apart. */
    const whole = faabBidCeiling({ ...base, playerValue: ANCHOR, replacedValue: 0 })!
    expect(whole.fairValueBid).toBe(1000)

    const half = faabBidCeiling({ ...base, playerValue: ANCHOR / 2, replacedValue: 0 })!
    expect(half.fairValueBid).toBe(500)
  })

  it('🛑 NEVER exceeds the money you actually have', () => {
    const broke = faabBidCeiling({ ...base, budgetRemaining: 40, playerValue: 9000, replacedValue: 0 })!
    expect(broke.ceiling).toBe(40)
    expect(broke.fairValueBid).toBeGreaterThan(1000)
    expect(broke.shareOfBudget).toBe(1)
  })

  it('⚠ the pace floor: dying with unspent FAAB is strictly dominated', () => {
    /*
     * A small upgrade early is priced low — correctly, there is a whole season to spend. The same
     * small upgrade in the last week is worth everything left, because unspent FAAB scores nothing.
     */
    const small = { playerValue: 2100, replacedValue: 2000 }

    const wk1 = faabBidCeiling({ ...base, ...small, horizon: survivorHorizon(S, 1) })!
    const wk16 = faabBidCeiling({ ...base, ...small, horizon: survivorHorizon(S, 16) })!
    const wk17 = faabBidCeiling({ ...base, ...small, horizon: survivorHorizon(S, 17) })!

    expect(wk1.ceiling).toBeLessThan(wk16.ceiling)
    expect(wk16.ceiling).toBeLessThan(wk17.ceiling)
    expect(wk17.ceiling).toBe(1000) // one week left — spend it all
    expect(wk17.reason).toMatch(/scores nothing/)
  })

  it('⚠ but the pace floor NEVER rescues a non-upgrade, even on the last week', () => {
    /* The floor is an argument about pacing a budget across genuine upgrades. Applying it to a
     * player who makes your lineup worse would turn "spend it" into "spend it on anything". */
    const last = faabBidCeiling({
      ...base,
      playerValue: 1000,
      replacedValue: 4000,
      horizon: survivorHorizon(S, 17),
    })!
    expect(last.ceiling).toBe(0)
  })

  it('[control] the survival horizon MOSTLY CANCELS on a big upgrade — it is not a discount', () => {
    /*
     * The intuitive move is to discount a bid by how long you expect to survive. That double-counts:
     * the player's value is already horizon-discounted and the budget expires at the same moment.
     * So for an upgrade comfortably above the pace floor, the week should barely matter — and the
     * observable difference must come from pacing, not from a second discount.
     */
    const big = { playerValue: 8000, replacedValue: 1000 }
    const wk1 = faabBidCeiling({ ...base, ...big, horizon: survivorHorizon(S, 1) })!
    const wk9 = faabBidCeiling({ ...base, ...big, horizon: survivorHorizon(S, 9) })!
    expect(wk1.ceiling).toBe(wk9.ceiling)
    expect(wk1.ceiling).toBe(1000) // fair value exceeds the budget either way
  })

  it('🛑 returns NULL, not zero, when it cannot tell — zero is a recommendation', () => {
    const ok = { playerValue: 5000, replacedValue: 1000 }
    expect(faabBidCeiling({ ...base, ...ok, anchorValue: null })).toBeNull()
    expect(faabBidCeiling({ ...base, ...ok, anchorValue: 0 })).toBeNull()
    expect(faabBidCeiling({ ...base, ...ok, budgetTotal: 0 })).toBeNull()
    expect(faabBidCeiling({ ...base, ...ok, budgetRemaining: -5 })).toBeNull()
    expect(faabBidCeiling({ ...base, ...ok, playerValue: Number.NaN })).toBeNull()
  })

  it('works with no schedule at all — the pace floor simply does not apply', () => {
    /* A league that has published no elimination schedule still gets a priced bid; it just does
     * not get the pacing argument, which is stated in the reason rather than silently assumed. */
    const noSchedule = faabBidCeiling({ ...base, playerValue: 3000, replacedValue: 1500, horizon: null })!
    expect(noSchedule.paceFloor).toBe(0)
    expect(noSchedule.ceiling).toBe(noSchedule.fairValueBid)
    expect(noSchedule.reason).toMatch(/FAAB anchor/)
  })

  it('labels the anchor as the heuristic it is, rather than as market data', () => {
    const b = faabBidCeiling({ ...base, playerValue: 3000, replacedValue: 1500, horizon: null })!
    expect(b.reason).toMatch(/not market data/)
  })
})
