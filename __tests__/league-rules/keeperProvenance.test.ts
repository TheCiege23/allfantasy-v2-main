import { describe, expect, it } from 'vitest'

import {
  buildKeeperProvenance,
  keeperProvenanceFromCommissionerSave,
  keeperSettingsConfirmedFrom,
  readKeeperProvenance,
  KEEPER_PROVENANCE_VERSION,
} from '@/lib/league-contract/keeperProvenance'
import { resolveLeagueRules } from '@/lib/league-rules'
import { LEAGUE_COLUMN_DEFAULTS, readFormatRules } from '@/lib/trade-intel/leagueFormatRules'
import { formatModelFor, formatModelForLeague } from '@/lib/trade-value/formats/registry'

/**
 * The eight required keeper-provenance cases, plus the pricing proof.
 *
 * 🛑 THE PROVIDER SIGNAL IS `is_keeper`, NOT `max_keepers`. The measurement is in
 * `lib/league-import/types.ts`: Sleeper's `max_keepers` is >= 1 on 225/225
 * imported leagues, dynasty and guillotine included, so "the payload contained a
 * keeper count" marks every league confirmed and reinstates the original bug.
 */

/** Settings JSON shaped the way the import writes it. */
function settingsWithProvenance(isKeeper: boolean, source: 'provider' | 'commissioner' | 'creation' = 'provider') {
  return {
    conceptRules: {
      extensions: { keeperProvenance: buildKeeperProvenance({ source, isKeeper }) },
    },
  }
}

const UNTOUCHED_COLUMNS = {
  keeperCount: LEAGUE_COLUMN_DEFAULTS.keeperCount,
  keeperCostSystem: LEAGUE_COLUMN_DEFAULTS.keeperCostSystem,
  keeperRoundPenalty: LEAGUE_COLUMN_DEFAULTS.keeperRoundPenalty,
} as const

describe('1. imported provider explicitly reports a keeper league', () => {
  const league = { leagueType: 'redraft', ...UNTOUCHED_COLUMNS, settings: settingsWithProvenance(true) }

  it('classifies as keeper even though every column is a default', () => {
    expect(readFormatRules(league).concept).toBe('keeper')
  })

  it('records that the caller confirmed it, not that a column differed', () => {
    // Pins WHICH signal fired; the concept alone passes with either branch gone.
    expect(readFormatRules(league).keeperEvidence).toBe('caller_confirmed')
  })

  it('reaches the same answer through resolveLeagueRules', () => {
    expect(resolveLeagueRules(league).concept?.id).toBe('keeper')
  })
})

describe('2. imported provider omits keeper data; row keeps the default three', () => {
  const league = { leagueType: 'redraft', ...UNTOUCHED_COLUMNS, settings: { conceptRules: { extensions: {} } } }

  it('is redraft, not keeper', () => {
    expect(readFormatRules(league).concept).toBe('redraft')
    expect(readFormatRules(league).keeperEvidence).toBeNull()
  })

  it('an absent provenance block reads as undefined, NOT as false', () => {
    /*
     * The distinction is load-bearing: `false` would mean "confirmed not a
     * keeper league" and would suppress the differs-from-default heuristic that
     * is the only signal an older row has.
     */
    expect(keeperSettingsConfirmedFrom(league.settings)).toBeUndefined()
  })

  it('a league with a non-default count still classifies via the heuristic', () => {
    const older = { leagueType: 'redraft', keeperCount: 5, settings: {} }
    expect(readFormatRules(older).keeperEvidence).toBe('configured_value')
  })
})

describe('3. explicit zero keepers', () => {
  it('provider-confirmed not-keeper is redraft', () => {
    const league = { leagueType: 'redraft', keeperCount: 0, settings: settingsWithProvenance(false) }
    expect(readFormatRules(league).concept).toBe('redraft')
  })

  it('🛑 a provider "not keeper" OUTRANKS a non-default column', () => {
    /*
     * A Sleeper league whose `settings.type` is 0 is a redraft league. It must
     * not be reclassified because its `keeperCount` happens to read 5 — the
     * provider's own statement is stronger than a differs-from-default guess.
     */
    const league = { leagueType: 'redraft', keeperCount: 5, settings: settingsWithProvenance(false) }
    expect(readFormatRules(league).concept).toBe('redraft')
    expect(readFormatRules(league).keeperEvidence).toBeNull()
  })

  it('a commissioner submitting keeperCount 0 records not-keeper', () => {
    const prov = keeperProvenanceFromCommissionerSave({
      submittedKeys: ['keeperCount'],
      body: { keeperCount: 0 },
    })
    expect(prov?.isKeeper).toBe(false)
  })
})

