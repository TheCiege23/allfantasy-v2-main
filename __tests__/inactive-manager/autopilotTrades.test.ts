/**
 * Chimmy answering a trade offer (docs/chimmy-manager/IN_SEASON_MANAGER_PLAN.md, phase 3): the pure
 * decision. A wrong "no" costs nothing, a wrong "yes" moves players, so every doubt declines.
 */
import { describe, expect, it } from 'vitest'
import type { AssetValueSnapshot, TradeValueSnapshot } from '@/lib/trade-value/types'
import { MAX_STARTERS_GIVEN, decideTradeOffer, planCounterOffer, weighedValue } from '@/lib/inactive-manager/autopilotTrades'
import { autopilotTradeMode, readManagedLineups } from '@/lib/inactive-manager/inactiveManagerMode'
import { resolveManagerProfile } from '@/lib/inactive-manager/managerProfile'

const CHIMMY = 'rr-chimmy'
const OTHER = 'rr-other'

type A = Partial<AssetValueSnapshot> & { v: number }
const asset = (from: string, to: string, a: A): AssetValueSnapshot =>
  ({ kind: 'player', playerId: `p-${Math.random()}`, position: 'WR', valuationBasis: 'market', ...a, fromRosterId: from, toRosterId: to, internalValue: a.v }) as unknown as AssetValueSnapshot
const gives = (a: A) => asset(CHIMMY, OTHER, a)
const gets = (a: A) => asset(OTHER, CHIMMY, a)

const snapshot = (assets: AssetValueSnapshot[], extra: Partial<TradeValueSnapshot> = {}): TradeValueSnapshot =>
  ({
    sides: [
      { rosterId: OTHER, total: 0, assets: assets.filter((a) => a.fromRosterId === OTHER) },
      { rosterId: CHIMMY, total: 0, assets: assets.filter((a) => a.fromRosterId === CHIMMY) },
    ],
    grade: { insufficientData: false },
    ...extra,
  }) as unknown as TradeValueSnapshot

const balanced = resolveManagerProfile({ rosterId: 'r1', style: 'dynasty_owner', savedPersonality: 'BALANCED' })
const decide = (assets: AssetValueSnapshot[], over: Partial<Parameters<typeof decideTradeOffer>[0]> = {}) =>
  decideTradeOffer({ profile: balanced, snapshot: snapshot(assets), rosterId: CHIMMY, multiTeam: false, starterIds: [], ...over })

