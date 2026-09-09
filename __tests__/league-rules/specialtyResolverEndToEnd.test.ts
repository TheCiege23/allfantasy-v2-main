import { describe, expect, it } from 'vitest'

import { buildLeagueRulesGrounding } from '@/lib/chimmy/leagueRulesGrounding'
import { resolveLeagueRules } from '@/lib/league-rules'
import { readFormatRules } from '@/lib/trade-intel/leagueFormatRules'

/**
 * Specialty concepts through the REAL path Chimmy uses.
 *
 * 🛑 WHY THIS FILE EXISTS SEPARATELY FROM THE CATALOG TESTS. Those called
 * `getConceptById('royal')` and proved an entry existed. Chimmy never calls
 * `getConceptById` — it calls `resolveLeagueRules` and then renders. A catalog
 * entry nothing can resolve to is documentation, not behaviour, and the earlier
 * tests could not tell the two apart. Everything here goes resolver → grounding
 * and asserts on the FINAL STRING the model would receive.
 */

/** A league row shaped the way `normalizeConcept` actually stores an alias. */
const alias = (base: string, tags: string[], extra: Record<string, unknown> = {}) => ({
  leagueType: base,
  settings: { conceptRules: { extensions: { aliasTags: tags } } },
  ...extra,
})

describe('Royal: the product concept survives, and the pricing base is kept beside it', () => {
  const royal = alias('dynasty', ['royal'], { isDynasty: true })
  const resolved = resolveLeagueRules(royal)
  const text = buildLeagueRulesGrounding(royal) ?? ''

  it('resolves Royal as the PRIMARY concept, not dynasty', () => {
    expect(resolved.concept?.id).toBe('royal')
  })

  it('does not demote Royal to a modifier', () => {
    /*
     * The failure this replaces: Royal arrived as "Dynasty, plus a modifier
     * called Royal", which describes the shell and discards the format.
     */
    expect(resolved.modifiers.map((m) => m.id)).not.toContain('royal')
  })

  it('keeps dynasty as the PRICING base rather than erasing it', () => {
    // Both questions answered, neither collapsed into the other.
    expect(resolved.pricingBaseFormat).toBe('dynasty')
  })

  it('the classifier still prices it as dynasty — this change did not move pricing', () => {
    expect(readFormatRules({ leagueType: 'dynasty', aliasTags: ['royal'], isDynasty: true }).concept).toBe('dynasty')
  })

  it('the final grounding names Royal as the format AND dynasty as the pricing base', () => {
    expect(text).toContain('Format: Royal')
    expect(text).toContain('Priced as: dynasty')
    expect(text).toContain('describe the league as Royal')
  })
})

describe('Survivor All-Stars Guillotine reaches the final grounding, mechanics intact', () => {
  /*
   * ⚠ REACHED BY `leagueType`, AND NO PRODUCER EMITS IT YET. No classifier
   * branch and no import heuristic produces `survivor_guillotine` today, so a
   * league only resolves here if something set that leagueType. That is the
   * honest state and it is stated rather than papered over — what is proven
   * below is that the RESOLVER can carry it end to end, not that any production
   * row currently does.
   */
  const league = { leagueType: 'survivor_guillotine' }
  const resolved = resolveLeagueRules(league)
  const text = buildLeagueRulesGrounding(league) ?? ''

  it('resolves as its own concept', () => {
    expect(resolved.concept?.id).toBe('survivor_guillotine')
  })

  it('the grounding states elimination is by score and NEVER by vote', () => {
    // The half it takes from Guillotine, against the half it takes from Survivor.
    expect(text).toMatch(/Elimination:.*never by vote/i)
    expect(text).toMatch(/lowest scorer/i)
  })

  it('the grounding forbids trades outright', () => {
    expect(text).toContain('NOT POSSIBLE IN THIS FORMAT')
    expect(text).toContain('This format has no trades')
  })

  it('the grounding carries the growing lineup schedule and the week-9 superflex', () => {
    expect(text).toMatch(/Week 9 \(10 starters, SUPERFLEX\)/)
    expect(text).toMatch(/reprices every quarterback/)
    expect(text).toContain('Weeks 1–6 (8 starters)')
    expect(text).toContain('Week 14+ (12 starters)')
  })

  it('the grounding carries the FAAB rule that replaces trading', () => {
    expect(text).toMatch(/\$1000 for the entire season/)
  })

  it('and the Gauntlet tiebreak/playoff structure', () => {
    expect(text).toMatch(/Playoffs:.*Gauntlet/)
  })
})

