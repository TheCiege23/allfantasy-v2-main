import { describe, expect, it } from 'vitest'

import { readFormatRules } from '@/lib/trade-intel/leagueFormatRules'

/*
 * `readFormatRules` reads the human-confirmed concept before the column.
 *
 * Since 2026-09-16 the `League.leagueType` column only ever holds a base format
 * (lib/career/leagueTypeConfirmation.ts `leagueTypeColumnFor`): a confirmed
 * Pirate league's column says `dynasty` or `redraft`, a Survivor Guillotine
 * league's says `guillotine`, an EFL league's says `dynasty`. The specialty is
 * in `settings.leagueTypeConfirmation.type`, and an importer may rewrite the
 * column at any time.
 */

const confirmed = (type: string, extra: Record<string, unknown> = {}) => ({
  leagueTypeConfirmation: { type, confirmedByUserId: 'commish', ...extra },
})

describe('the confirmed concept is read first', () => {
  it.each([
    ['pirate', 'dynasty', 'pirate', null],
    ['pirate', 'redraft', 'pirate', null],
    ['survivor_guillotine', 'guillotine', 'guillotine', 'survivor_guillotine'],
    ['survivor_guillotine', 'redraft', 'guillotine', 'survivor_guillotine'],
    ['efl', 'dynasty', 'dynasty', null],
    ['efl', 'redraft', 'dynasty', null],
    ['zombie', 'redraft', 'zombie', null],
    ['devy', 'redraft', 'devy', null],
  ])('confirmed %s over a %s column reads as %s (variant %s)', (type, column, concept, variant) => {
    const rules = readFormatRules({ leagueType: column, settings: confirmed(type) })
    expect(rules.concept).toBe(concept)
    expect(rules.variant).toBe(variant)
  })

  /*
   * The label mapping applies to the CONFIRMATION only. A column holding a
   * specialty id with no confirmation behind it reads exactly as before — the
   * commissioner-OS profile pins `survivor_guillotine` in the column to `other`
   * so a template can supply the base (__tests__/commissioner-os/leagueProfile).
   */
  it('does not reinterpret a specialty id sitting in the column without a confirmation', () => {
    expect(readFormatRules({ leagueType: 'survivor_guillotine' })).toMatchObject({
      concept: 'other',
      variant: null,
    })
    expect(readFormatRules({ leagueType: 'efl' }).concept).toBe('other')
    expect(readFormatRules({ leagueType: 'pirate' }).concept).toBe('pirate')
  })

  it('a confirmed specialty outranks a format alias', () => {
    const rules = readFormatRules({
      leagueType: 'redraft',
      aliasTags: ['king_of_the_hill'],
      settings: confirmed('survivor_guillotine'),
    })
    expect(rules.concept).toBe('guillotine')
  })

  /*
   * The picker has no King of the Hill option. A KOTH commissioner who confirms
   * the base their league was flattened onto is not saying it stopped being KOTH.
   */
  it('a confirmed bare base yields to a format alias', () => {
    expect(
      readFormatRules({ leagueType: 'redraft', aliasTags: ['king_of_the_hill'], settings: confirmed('redraft') })
        .concept,
    ).toBe('king_of_the_hill')
    expect(
      readFormatRules({ leagueType: 'dynasty', aliasTags: ['pirate_vampire'], settings: confirmed('dynasty') })
        .concept,
    ).toBe('pirate')
    // …and wins over the column when there is no alias.
    expect(readFormatRules({ leagueType: 'redraft', settings: confirmed('dynasty') }).concept).toBe('dynasty')
  })
})

describe('a league with no confirmation reads exactly as before', () => {
  it.each([
    [{ leagueType: 'guillotine' }, 'guillotine'],
    [{ leagueType: 'dynasty' }, 'dynasty'],
    [{ leagueType: 'redraft' }, 'redraft'],
    [{ leagueType: 'redraft', aliasTags: ['king_of_the_hill'] }, 'king_of_the_hill'],
    [{ leagueType: 'dynasty', aliasTags: ['pirate_vampire'] }, 'pirate'],
    [{ leagueType: null, isDynasty: true }, 'dynasty'],
    [{ leagueType: 'best-ball' }, 'other'],
  ])('%o → %s', (league, concept) => {
    const rules = readFormatRules({ ...league, settings: { scoring_settings: { rec: 1 } } })
    expect(rules.concept).toBe(concept)
    expect(rules.variant).toBeNull()
    expect(readFormatRules(league).concept).toBe(concept)
  })

  it('a plain guillotine league never carries the survivor-guillotine marker', () => {
    expect(readFormatRules({ leagueType: 'guillotine', settings: {} }).variant).toBeNull()
    expect(readFormatRules({ leagueType: 'guillotine', settings: confirmed('guillotine') }).variant).toBeNull()
  })

  it('ignores a malformed confirmation', () => {
    expect(
      readFormatRules({ leagueType: 'dynasty', settings: { leagueTypeConfirmation: { type: 'not_a_format' } } })
        .concept,
    ).toBe('dynasty')
    expect(readFormatRules({ leagueType: 'dynasty', settings: { leagueTypeConfirmation: 'pirate' } }).concept).toBe(
      'dynasty',
    )
  })
})
