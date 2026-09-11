import { describe, it, expect } from 'vitest'
import { resolveSuperflex } from '@/lib/trade-value/superflexResolution'

/**
 * The rule `/api/trade-evaluator` used to get wrong with `qb_format: z.enum(...).default('sf')`.
 *
 * These live here rather than in the route contract suite because that suite cannot reach a
 * graded response at all — its only 200 comes from a mocked cache hit, and a real run dies in
 * `pricePlayer` without a database. A test that cannot exercise the code is not coverage.
 */
describe('resolveSuperflex', () => {
  describe('the league outranks everything', () => {
    it('reads SUPER_FLEX off the roster', () => {
      expect(resolveSuperflex({ leagueRoster: { superflex: true, startingQB: 1 } }))
        .toEqual({ isSuperflex: true, basis: 'league_roster' })
    })

    it('treats a true 2QB league as superflex, which the SUPER_FLEX flag alone misses', () => {
      // Two plain QB starters, no SUPER_FLEX slot. Prices like superflex; FantasyCalc agrees
      // by modelling both as numQbs: 2.
      expect(resolveSuperflex({ leagueRoster: { superflex: false, startingQB: 2 } }))
        .toEqual({ isSuperflex: true, basis: 'league_roster' })
    })

    it('overrides a caller who contradicts the roster, in BOTH directions', () => {
      expect(resolveSuperflex({ leagueRoster: { superflex: true, startingQB: 1 }, declared: '1qb' }))
        .toEqual({ isSuperflex: true, basis: 'league_roster' })
      expect(resolveSuperflex({ leagueRoster: { superflex: false, startingQB: 1 }, declared: 'sf' }))
        .toEqual({ isSuperflex: false, basis: 'league_roster' })
    })
  })

  describe('no league — the caller is testimony, not evidence', () => {
    it('honours an explicit declaration and labels it', () => {
      expect(resolveSuperflex({ declared: 'sf' })).toEqual({ isSuperflex: true, basis: 'caller' })
      expect(resolveSuperflex({ declared: '1qb' })).toEqual({ isSuperflex: false, basis: 'caller' })
    })
  })

  /*
   * 🛑 THE REGRESSION THIS FILE EXISTS FOR. If any of these ever returns `isSuperflex: true`,
   * the silent superflex default is back and every QB is being priced off the scarcer board.
   */
  describe('nobody knows', () => {
    it.each([
      [{}, 'nothing supplied'],
      [{ declared: null }, 'explicit null'],
      [{ leagueRoster: null }, 'league looked up and absent'],
      [{ leagueRoster: null, declared: null }, 'both absent'],
      [{ leagueRoster: undefined, declared: undefined }, 'both undefined'],
    ])('assumes 1QB and says so (%#: %s)', (input) => {
      const r = resolveSuperflex(input as Parameters<typeof resolveSuperflex>[0])
      expect(r.isSuperflex).toBe(false)
      expect(r.basis).toBe('assumed_1qb')
    })

    it('never reports an assumption as evidence', () => {
      expect(resolveSuperflex({}).basis).not.toBe('league_roster')
      expect(resolveSuperflex({}).basis).not.toBe('caller')
    })
  })

  it('is deterministic', () => {
    const input = { leagueRoster: { superflex: false, startingQB: 2 }, declared: '1qb' as const }
    expect(resolveSuperflex(input)).toEqual(resolveSuperflex(input))
  })
})
