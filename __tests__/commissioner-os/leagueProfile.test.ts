import { describe, expect, it } from 'vitest'

import { resolveCommissionerLeagueProfile } from '@/lib/commissioner-os/profile/resolveCommissionerLeagueProfile'
import { buildCommissionerTemplatePinFragment, readCommissionerTemplatePin } from '@/lib/commissioner-os/profile/templatePin'
import { resolveSpecialtyConceptKey } from '@/lib/specialty-automation/types'
import type { CommissionerLeagueRow } from '@/lib/commissioner-os/profile/resolveCommissionerLeagueProfile'

/**
 * Phase C0.5 — the canonical Commissioner OS league profile.
 *
 * 🛑 EVERY ASSERTION HERE PINS *WHICH* SIGNAL FIRED, NOT ONLY THAT THE ANSWER CAME OUT RIGHT.
 * `formatBasis` is checked alongside `canonicalFormatId` throughout, because a test asserting
 * `canonicalFormatId === 'redraft'` for King of the Hill passes with the alias-preservation branch
 * deleted — redraft is also what a broken resolver returns. Asserting `formatBasis:
 * 'flattened_base'` and `conceptId: 'king_of_the_hill'` is what makes the branch load-bearing.
 */

/** A league row shaped the way `normalizeConcept` actually stores an alias. */
function row(over: Partial<CommissionerLeagueRow> = {}): CommissionerLeagueRow {
  return {
    id: 'league-1',
    sport: 'NFL',
    season: 2026,
    leagueType: 'redraft',
    leagueVariant: null,
    isDynasty: false,
    settings: null,
    platform: 'allfantasy',
    status: 'active',
    lifecycleState: 'in_season',
    ...over,
  }
}

function aliasSettings(tags: string[], extra: Record<string, unknown> = {}) {
  return { conceptRules: { extensions: { aliasTags: tags, ...extra } } }
}

const profileFor = (r: CommissionerLeagueRow) =>
  resolveCommissionerLeagueProfile({ league: r, commissionerRole: 'commissioner' })

describe('plain formats resolve to themselves', () => {
  it('redraft', () => {
    const p = profileFor(row({ leagueType: 'redraft' }))
    expect(p.canonicalFormatId).toBe('redraft')
    expect(p.formatBasis).toBe('concept_id')
    expect(p.conceptId).toBe('redraft')
    expect(p.resolution).toBe('resolved')
  })

  it('dynasty', () => {
    const p = profileFor(row({ leagueType: 'dynasty', isDynasty: true }))
    expect(p.canonicalFormatId).toBe('dynasty')
    expect(p.conceptId).toBe('dynasty')
    expect(p.capabilityIds).toContain('roster.dynasty_carryover')
    expect(p.resolution).toBe('resolved')
  })

  it('keeper', () => {
    const p = profileFor(row({ leagueType: 'keeper' }))
    expect(p.canonicalFormatId).toBe('keeper')
    expect(p.conceptId).toBe('keeper')
    expect(p.capabilityIds).toContain('roster.keeper_carryover')
    /*
     * The keeper classification must come from the explicit concept, not from the column — every
     * row in this database carries `keeperCount @default(3)`.
     */
    expect(p.rules.keeperEvidence).toBe('explicit_concept')
  })

  it('best ball', () => {
    const p = profileFor(row({ leagueType: 'best_ball' }))
    expect(p.canonicalFormatId).toBe('best_ball')
    expect(p.conceptId).toBe('best_ball')
    expect(p.capabilityIds).toContain('lineup.best_ball')
    expect(p.resolution).toBe('resolved')
  })
})

describe('a flattened alias keeps its specialty identity', () => {
  it('Pirate/Vampire is Pirate/Vampire, priced on a dynasty shell', () => {
    const p = profileFor(
      row({ leagueType: 'dynasty', isDynasty: true, settings: aliasSettings(['pirate_vampire']) }),
    )

    expect(p.conceptId).toBe('pirate_vampire')
    expect(p.flattenedOnto).toBe('dynasty')
    expect(p.canonicalFormatId).toBe('dynasty')
    /* The branch that produced it, not just the value. */
    expect(p.formatBasis).toBe('flattened_base')
    expect(p.aliasTags).toContain('pirate_vampire')
    /* The specialty must not be demoted to a modifier — that is the failure this replaces. */
    expect(p.modifierIds).not.toContain('pirate_vampire')
    expect(p.capabilityIds).toContain('elimination.immunity')
  })

  it('King of the Hill is King of the Hill, on a redraft shell', () => {
    const p = profileFor(row({ leagueType: 'redraft', settings: aliasSettings(['king_of_the_hill']) }))

    expect(p.conceptId).toBe('king_of_the_hill')
    expect(p.flattenedOnto).toBe('redraft')
    expect(p.canonicalFormatId).toBe('redraft')
    expect(p.formatBasis).toBe('flattened_base')
    expect(p.modifierIds).not.toContain('king_of_the_hill')
  })
})

