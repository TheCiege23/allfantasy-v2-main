/**
 * A guillotine league must be able to reach `guillotineModel`.
 *
 * 🛑 IT COULD NOT, AND THE MODEL HAD NEVER ONCE BEEN SELECTED IN PRODUCTION. `captureSnapshot.ts`
 * — the path that prices trades for these leagues — hardcoded `leagueType: 'redraft'` in the
 * `TradeValueContext` it built. The database knew the format; the engine was told something else.
 *
 * Measured against production on 2026-09-04: 12 guillotine leagues, 2 zombie, 1 survivor, **231
 * rosters between them**, every one carrying a redraft season — so `captureSnapshot` is genuinely
 * their trade path, not a theoretical one. Those leagues are real and paid ($20/$30 entry, newest
 * created the same day).
 *
 * ⚠ THE TESTS BELOW ASSERT REACHABILITY, NOT A PRICE. `guillotineModel.adjust` needs live state
 * (`teamsRemaining` / `startingTeams`) and returns null without it, which is correct — a model that
 * invented a field count would be worse than one that declines. So `fit` being null here is the
 * honest outcome and is asserted as such. What changed is that the model is now ASKED.
 */

import { describe, expect, it } from 'vitest'
import { applyFormatFit } from '@/lib/trade-value/formats/applyFormat'
import { buildLeagueShape } from '@/lib/trade-value/leagueShape'
import { readConceptAliasTags } from '@/lib/league-contract/conceptAliasTags'

/** An 18-team guillotine field, the modal size across the 12 real leagues. */
const shape = buildLeagueShape({
  teams: 18,
  starterSlots: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF'],
  rosterSize: 16,
  irSlots: 2,
  taxiSlots: 0,
  deadlineWeek: 13,
})!

/**
 * The EXACT settings shape read out of production, including the nesting that matters.
 * Verbatim from `leagues.settings` for league `1e857033-…`, one of the 12.
 */
const REAL_GUILLOTINE_SETTINGS = {
  conceptRules: {
    concept: 'guillotine',
    version: 1,
    extensions: {
      aliasTags: ['idp'],
      importSource: 'sleeper',
      sourceLeagueId: '1315208864072749056',
      importMetadata: {
        externalLeagueId: '1315208864072749056',
        externalSeasonId: '2026',
        normalizationVersion: '2',
      },
    },
  },
}

describe('🛑 readConceptAliasTags finds the tags where they actually live', () => {
  it('reads them from conceptRules.extensions, the path the writer uses', () => {
    expect(readConceptAliasTags(REAL_GUILLOTINE_SETTINGS)).toEqual(['idp'])
  })

  it('🛑 the obvious path returns nothing, which is how the first census got it wrong', () => {
    /*
     * Asserting the NEGATIVE deliberately. A census asking `conceptRules.aliasTags` returned null
     * for all 271 leagues and read as "no league has ever carried an alias tag". 183 of 271 do.
     * Pinning the shape means a future reader written against the shallow path fails here rather
     * than silently finding nothing in production.
     */
    const shallow = (REAL_GUILLOTINE_SETTINGS.conceptRules as Record<string, unknown>).aliasTags
    expect(shallow).toBeUndefined()
  })

  it('degrades to an empty list rather than throwing on anything malformed', () => {
    expect(readConceptAliasTags(null)).toEqual([])
    expect(readConceptAliasTags(undefined)).toEqual([])
    expect(readConceptAliasTags('not an object')).toEqual([])
    expect(readConceptAliasTags({})).toEqual([])
    expect(readConceptAliasTags({ conceptRules: {} })).toEqual([])
    expect(readConceptAliasTags({ conceptRules: { extensions: { aliasTags: 'nope' } } })).toEqual([])
    expect(readConceptAliasTags({ conceptRules: { extensions: { aliasTags: [1, null, 'IDP '] } } }))
      .toEqual(['idp'])
  })
})

describe('🛑 a real guillotine league now reaches its model', () => {
  /** Exactly what `captureSnapshot` now assembles for one of the 12. */
  const realLeagueFit = () =>
    applyFormatFit({
      formatId: 'guillotine',
      aliasTags: readConceptAliasTags(REAL_GUILLOTINE_SETTINGS),
      isDynasty: false,
      keeperCount: 0,
      base: 5000,
      position: 'WR',
      shape,
      currentWeek: 4,
    })

  it('resolves to guillotine, not redraft', () => {
    const fit = realLeagueFit()
    expect(fit).toBeTruthy()
    expect(fit!.formatId).toBe('guillotine')
  })

  it('🛑 the idp alias does NOT hijack it back to redraft', () => {
    /*
     * These leagues carry `aliasTags: ['idp']`, and `idp` maps to redraft in the concept chain.
     * `readFormatRules` used to let any alias override `leagueType`, which turned all 11 of the
     * guillotine leagues carrying that tag into redrafts. Both halves of the fix have to hold at
     * once for this to pass: the tag must be read, AND it must not be treated as a format.
     */
    expect(realLeagueFit()!.formatId).toBe('guillotine')
  })

  it('declines to price without live state, and says so by returning null', () => {
    // No `teamState`, so no `teamsRemaining`. Null is the honest answer, not a bug.
    expect(realLeagueFit()!.fit).toBeNull()
  })

  it('prices once the field has actually shrunk', () => {
    const fit = applyFormatFit({
      formatId: 'guillotine',
      aliasTags: ['idp'],
      base: 5000,
      position: 'WR',
      shape,
      currentWeek: 4,
      teamState: { teamsRemaining: 10, startingTeams: 18, eliminated: false },
    })
    expect(fit!.fit).toBeTruthy()
    expect(fit!.fit!.multiplier).toBeLessThan(1)
    expect(fit!.fit!.reason).toMatch(/10 of 18/)
  })

  it('🛑 hardcoding redraft — the old behaviour — reaches no model at all', () => {
    /*
     * The regression this file exists to prevent, stated as an assertion. If someone reinstates a
     * literal in `captureSnapshot`'s context, the format is gone and nothing downstream can tell.
     */
    const asRedraft = applyFormatFit({
      formatId: 'redraft',
      aliasTags: ['idp'],
      base: 5000,
      position: 'WR',
      shape,
      currentWeek: 4,
      teamState: { teamsRemaining: 10, startingTeams: 18, eliminated: false },
    })
    expect(asRedraft).toBeNull()
  })
})
