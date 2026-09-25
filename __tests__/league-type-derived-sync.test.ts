import { describe, expect, it } from 'vitest'

import {
  deriveLeagueTypeState,
  leagueColumnsForType,
  mergeSettingsForLeagueType,
} from '@/lib/league/leagueTypeDerivedSync'

/**
 * The commissioner's League-type choice has to reach the fields that price trades.
 * Saving the label alone is how production ended up with leagues whose `leagueType` and
 * `isDynasty` disagree, so these tests hold the implication in place.
 */

const NOW = new Date('2026-09-20T17:00:00.000Z')

describe('what a league type implies', () => {
  it('turns Dynasty into the dynasty market board', () => {
    const derived = deriveLeagueTypeState('dynasty')!
    expect(derived.isDynasty).toBe(true)
    expect(derived.formatId).toBe('dynasty')
  })

  it('leaves Keeper on the redraft board', () => {
    // A keeper league redrafts most of its roster; it prices off redraft and then takes
    // a keeper-cost adjustment. Swapping the whole board would be a much larger change.
    const derived = deriveLeagueTypeState('keeper')!
    expect(derived.isDynasty).toBe(false)
    expect(derived.formatId).toBe('keeper')
  })

  it('sets the elimination-format flags only for their own formats', () => {
    expect(deriveLeagueTypeState('guillotine')!.guillotineMode).toBe(true)
    expect(deriveLeagueTypeState('survivor')!.survivorMode).toBe(true)
    expect(deriveLeagueTypeState('best_ball')!.bestBallMode).toBe(true)

    const redraft = deriveLeagueTypeState('redraft')!
    expect(redraft.guillotineMode).toBe(false)
    expect(redraft.survivorMode).toBe(false)
    expect(redraft.bestBallMode).toBe(false)
  })

  it('clears a specialty flag when the league converts away from it', () => {
    // Derived strictly from the NEW type. Carrying guillotineMode forward "to be safe"
    // would leave a redraft league running elimination rules.
    expect(leagueColumnsForType(deriveLeagueTypeState('redraft')!)).toEqual({
      isDynasty: false,
      guillotineMode: false,
      survivorMode: false,
      bestBallMode: false,
    })
  })

  it('resolves a flattened product concept to its base format and keeps the flavor tag', () => {
    const pirate = deriveLeagueTypeState('pirate_vampire')!
    expect(pirate.formatId).toBe('dynasty')
    expect(pirate.isDynasty).toBe(true)
    expect(pirate.aliasTags).toContain('pirate_vampire')

    const koth = deriveLeagueTypeState('king_of_the_hill')!
    expect(koth.formatId).toBe('redraft')
    expect(koth.aliasTags).toContain('king_of_the_hill')
  })

  it('returns null for an unknown type rather than guessing a lifecycle', () => {
    for (const bad of ['', null, undefined, 'not_a_format']) {
      expect(deriveLeagueTypeState(bad)).toBeNull()
    }
  })
})

describe('merging into settings', () => {
  const imported = {
    importSourceNote: 'keep me',
    conceptRules: {
      concept: 'redraft',
      version: 1,
      extensions: {
        aliasTags: ['idp'],
        importSource: 'sleeper',
        keeperProvenance: { at: '2026-09-01T00:00:00.000Z', source: 'provider' },
      },
    },
  }

  it('updates the concept and stamps who chose it', () => {
    const next = mergeSettingsForLeagueType(
      imported,
      deriveLeagueTypeState('dynasty')!,
      'dynasty',
      NOW,
    )
    const concept = next.conceptRules as Record<string, unknown>
    const ext = concept.extensions as Record<string, unknown>

    expect(concept.concept).toBe('dynasty')
    expect(ext.leagueTypeProvenance).toMatchObject({
      source: 'commissioner',
      leagueType: 'dynasty',
      formatId: 'dynasty',
      at: NOW.toISOString(),
    })
  })

  it('preserves imported alias tags and every unrelated key', () => {
    // An IDP dynasty is still IDP after a switch to keeper. Tags describe flavor the
    // lifecycle does not encode, and they were imported rather than chosen here.
    const next = mergeSettingsForLeagueType(
      imported,
      deriveLeagueTypeState('keeper')!,
      'keeper',
      NOW,
    )
    const ext = (next.conceptRules as Record<string, unknown>).extensions as Record<string, unknown>

    expect(ext.aliasTags).toEqual(['idp'])
    expect(ext.importSource).toBe('sleeper')
    expect(ext.keeperProvenance).toEqual(imported.conceptRules.extensions.keeperProvenance)
    expect(next.importSourceNote).toBe('keep me')
  })

  it('unions a new flavor tag without duplicating an existing one', () => {
    const next = mergeSettingsForLeagueType(
      imported,
      deriveLeagueTypeState('pirate_vampire')!,
      'pirate_vampire',
      NOW,
    )
    const ext = (next.conceptRules as Record<string, unknown>).extensions as Record<string, unknown>
    expect(ext.aliasTags).toEqual(['idp', 'pirate_vampire'])

    const again = mergeSettingsForLeagueType(
      next,
      deriveLeagueTypeState('pirate_vampire')!,
      'pirate_vampire',
      NOW,
    )
    const extAgain = (again.conceptRules as Record<string, unknown>).extensions as Record<string, unknown>
    expect(extAgain.aliasTags).toEqual(['idp', 'pirate_vampire'])
  })

  it('builds valid settings for a league that has none yet', () => {
    const next = mergeSettingsForLeagueType(null, deriveLeagueTypeState('guillotine')!, 'guillotine', NOW)
    const concept = next.conceptRules as Record<string, unknown>
    const ext = concept.extensions as Record<string, unknown>

    expect(concept.concept).toBe('guillotine')
    expect(concept.version).toBe(1)
    expect(ext.aliasTags).toEqual([])
  })
})