describe('IDP is a modifier and never replaces the host format', () => {
  it('a dynasty IDP league is still dynasty', () => {
    const p = profileFor(
      row({ leagueType: 'dynasty', isDynasty: true, settings: aliasSettings(['idp']) }),
    )

    /*
     * 🛑 THE MEASURED CASE. 183 of 271 production leagues carry `['idp']`, and reading the first
     * alias as a format demoted 97 dynasty leagues to redraft. The profile must not reintroduce it.
     */
    expect(p.canonicalFormatId).toBe('dynasty')
    expect(p.conceptId).toBe('dynasty')
    expect(p.modifierIds).toContain('idp')
    expect(p.capabilityIds).toContain('roster.dynasty_carryover')
    expect(p.capabilityIds).toContain('scoring.idp')
  })

  it('a guillotine IDP league is still guillotine', () => {
    const p = profileFor(row({ leagueType: 'guillotine', settings: aliasSettings(['idp']) }))
    expect(p.canonicalFormatId).toBe('guillotine')
    expect(p.capabilityIds).toContain('elimination.guillotine')
    expect(p.capabilityIds).toContain('scoring.idp')
  })
})

describe('an unknown format degrades honestly', () => {
  const p = profileFor(row({ leagueType: 'quidditch_survival' }))

  it('does NOT silently become redraft', () => {
    /*
     * 🛑 `toFormatId` in lib/league/format-engine.ts returns 'redraft' here and is right to, for a
     * create form. In Commissioner OS that default switches off every specialty behaviour a league
     * has and reports itself healthy.
     */
    expect(p.canonicalFormatId).toBeNull()
    expect(p.formatBasis).toBe('unresolved')
  })

  it('says so, with reasons', () => {
    expect(p.resolution).toBe('degraded')
    expect(p.degradedReasons).toContain('unknown_format')
    expect(p.degradedReasons).toContain('no_catalog_concept')
  })

  it('claims no capabilities it cannot justify', () => {
    expect(p.capabilityIds).toEqual([])
  })
})

describe('template pinning', () => {
  it('reads a pin from the documented settings path', () => {
    const settings = buildCommissionerTemplatePinFragment({
      id: 'efl_promotion_relegation_dynasty',
      version: '1.0.0',
    })
    expect(readCommissionerTemplatePin(settings)).toEqual({
      id: 'efl_promotion_relegation_dynasty',
      version: '1.0.0',
    })
  })

  it('a half-written pin is no pin at all', () => {
    const settings = { conceptRules: { extensions: { commissionerTemplate: { id: 'efl_promotion_relegation_dynasty' } } } }
    /*
     * ⚠ Returning `{ id, version: undefined }` would invite a caller to fill the gap from the
     * registry, which is the silent-upgrade failure the registry refuses to allow.
     */
    expect(readCommissionerTemplatePin(settings)).toBeNull()
  })

  it('binds a resolvable pin and contributes its capabilities', () => {
    const p = profileFor(
      row({
        leagueType: 'dynasty',
        isDynasty: true,
        settings: {
          conceptRules: {
            extensions: {
              aliasTags: ['efl_promotion_relegation'],
              commissionerTemplate: { id: 'efl_promotion_relegation_dynasty', version: '1.0.0' },
            },
          },
        },
      }),
    )

    expect(p.template?.key).toBe('efl_promotion_relegation_dynasty@1.0.0')
    expect(p.template?.definition).not.toBeNull()
    expect(p.canonicalFormatId).toBe('dynasty')
    expect(p.capabilityIds).toContain('roster.dynasty_carryover')
    expect(p.capabilityIds).toContain('standings.promotion_relegation')
    expect(p.resolution).toBe('resolved')
  })

  it('an unresolvable pin degrades rather than substituting a version we do have', () => {
    const p = profileFor(
      row({
        settings: {
          conceptRules: {
            extensions: {
              commissionerTemplate: { id: 'efl_promotion_relegation_dynasty', version: '9.9.9' },
            },
          },
        },
      }),
    )

    expect(p.template?.definition).toBeNull()
    expect(p.template?.unresolvedReason).toContain('efl_promotion_relegation_dynasty@9.9.9')
    expect(p.degradedReasons).toContain('template_pin_unresolved')
    expect(p.resolution).toBe('degraded')
  })

  it('a pinned template supplies the base format only when nothing else could', () => {
    const p = profileFor(
      row({
        leagueType: 'survivor_guillotine',
        settings: {
          conceptRules: {
            extensions: {
              commissionerTemplate: { id: 'survivor_all_stars_guillotine', version: '1.0.0' },
            },
          },
        },
      }),
    )

    expect(p.conceptId).toBe('survivor_guillotine')
    expect(p.canonicalFormatId).toBe('guillotine')
    expect(p.formatBasis).toBe('template_base')
  })

  it('a pin NEVER overrules a classified format', () => {
    /*
     * The Survivor All-Stars template declares `guillotine`. Pinned onto a dynasty league it must
     * not rewrite the format — the pin is the least-verified of the three inputs.
     */
    const p = profileFor(
      row({
        leagueType: 'dynasty',
        isDynasty: true,
        settings: {
          conceptRules: {
            extensions: {
              commissionerTemplate: { id: 'survivor_all_stars_guillotine', version: '1.0.0' },
            },
          },
        },
      }),
    )
    expect(p.canonicalFormatId).toBe('dynasty')
    expect(p.formatBasis).toBe('concept_id')
  })
})

