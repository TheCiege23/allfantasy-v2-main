import { describe, expect, it } from 'vitest'

import { buildLeagueRulesGrounding } from '@/lib/chimmy/leagueRulesGrounding'
import {
  LEAGUE_COLUMN_DEFAULTS as DEFAULTS_VIA_LEAGUE_RULES,
  resolveLeagueRules,
} from '@/lib/league-rules'
import {
  LEAGUE_COLUMN_DEFAULTS,
  keeperEvidenceFor,
  readFormatRules,
} from '@/lib/trade-intel/leagueFormatRules'

/**
 * 🛑 PRODUCT DECISION, 2026-09-09: an untouched `League.keeperCount = 3` means
 * UNCONFIRMED, not "three keepers". A bare schema default must not classify a
 * redraft league as keeper, and must not activate keeper pricing.
 *
 * These are the seven required cases plus the pricing-path proof.
 */

/** A row exactly as Prisma creates it when nobody configures keepers. */
const UNTOUCHED = {
  leagueType: 'redraft',
  keeperCount: LEAGUE_COLUMN_DEFAULTS.keeperCount,
  keeperCostSystem: LEAGUE_COLUMN_DEFAULTS.keeperCostSystem,
  keeperRoundPenalty: LEAGUE_COLUMN_DEFAULTS.keeperRoundPenalty,
} as const

describe('1. untouched redraft with keeperCount=3', () => {
  it('is redraft, not keeper', () => {
    expect(readFormatRules(UNTOUCHED).concept).toBe('redraft')
  })

  it('records that there is no evidence, rather than silently deciding', () => {
    // Pins WHICH signal fired. Asserting the concept alone passes with either branch gone.
    expect(readFormatRules(UNTOUCHED).keeperEvidence).toBeNull()
  })

  it('emits the redraft note, not the keeper note', () => {
    const notes = readFormatRules(UNTOUCHED).notes.join(' ')
    expect(notes).toContain('no future picks to trade')
    expect(notes).not.toContain('Keeper league')
  })

  it('tells Chimmy the keeper status is unconfirmed instead of hiding it', () => {
    const text = buildLeagueRulesGrounding(UNTOUCHED) ?? ''
    expect(text).toContain('Keeper status: UNCONFIRMED')
    expect(text).toContain('do not apply keeper trade maths')
  })
})

describe('2. explicit redraft with zero keepers', () => {
  const zero = { ...UNTOUCHED, keeperCount: 0 }

  it('is redraft', () => {
    expect(readFormatRules(zero).concept).toBe('redraft')
  })

  it('counts as configured evidence — somebody chose zero', () => {
    /*
     * Evidence means "somebody decided", not "somebody decided yes". Zero
     * differs from the default, so it was written; `keeperCount > 0` at the
     * call site is what keeps it out of the keeper branch.
     */
    expect(readFormatRules(zero).keeperEvidence).toBe('configured_value')
  })

  it('says nothing about unconfirmed keepers, because there are none', () => {
    expect(buildLeagueRulesGrounding(zero) ?? '').not.toContain('Keeper status: UNCONFIRMED')
  })
})

describe('3. confirmed keeper league with three keepers', () => {
  const explicit = { ...UNTOUCHED, leagueType: 'keeper' }

  it('is keeper on the explicit concept alone, however the columns read', () => {
    expect(readFormatRules(explicit).concept).toBe('keeper')
    expect(readFormatRules(explicit).keeperEvidence).toBe('explicit_concept')
  })

  it('still reports three keepers', () => {
    expect(readFormatRules(explicit).maxKeepers).toBe(3)
  })

  it('an AllFantasy-created keeper league is unaffected by this change', () => {
    // The create path writes leagueType, so it takes the explicit branch.
    expect(readFormatRules({ leagueType: 'keeper', keeperCount: 3 }).concept).toBe('keeper')
  })
})

describe('4. provider-confirmed keeper settings', () => {
  it('classifies as keeper when the caller proves the value was reported', () => {
    const confirmed = { ...UNTOUCHED, keeperSettingsConfirmed: true }
    expect(readFormatRules(confirmed).concept).toBe('keeper')
    expect(readFormatRules(confirmed).keeperEvidence).toBe('caller_confirmed')
  })

  it('a non-default count is evidence on its own, with no caller flag', () => {
    const five = { ...UNTOUCHED, keeperCount: 5 }
    expect(readFormatRules(five).concept).toBe('keeper')
    expect(readFormatRules(five).keeperEvidence).toBe('configured_value')
  })

  it('a non-default cost system is evidence even when the count sits on the default', () => {
    const auction = { ...UNTOUCHED, keeperCostSystem: 'auction_pct' }
    expect(readFormatRules(auction).concept).toBe('keeper')
  })

  it('a non-default round penalty is evidence too', () => {
    expect(readFormatRules({ ...UNTOUCHED, keeperRoundPenalty: 2 }).concept).toBe('keeper')
  })

  it('absent means unconfirmed — the flag is never assumed true', () => {
    // The default is the whole fix: every existing caller passes nothing.
    expect(keeperEvidenceFor(UNTOUCHED)).toBeNull()
    expect(keeperEvidenceFor({ ...UNTOUCHED, keeperSettingsConfirmed: false })).toBeNull()
  })
})