describe('KOTH and Pirate/Vampire remain correct', () => {
  it('KOTH resolves as KOTH and names its redraft shell', () => {
    const koth = alias('redraft', ['king_of_the_hill'])
    const resolved = resolveLeagueRules(koth)
    expect(resolved.concept?.id).toBe('king_of_the_hill')
    expect(resolved.flattenedOnto).toBe('redraft')
    const text = buildLeagueRulesGrounding(koth) ?? ''
    expect(text).toContain('Format: King of the Hill')
    expect(text).toContain('redraft shell')
  })

  it('KOTH prices on its own concept, so no pricing-base line is emitted', () => {
    // `formatRulesConcept` IS 'king_of_the_hill', so primary and pricing agree.
    const resolved = resolveLeagueRules(alias('redraft', ['king_of_the_hill']))
    expect(resolved.pricingBaseFormat).toBe('king_of_the_hill')
    expect(buildLeagueRulesGrounding(alias('redraft', ['king_of_the_hill'])) ?? '').not.toContain('Priced as:')
  })

  it('Pirate/Vampire resolves as itself on a dynasty shell', () => {
    const pirate = alias('dynasty', ['pirate_vampire'], { isDynasty: true })
    const resolved = resolveLeagueRules(pirate)
    expect(resolved.concept?.id).toBe('pirate_vampire')
    expect(resolved.flattenedOnto).toBe('dynasty')
    expect(buildLeagueRulesGrounding(pirate) ?? '').toContain('Format: Pirate / Vampire')
  })
})

describe('IDP remains a modifier and never replaces dynasty', () => {
  const dynastyIdp = alias('dynasty', ['idp'], { isDynasty: true })
  const resolved = resolveLeagueRules(dynastyIdp)

  it('the primary concept is dynasty', () => {
    expect(resolved.concept?.id).toBe('dynasty')
  })

  it('idp is reported as a modifier', () => {
    expect(resolved.modifiers.map((m) => m.id)).toEqual(['idp'])
  })

  it('🛑 idp does not win the primary slot even though its catalog entry has a null concept', () => {
    /*
     * The catalog-only leagueType path keys on `formatRulesConcept === null`,
     * which `idp` also satisfies. It is excluded by the MODIFIER_ALIASES guard —
     * without that, IDP would become the primary concept and this is the 97
     * dynasty leagues again.
     */
    expect(resolveLeagueRules({ leagueType: 'idp' }).concept?.id).not.toBe('idp')
  })

  it('the grounding says the modifier does not replace the format', () => {
    const text = buildLeagueRulesGrounding(dynastyIdp) ?? ''
    expect(text).toContain('Format: Dynasty')
    expect(text).toContain('do not replace it')
  })
})

describe('exactly one authoritative classification path', () => {
  it('the resolver never contradicts the classifier about the PRICING base', () => {
    /*
     * `pricingBaseFormat` is copied from `readFormatRules`, never recomputed.
     * Equality across a spread of shapes is what proves there is no second
     * opinion — the failure this whole module was built to avoid.
     */
    const rows: Array<Record<string, unknown>> = [
      { leagueType: 'dynasty', isDynasty: true },
      { leagueType: 'redraft', keeperCount: 0 },
      { leagueType: 'keeper', keeperCount: 4 },
      { leagueType: 'guillotine' },
      alias('dynasty', ['royal'], { isDynasty: true }),
      alias('redraft', ['king_of_the_hill']),
      alias('dynasty', ['idp'], { isDynasty: true }),
      { leagueType: 'survivor_guillotine' },
    ]
    for (const row of rows) {
      const r = resolveLeagueRules(row)
      expect(r.pricingBaseFormat, JSON.stringify(row)).toBe(r.formatRules.concept)
    }
  })

  it('primary and pricing differ ONLY where a format was flattened onto a shell', () => {
    const royal = resolveLeagueRules(alias('dynasty', ['royal'], { isDynasty: true }))
    const plain = resolveLeagueRules({ leagueType: 'dynasty', isDynasty: true })
    expect(royal.concept?.formatRulesConcept).not.toBe(royal.pricingBaseFormat)
    expect(plain.concept?.formatRulesConcept).toBe(plain.pricingBaseFormat)
  })
})
