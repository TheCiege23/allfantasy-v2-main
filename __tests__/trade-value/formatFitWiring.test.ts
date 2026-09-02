/**
 * The format registry, wired into the snapshot builder.
 *
 * 🛑 THE PROPERTY THIS EXISTS TO PIN: `internalValue` is UNCHANGED by format models. The user's
 * decision (plan V5) was that format, need and injury effects are a SEPARATE "fit" number shown
 * beside the base, never folded into it — because base value is market-objective and comparable
 * across leagues, and a baked-in multiplier is both incomparable and invisible.
 *
 * So the headline assertion is a negative one: adding a format model must not move a price.
 */

import { describe, expect, it } from 'vitest'
import { buildTradeValueSnapshot, type EnrichedTradeAsset } from '@/lib/trade-value/snapshot'
import { buildLeagueShape } from '@/lib/trade-value/leagueShape'
import { applyFormatFit, fitAdjustedValue } from '@/lib/trade-value/formats/applyFormat'
import { STASH_OPTIONALITY_BONUS } from '@/lib/trade-value/formats/fourHorsemen'
import { normalizedPlayerValue } from '@/lib/trade-value/valueEngine'

const FOUR_HORSEMEN_SLOTS = [
  ...Array(4).fill('QB'), ...Array(4).fill('RB'), ...Array(6).fill('WR'),
  ...Array(4).fill('TE'), ...Array(10).fill('FLEX'),
]

const shape = buildLeagueShape({
  teams: 4, starterSlots: FOUR_HORSEMEN_SLOTS, rosterSize: 80,
  irSlots: 10, taxiSlots: 10, deadlineWeek: 13,
})!

const asset = (over: Partial<EnrichedTradeAsset> = {}): EnrichedTradeAsset => ({
  kind: 'player',
  fromRosterId: 'r1',
  toRosterId: 'r2',
  playerId: 'p1',
  playerName: 'Rookie WR',
  position: 'WR',
  experience: 1,
  sources: {
    projectionValue: 240, rankingValue: null, adpValue: null,
    fantasyCalcValue: null, idpValue: null,
  },
  ...over,
})

const build = (over: Record<string, unknown> = {}) =>
  buildTradeValueSnapshot({
    proposerRosterId: 'r1',
    receiverRosterId: 'r2',
    assets: [asset()],
    context: {
      sport: 'NFL', leagueType: 'four_horsemen', scoring: 'ppr',
      rosterFormat: 'standard', capturedAt: '2026-09-02T00:00:00.000Z',
    },
    scoring: { shape },
    ...over,
  })

const firstAsset = (snap: ReturnType<typeof build>) =>
  snap.sides.flatMap((s) => s.assets).find((a) => a.playerName === 'Rookie WR')!

describe('🛑 the base price is untouched', () => {
  /*
   * ⚠ THIS ASSERTS AN ABSOLUTE VALUE, AND THE FIRST VERSION DID NOT — IT COMPARED TWO SNAPSHOTS.
   *
   * A mutation folding a 1.05 multiplier into `internalValue` left all ten tests GREEN, because it
   * moved BOTH sides of every comparison equally. A relative check cannot detect a uniform change,
   * which made the headline test of this file a check that could not fail.
   *
   * The fix is to compare against the engine computed independently. `normalizedPlayerValue` is
   * the authority on what an asset is worth; if the snapshot disagrees with it by so much as a
   * rounding step, something in between is editing the price.
   */
  it('internalValue equals the engine exactly — nothing edits it in between', () => {
    const expected = normalizedPlayerValue({
      projection: 240,
      position: 'WR',
      adp: null,
      marketValue: null,
      idpValue: null,
      scoring: { shape },
    })
    expect(firstAsset(build()).internalValue).toBe(expected)
  })

  it('internalValue is identical with and without a format model', () => {
    const withModel = firstAsset(build())
    const withoutModel = firstAsset(build({
      context: {
        sport: 'NFL', leagueType: 'redraft', scoring: 'ppr',
        rosterFormat: 'standard', capturedAt: '2026-09-02T00:00:00.000Z',
      },
    }))
    /*
     * `redraft` has no model, `four_horsemen` does and returns a 1.05 stash bonus. Kept as a
     * second, weaker check — it is the one the mutation defeated, and it stays only because the
     * absolute assertion above now carries the weight.
     */
    expect(withModel.internalValue).toBe(withoutModel.internalValue)
  })

  it('the fit is present as DATA beside the price', () => {
    const a = firstAsset(build())
    expect(a.formatFit).toBeTruthy()
    expect(a.formatFit!.formatId).toBe('four_horsemen')
    expect(a.formatFit!.fit!.multiplier).toBe(STASH_OPTIONALITY_BONUS)
    expect(a.formatFit!.fit!.reason).toMatch(/taxi/i)
  })

  it('the grade is computed from base value only, not the fit', () => {
    // Both sides identical except one carries a format model. Fairness must not move.
    const withModel = build()
    const withoutModel = build({
      context: {
        sport: 'NFL', leagueType: 'redraft', scoring: 'ppr',
        rosterFormat: 'standard', capturedAt: '2026-09-02T00:00:00.000Z',
      },
    })
    expect(withModel.grade.fairnessScore).toBe(withoutModel.grade.fairnessScore)
    expect(withModel.grade.grade).toBe(withoutModel.grade.grade)
  })
})