describe('5. dynasty plus IDP aliases are untouched by the keeper rule', () => {
  const dynastyIdp = {
    leagueType: 'dynasty',
    isDynasty: true,
    aliasTags: ['idp'],
    ...{ keeperCount: LEAGUE_COLUMN_DEFAULTS.keeperCount },
  }

  it('stays dynasty', () => {
    expect(readFormatRules(dynastyIdp).concept).toBe('dynasty')
  })

  it('keeps future picks tradeable', () => {
    expect(readFormatRules(dynastyIdp).futurePicksTradeable).toBe(true)
  })

  it('resolves through the catalog as dynasty with idp as a modifier', () => {
    const resolved = resolveLeagueRules({
      leagueType: 'dynasty',
      isDynasty: true,
      keeperCount: LEAGUE_COLUMN_DEFAULTS.keeperCount,
      settings: { conceptRules: { extensions: { aliasTags: ['idp'] } } },
    })
    expect(resolved.concept?.id).toBe('dynasty')
    expect(resolved.modifiers.map((m) => m.id)).toEqual(['idp'])
  })

  it('KOTH on a redraft shell is unaffected by the keeper default', () => {
    const koth = resolveLeagueRules({
      leagueType: 'redraft',
      keeperCount: LEAGUE_COLUMN_DEFAULTS.keeperCount,
      settings: { conceptRules: { extensions: { aliasTags: ['king_of_the_hill'] } } },
    })
    expect(koth.concept?.id).toBe('king_of_the_hill')
  })
})

describe('6. missing imported keeper information', () => {
  it('a null count is not a keeper league and not an error', () => {
    const missing = { leagueType: 'redraft', keeperCount: null }
    expect(readFormatRules(missing).concept).toBe('redraft')
    expect(readFormatRules(missing).keeperEvidence).toBeNull()
  })

  it('an unknown cost system stays unknown rather than defaulting', () => {
    const resolved = resolveLeagueRules({ leagueType: 'keeper', keeperCount: 2 })
    expect(resolved.keeper.costSystem.provenance).toBe('unknown')
    expect(resolved.keeper.costSystem.value).toBeNull()
  })

  it('never reports an unknown future-pick rule as tradeable', () => {
    const resolved = resolveLeagueRules({ leagueType: 'keeper', keeperCount: 2 })
    expect(resolved.keeper.futurePicksTradeable.value).not.toBe(true)
  })
})

describe('7. the schema default does not activate keeper PRICING', () => {
  /*
   * 🛑 THE POINT OF THE WHOLE CHANGE. Both keeper pricing paths gate on
   * `readFormatRules(...).concept === 'keeper'`:
   *   - lib/trade-value/formats/registry.ts selects the keeper model on it;
   *   - lib/trade-intel/tradeContextNotes.ts returns early on
   *     `rules.concept !== 'keeper'` before it can reach keeperDriftNote.
   * So proving the concept is not 'keeper' proves neither adjustment fires —
   * which is why the fix belongs in the classifier and not in a second gate.
   */
  it('an untouched row does not reach the keeper concept that both gates select on', () => {
    expect(readFormatRules(UNTOUCHED).concept).not.toBe('keeper')
  })

  it('and does not emit the keeper round-penalty note that keeper pricing narrates', () => {
    // keeperRoundPenalty=1 is on the row; the note is gated on the concept.
    const notes = readFormatRules(UNTOUCHED).notes.join(' ')
    expect(notes).not.toContain('round earlier each year')
  })

  it('a genuinely configured keeper league still gets both', () => {
    // The positive control: without this, the test above passes with keeper pricing deleted.
    const real = readFormatRules({ ...UNTOUCHED, keeperCount: 4 })
    expect(real.concept).toBe('keeper')
    expect(real.notes.join(' ')).toContain('round earlier each year')
  })

  it('futurePicksTradeable flips from a redraft FALSE to a keeper UNKNOWN', () => {
    /*
     * These are different claims and the difference is the bug's blast radius:
     * false means "no such asset exists", null means "we do not know whether
     * the commissioner opened pick trading". An untouched redraft league must
     * say the former.
     */
    expect(readFormatRules(UNTOUCHED).futurePicksTradeable).toBe(false)
    expect(readFormatRules({ ...UNTOUCHED, keeperCount: 4 }).futurePicksTradeable).toBeNull()
  })
})

describe('the mirrored column defaults still match prisma/schema.prisma', () => {
  it('has exactly one definition site', () => {
    /*
     * Re-exported from leagueFormatRules rather than redefined in league-rules.
     * Two implementations of one rule is the bug; identity proves there is one.
     */
    expect(DEFAULTS_VIA_LEAGUE_RULES).toBe(LEAGUE_COLUMN_DEFAULTS)
  })
})