describe('decideTradeOffer', () => {
  it('accepts when what it gets beats what it gives by its margin, and declines an even or losing deal', () => {
    expect(decide([gives({ v: 1000 }), gets({ v: 1100 })])).toMatchObject({ decision: 'accept', code: 'accepted', give: 1000, get: 1100 })
    // Balanced wants 8% more: an even swap is not enough.
    expect(decide([gives({ v: 1000 }), gets({ v: 1000 })])).toMatchObject({ decision: 'reject', code: 'not_enough' })
    expect(decide([gives({ v: 1000 }), gets({ v: 600 })])).toMatchObject({ decision: 'reject', code: 'not_enough' })
  })

  it('an easier manager takes a deal a tougher one declines', () => {
    const offer = [gives({ v: 1000 }), gets({ v: 1050 })]
    const easy = resolveManagerProfile({ rosterId: 'r1', savedPersonality: 'UPSIDE_SWINGER' })
    const tough = resolveManagerProfile({ rosterId: 'r1', savedPersonality: 'ADP_VALUE_HUNTER' })
    expect(decide(offer, { profile: easy }).decision).toBe('accept')
    expect(decide(offer, { profile: tough }).decision).toBe('reject')
  })

  it('weighs positions and picks its own way', () => {
    const rbHeavy = resolveManagerProfile({ rosterId: 'r1', savedPersonality: 'RB_HEAVY' })
    const rb = gets({ v: 1000, position: 'RB' })
    expect(weighedValue(rb, rbHeavy)).toBeGreaterThan(weighedValue(rb, balanced))
    // A running back for an even-valued receiver: the back collector says yes, the balanced manager no.
    const swap = [gives({ v: 1000, position: 'WR' }), gets({ v: 1000, position: 'RB' })]
    expect(decide(swap, { profile: rbHeavy }).decision).toBe('accept')
    expect(decide(swap).decision).toBe('reject')

    const pick = gets({ v: 1000, kind: 'draft_pick', playerId: null, position: null })
    const rebuild = resolveManagerProfile({ rosterId: 'r1', style: 'rebuild', savedPersonality: 'BALANCED' })
    const winNow = resolveManagerProfile({ rosterId: 'r1', style: 'win_now', savedPersonality: 'BALANCED' })
    expect(weighedValue(pick, rebuild)).toBeGreaterThan(1000)
    expect(weighedValue(pick, winNow)).toBeLessThan(1000)
  })

  it('declines anything it cannot value', () => {
    expect(decide([], { snapshot: null })).toMatchObject({ decision: 'reject', code: 'cannot_value' })
    expect(decideTradeOffer({ profile: balanced, snapshot: snapshot([gives({ v: 1 }), gets({ v: 9000 })], { grade: { insufficientData: true } as never }), rosterId: CHIMMY, multiTeam: false, starterIds: [] }).code).toBe('cannot_value')
    expect(decideTradeOffer({ profile: balanced, snapshot: snapshot([gives({ v: 1 }), gets({ v: 9000 })], { coverage: { status: 'blocked' } as never }), rosterId: CHIMMY, multiTeam: false, starterIds: [] }).code).toBe('cannot_value')
    // A player going OUT with no value on him could be worth anything.
    expect(decide([gives({ v: 0, valuationBasis: 'none' }), gets({ v: 9000 })])).toMatchObject({ decision: 'reject', code: 'cannot_value' })
    // An unpriced player coming IN counts as nothing, so the rest of the offer has to carry it.
    expect(decide([gives({ v: 1000 }), gets({ v: 0, valuationBasis: 'none' })])).toMatchObject({ decision: 'reject', code: 'cannot_value' })
    expect(decide([gives({ v: 1000 }), gets({ v: 0, valuationBasis: 'none' }), gets({ v: 1200 })]).decision).toBe('accept')
  })

  it('declines a multi-team trade and an offer that gives the team nothing', () => {
    expect(decide([gives({ v: 1 }), gets({ v: 9000 })], { multiTeam: true })).toMatchObject({ decision: 'reject', code: 'multi_team' })
    expect(decide([gives({ v: 1000 })])).toMatchObject({ decision: 'reject', code: 'nothing_offered' })
  })

  it('never opens a hole in the lineup, however good the value', () => {
    const s1 = gives({ v: 500, playerId: 's1' })
    const s2 = gives({ v: 500, playerId: 's2' })
    const s3 = gives({ v: 500, playerId: 's3' })
    const star = gets({ v: 9000 })
    // Two starters out for one player back leaves a starting spot empty.
    expect(decide([s1, s2, star], { starterIds: ['s1', 's2'] })).toMatchObject({ decision: 'reject', code: 'lineup_hole' })
    // Bench players out for one star is fine.
    expect(decide([s1, s2, star], { starterIds: [] }).decision).toBe('accept')
    // More than the cap of starters, even with a player back for each.
    expect(MAX_STARTERS_GIVEN).toBe(2)
    expect(decide([s1, s2, s3, star, gets({ v: 9000 }), gets({ v: 9000 })], { starterIds: ['s1', 's2', 's3'] })).toMatchObject({ decision: 'reject', code: 'too_many_starters' })
  })

  it('every answer carries one plain line that never says "AI"', () => {
    for (const a of [decide([gives({ v: 1000 }), gets({ v: 2000 })]), decide([gives({ v: 1000 }), gets({ v: 10 })]), decide([], { snapshot: null }), decide([gives({ v: 1 })])]) {
      expect(a.reason.length).toBeGreaterThan(10)
      expect(a.reason).not.toMatch(/\bAI\b/)
    }
  })
})