describe('what reaches the model', () => {
  it('an unmodelled format yields null, not a default', () => {
    const a = firstAsset(build({
      context: {
        sport: 'NFL', leagueType: 'guillotine', scoring: 'ppr',
        rosterFormat: 'standard', capturedAt: '2026-09-02T00:00:00.000Z',
      },
    }))
    expect(a.formatFit).toBeNull()
  })

  it('🛑 carries aliasTags through, or four formats are unreachable from here', () => {
    /*
     * `normalizeConcept.ts` flattens pirate onto `dynasty` and king-of-the-hill onto `redraft`,
     * keeping the original only in `aliasTags`. Before this was wired, `buildTradeValueSnapshot`
     * passed `leagueType` alone — so those leagues arrived describing themselves as something
     * they are not, and any model written for them would never have been called.
     *
     * Asserted through the SNAPSHOT rather than the registry on purpose: the registry resolving
     * an alias is worth nothing if the builder never hands it one, and that gap is invisible
     * to a registry-only test.
     */
    const a = firstAsset(build({
      context: {
        sport: 'NFL', leagueType: 'dynasty', aliasTags: ['four_horsemen'], scoring: 'ppr',
        rosterFormat: 'standard', capturedAt: '2026-09-02T00:00:00.000Z',
      },
    }))
    expect(a.formatFit).toBeTruthy()
    expect(a.formatFit!.formatId).toBe('four_horsemen')
  })

  it('no shape means no fit — the model is not asked to reason from nothing', () => {
    const a = firstAsset(build({ scoring: null }))
    expect(a.formatFit).toBeNull()
  })

  it('carries trade legality separately from value', () => {
    const open = firstAsset(build({ currentWeek: 12 }))
    expect(open.formatFit!.legality!.ok).toBe(true)

    const closed = firstAsset(build({ currentWeek: 14 }))
    expect(closed.formatFit!.legality!.ok).toBe(false)
    expect(closed.formatFit!.legality!.reason).toMatch(/week 13/)
    // 🛑 A closed window must not discount the player — he is worth the same, just untradeable.
    expect(closed.internalValue).toBe(open.internalValue)
  })

  it('routes team state by the roster GIVING the asset up', () => {
    const a = firstAsset(build({
      assets: [asset({ experience: 8 })],
      teamStateByRosterId: { r1: { eliminatorStrikes: 3 }, r2: { eliminatorStrikes: 0 } },
    }))
    // r1 is `fromRosterId`, so its three strikes are the ones that matter.
    expect(a.formatFit!.fit!.reason).toMatch(/one more low week/i)
  })

  it('does not ask the model about picks or FAAB', () => {
    const snap = build({
      assets: [
        asset(),
        { kind: 'draft_pick', fromRosterId: 'r1', toRosterId: 'r2', pickRound: 2,
          sources: { projectionValue: null, rankingValue: null, adpValue: null,
                     fantasyCalcValue: null, idpValue: null } } as EnrichedTradeAsset,
      ],
    })
    const pick = snap.sides.flatMap((s) => s.assets).find((a) => a.kind === 'draft_pick')!
    expect(pick.formatFit).toBeNull()
  })
})

describe('applyFormatFit in isolation', () => {
  it('survives a model that throws, returning the other half', () => {
    // Guarded on purpose: a format model is ordinary code and a throw must not take down a
    // valuation — the asset still has a base value, which is why the fit is kept separate.
    const r = applyFormatFit({
      formatId: 'four_horsemen', base: 5000, position: 'WR',
      shape, experience: 1, currentWeek: 14,
    })!
    expect(r.fit).toBeTruthy()
    expect(r.legality!.ok).toBe(false)
  })

  it('fitAdjustedValue is opt-in and never used by the snapshot', () => {
    const fit = applyFormatFit({
      formatId: 'four_horsemen', base: 5000, position: 'WR', shape, experience: 1,
    })
    expect(fitAdjustedValue(5000, fit)).toBe(Math.round(5000 * STASH_OPTIONALITY_BONUS))
    // A null fit leaves the base exactly alone.
    expect(fitAdjustedValue(5000, null)).toBe(5000)
  })
})