describe('4. commissioner confirms the default values without changing them', () => {
  /*
   * 🛑 THE CASE THE COLUMN CANNOT EXPRESS. A commissioner opens the settings
   * form and saves keeperCount: 3 unchanged. The row is byte-identical to a
   * league nobody ever touched, so only the ACT of submitting can record it.
   */
  const prov = keeperProvenanceFromCommissionerSave({
    submittedKeys: ['keeperCount'],
    body: { keeperCount: LEAGUE_COLUMN_DEFAULTS.keeperCount },
  })

  it('records provenance from the SUBMITTED KEY, not from a changed value', () => {
    expect(prov).not.toBeNull()
    expect(prov?.source).toBe('commissioner')
    expect(prov?.isKeeper).toBe(true)
  })

  it('and that provenance makes the league classify as keeper', () => {
    const league = {
      leagueType: 'redraft',
      ...UNTOUCHED_COLUMNS,
      settings: { conceptRules: { extensions: { keeperProvenance: prov } } },
    }
    expect(readFormatRules(league).concept).toBe('keeper')
  })

  it('a save touching no keeper field records nothing', () => {
    // The negative control: without it, any save would look like confirmation.
    expect(
      keeperProvenanceFromCommissionerSave({ submittedKeys: ['name', 'timezone'], body: { name: 'x' } })
    ).toBeNull()
  })

  it('a save naming only a cost system still confirms keepers exist', () => {
    const p = keeperProvenanceFromCommissionerSave({
      submittedKeys: ['keeperCostSystem'],
      body: { keeperCostSystem: 'round_based' },
    })
    expect(p?.isKeeper).toBe(true)
  })
})

describe('5. AllFantasy-created keeper league', () => {
  it('is keeper on its explicit concept, with or without provenance', () => {
    expect(readFormatRules({ leagueType: 'keeper', ...UNTOUCHED_COLUMNS }).keeperEvidence).toBe('explicit_concept')
  })

  it('an explicit concept is not overridden by a provider "not keeper"', () => {
    /*
     * `explicit_concept` is checked before the confirmation flag deliberately:
     * an AllFantasy keeper league is a keeper league whatever an importer once
     * said about some upstream row.
     */
    const league = { leagueType: 'keeper', ...UNTOUCHED_COLUMNS, settings: settingsWithProvenance(false) }
    expect(readFormatRules(league).concept).toBe('keeper')
  })
})

describe('6. refresh preserves or updates keeper provenance', () => {
  it('a re-import that still reports keeper keeps the league keeper', () => {
    const after = { leagueType: 'redraft', ...UNTOUCHED_COLUMNS, settings: settingsWithProvenance(true) }
    expect(readFormatRules(after).concept).toBe('keeper')
  })

  it('a refresh whose provider now reports NOT keeper flips it back', () => {
    /*
     * The block is rebuilt from the provider's current type on every sync
     * (`buildConceptRulesBlock` runs in `applySleeperLeagueSync` too), so a
     * league that stops being a keeper league stops being priced as one.
     */
    const after = { leagueType: 'redraft', keeperCount: 4, settings: settingsWithProvenance(false) }
    expect(readFormatRules(after).concept).toBe('redraft')
  })

  it('an unknown provenance VERSION is ignored rather than guessed at', () => {
    const future = {
      conceptRules: { extensions: { keeperProvenance: { version: KEEPER_PROVENANCE_VERSION + 99, source: 'provider', isKeeper: true } } },
    }
    expect(readKeeperProvenance(future)).toBeNull()
    expect(keeperSettingsConfirmedFrom(future)).toBeUndefined()
  })

  it('malformed provenance is ignored rather than throwing', () => {
    for (const bad of [null, undefined, 'x', 42, [], { conceptRules: 'no' }, { conceptRules: { extensions: { keeperProvenance: 7 } } }]) {
      expect(() => keeperSettingsConfirmedFrom(bad)).not.toThrow()
      expect(keeperSettingsConfirmedFrom(bad)).toBeUndefined()
    }
  })
})

describe('7/8. pricing follows classification, and only classification', () => {
  it('a CONFIRMED three-keeper league receives keeper pricing', () => {
    const league = { leagueType: 'redraft', ...UNTOUCHED_COLUMNS, settings: settingsWithProvenance(true) }
    expect(formatModelForLeague(league)).toBe(formatModelFor('keeper'))
  })

  it('🛑 an UNCONFIRMED default-three redraft league does NOT', () => {
    /*
     * The whole point. `keeperModel` applies a market-minus-contract discount;
     * applying it to a league with no keepers reprices every asset in it.
     */
    const league = { leagueType: 'redraft', ...UNTOUCHED_COLUMNS, settings: {} }
    expect(formatModelForLeague(league)).not.toBe(formatModelFor('keeper'))
  })

  it('and the keeper round-penalty note follows the same gate', () => {
    const confirmed = { leagueType: 'redraft', ...UNTOUCHED_COLUMNS, settings: settingsWithProvenance(true) }
    const unconfirmed = { leagueType: 'redraft', ...UNTOUCHED_COLUMNS, settings: {} }
    expect(readFormatRules(confirmed).notes.join(' ')).toContain('round earlier each year')
    expect(readFormatRules(unconfirmed).notes.join(' ')).not.toContain('round earlier each year')
  })
})
