import { describe, expect, it } from 'vitest'

import { getFormatsForSport, listLeagueFormats } from '@/lib/league/format-engine'
import { deriveLeagueTypeState } from '@/lib/league/leagueTypeDerivedSync'

/**
 * The League-type control offered three of twelve formats while `leagueType` was only a
 * label. Now that it syncs `isDynasty` / `guillotineMode` / `survivorMode`, a type the
 * control cannot display is a type a commissioner can be converted out of by one click.
 *
 * These cover the registry contract the panel depends on. The panel itself keeps the
 * current league's type in its option list even when the sport does not offer it, which
 * is the case this suite cannot reach from here but the panel comment documents.
 */

/** Every `leagueType` value present in production on 2026-09-20. */
const LIVE_LEAGUE_TYPES = [
  'redraft',
  'dynasty',
  'tournament',
  'guillotine',
  'zombie',
  'survivor',
  'salary_cap',
  'keeper',
]

describe('the control can represent every league that exists', () => {
  it('has a registry definition for every live league type', () => {
    const known = new Set(listLeagueFormats().map((f) => f.id as string))
    for (const type of LIVE_LEAGUE_TYPES) {
      expect(known.has(type), `no format definition for "${type}"`).toBe(true)
    }
  })

  it('offers more than the three lifecycles the panel used to hardcode', () => {
    const offered = getFormatsForSport('NFL').map((f) => f.id as string)
    expect(offered).toEqual(expect.arrayContaining(['redraft', 'keeper', 'dynasty']))
    expect(offered.length).toBeGreaterThan(3)
  })

  it('gives every offered format a label and description the panel can render', () => {
    for (const format of getFormatsForSport('NFL')) {
      expect(format.label.trim().length).toBeGreaterThan(0)
      expect(format.description.trim().length).toBeGreaterThan(0)
    }
  })

  it('resolves every live type to derived state, so saving one is never a no-op', () => {
    // A type the control can show but the sync cannot resolve would save the label and
    // silently leave the valuation fields behind — the defect this whole change closes.
    for (const type of LIVE_LEAGUE_TYPES) {
      expect(deriveLeagueTypeState(type), `no derived state for "${type}"`).not.toBeNull()
    }
  })

  it('keeps the lifecycle flags mutually exclusive across every offered format', () => {
    for (const format of getFormatsForSport('NFL')) {
      const derived = deriveLeagueTypeState(format.id as string)
      if (!derived) continue
      const specialFlags = [derived.guillotineMode, derived.survivorMode, derived.bestBallMode]
      expect(
        specialFlags.filter(Boolean).length,
        `"${format.id}" set more than one specialty flag`,
      ).toBeLessThanOrEqual(1)
    }
  })
})