describe('write authority is separate from commissioner role', () => {
  it('being commissioner of a Sleeper league does not confer external write access', () => {
    const p = resolveCommissionerLeagueProfile({
      league: row({ platform: 'sleeper' }),
      commissionerRole: 'commissioner',
    })
    expect(p.commissionerRole).toBe('commissioner')
    expect(p.writeAuthority).toBe('SHADOW')
  })

  it('a native league is NATIVE', () => {
    expect(profileFor(row({ platform: 'allfantasy' })).writeAuthority).toBe('NATIVE')
  })

  it('an unrecognised platform fails safe to SHADOW, never NATIVE', () => {
    expect(profileFor(row({ platform: 'some_new_host' })).writeAuthority).toBe('SHADOW')
  })
})

describe('no regression to the existing specialty pipeline', () => {
  /*
   * 🛑 THE ADDITIVE LAYER MUST NOT CHANGE WHAT `dispatchConceptHandler` DISPATCHES. The profile
   * carries the legacy key rather than deriving one from capabilities, so this asserts the carried
   * value is byte-identical to a direct call on the same row. Deriving it would have been a silent
   * behaviour change smuggled into a foundation phase.
   */
  const cases: Array<[string, CommissionerLeagueRow]> = [
    ['guillotine', row({ leagueType: 'guillotine' })],
    ['survivor', row({ leagueType: 'survivor', survivorMode: true })],
    ['big brother', row({ leagueType: 'big_brother' })],
    ['tournament', row({ leagueType: 'tournament' })],
    ['zombie', row({ leagueType: 'zombie' })],
    ['devy', row({ leagueType: 'devy' })],
    ['c2c', row({ leagueType: 'c2c' })],
    ['pirate/vampire', row({ leagueType: 'dynasty', settings: aliasSettings(['pirate_vampire']), leagueVariant: 'pirate_vampire' })],
    ['royal', row({ leagueType: 'dynasty', settings: aliasSettings(['royal']), leagueVariant: 'royal' })],
    ['king of the hill', row({ leagueType: 'redraft', settings: aliasSettings(['king_of_the_hill']), leagueVariant: 'king_of_the_hill' })],
    ['plain redraft', row({ leagueType: 'redraft' })],
  ]

  it.each(cases)('%s keeps its legacy concept key', (_label, r) => {
    const direct = resolveSpecialtyConceptKey({
      leagueType: r.leagueType ?? null,
      leagueVariant: r.leagueVariant ?? null,
      settings: (r.settings ?? null) as never,
      guillotineMode: r.guillotineMode ?? null,
      survivorMode: r.survivorMode ?? null,
    })
    expect(profileFor(r).legacySpecialtyConceptKey).toBe(direct)
  })
})

describe('the profile is deterministic', () => {
  it('produces byte-identical output for identical input', () => {
    const r = row({ leagueType: 'dynasty', isDynasty: true, settings: aliasSettings(['idp']) })
    expect(JSON.stringify(profileFor(r))).toBe(JSON.stringify(profileFor(r)))
  })
})