describe('the trade mode saved on a Chimmy team', () => {
  const settings = (autopilot: Record<string, unknown> | null) => ({ af_managed_lineups: { r1: { since: 's', byUserId: 'u', ...(autopilot ? { autopilot: { style: 'win_now', since: 's', byUserId: 'u', ...autopilot } } : {}) } } })

  it('answers offers by default, keeps a saved choice, and is off for a team Chimmy does not run', () => {
    expect(autopilotTradeMode(readManagedLineups(settings({})).r1)).toBe('answer')
    expect(autopilotTradeMode(readManagedLineups(settings({ trades: 'off' })).r1)).toBe('off')
    expect(autopilotTradeMode(readManagedLineups(settings({ trades: 'answer_and_send' })).r1)).toBe('answer_and_send')
    expect(autopilotTradeMode(readManagedLineups(settings({ trades: 'sometimes' })).r1)).toBe('answer')
    // Lineup management only, no autopilot: nobody answers, so no offers.
    expect(autopilotTradeMode(readManagedLineups(settings(null)).r1)).toBe('off')
    expect(autopilotTradeMode(undefined)).toBe('off')
  })
})

describe('planCounterOffer', () => {
  const plan = (assets: AssetValueSnapshot[], askable: Array<{ playerId: string; playerName: string | null; position: string | null; value: number }> = [], profile = balanced) =>
    planCounterOffer({ profile, snapshot: snapshot(assets), rosterId: CHIMMY, askable })
  const bench = (playerId: string, value: number, position = 'WR') => ({ playerId, playerName: `Bench ${playerId}`, position, value })

  it('asks for the smallest bench player that closes the gap, by name', () => {
    // Gives 1000, gets 950: balanced wants 1080, so it needs 130 more.
    const c = plan([gives({ v: 1000 }), gets({ v: 950 })], [bench('big', 300), bench('fit', 150), bench('tiny', 40)])
    expect(c).toMatchObject({ kind: 'add_on', add: { playerId: 'fit' }, reason: 'Chimmy would do this deal with Bench fit added.' })
  })

  it('does not ask for a player worth far more than the gap, or one already in the deal', () => {
    // Needs 130; 600 is far more than it needs, and nothing else is on offer.
    expect(plan([gives({ v: 1000 }), gets({ v: 950 })], [bench('star', 600)])).toBeNull()
    expect(plan([gives({ v: 1000 }), gets({ v: 950, playerId: 'fit' })], [bench('fit', 150)])).toBeNull()
  })

  it('otherwise offers the same deal with one of its players left out', () => {
    const c = plan([gives({ v: 800, playerId: 'main', playerName: 'Main Man' }), gives({ v: 200, playerId: 'extra', playerName: 'Throw In' }), gets({ v: 950 })])
    expect(c).toMatchObject({ kind: 'keep_back', keepPlayerId: 'extra', reason: 'Chimmy would do this deal if it keeps Throw In.' })
    // A one-for-one with nobody to ask for has no counter.
    expect(plan([gives({ v: 1000 }), gets({ v: 950 })])).toBeNull()
  })

  it('does not counter a deal that is already good, or one that is nowhere near', () => {
    expect(plan([gives({ v: 1000 }), gets({ v: 1200 })], [bench('fit', 150)])).toBeNull()
    expect(plan([gives({ v: 1000 }), gets({ v: 400 })], [bench('fit', 150), bench('big', 700)])).toBeNull()
    expect(planCounterOffer({ profile: balanced, snapshot: null, rosterId: CHIMMY, askable: [] })).toBeNull()
  })

  it('weighs the player it asks for its own way', () => {
    // Needs 130. A 110 running back is not enough for a balanced manager, but is for a back collector
    // (whose even-swap gap is also 130: it weighs the receivers in the deal as any manager would).
    const rbHeavy = resolveManagerProfile({ rosterId: 'r1', savedPersonality: 'RB_HEAVY' })
    const offer = [gives({ v: 1000 }), gets({ v: 950 })]
    expect(plan(offer, [bench('rb', 110, 'RB')])).toBeNull()
    expect(plan(offer, [bench('rb', 110, 'RB')], rbHeavy)).toMatchObject({ kind: 'add_on', add: { playerId: 'rb' } })
  })
})
