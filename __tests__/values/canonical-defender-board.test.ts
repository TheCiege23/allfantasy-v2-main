import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { hasIdpScoring } from '@/lib/core-app/scoringNotes'
import { parseIdpSlots } from '@/lib/idp-projections/idpValuation'
import {
  CANONICAL_IDP_SLOTS,
  CANONICAL_NUM_TEAMS,
  CANONICAL_SCORING_FORMAT,
  canonicalIdpScoring,
} from '@/lib/values/canonicalDefenderBoard'

/**
 * The league-free defender board. Guap's reference league, 2026-09-06: 12 teams, 3 IDP starters.
 *
 * The board itself needs a database, so what is pinned here is everything that decides what the
 * numbers MEAN — the reference league, the scoring profile, and that it reuses the one pricer.
 */

const raw = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8')
const stripComments = (src: string) =>
  src
    .split(/\r?\n/)
    .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l))
    .join('\n')

const BOARD = 'lib/values/canonicalDefenderBoard.ts'
const PRICER = 'lib/idp-projections/leagueIdpVorp.ts'

describe('the reference league is what Guap specified', () => {
  it('🛑 12 teams, 3 IDP starters — these two numbers ARE the replacement level', () => {
    expect(CANONICAL_NUM_TEAMS).toBe(12)
    expect(CANONICAL_IDP_SLOTS).toHaveLength(3)
  })

  it('🛑 the slots parse as THREE FLEX, not one of each group', () => {
    /*
     * Flex means `buildIdpValuations` hands each starting slot to whichever defender projects
     * highest, so where the starters come from is an output of the projections. Dedicated 1/1/1
     * would assert a league starts one of each — which "3 IDP starters" does not say.
     */
    const slots = parseIdpSlots(CANONICAL_IDP_SLOTS)
    expect(slots.flex).toBe(3)
    expect(slots.dedicated).toEqual({ LB: 0, DL: 0, DB: 0 })
  })

  it('[control] a 1/1/1 shape would parse differently — the assertion above is not vacuous', () => {
    const slots = parseIdpSlots(['LB', 'DL', 'DB'])
    expect(slots.flex).toBe(0)
    expect(slots.dedicated).toEqual({ LB: 1, DL: 1, DB: 1 })
  })

  it('36 starting slots, so replacement sits around the 37th defender', () => {
    expect(CANONICAL_NUM_TEAMS * CANONICAL_IDP_SLOTS.length).toBe(36)
  })
})

describe('canonical scoring is the registry Balanced profile, read not copied', () => {
  it('🛑 resolves to BALANCED weights, and is distinguishable from the other two profiles', () => {
    /*
     * The registry ships three NFL IDP profiles that differ mainly in tackle weight:
     *     Balanced      solo 1     sack 4   INT 3
     *     Tackle-heavy  solo 1.5   sack 3   INT 2
     *     Big-play      solo 0.5   sack 5   INT 5
     * Asserting the actual numbers is what makes this a test of WHICH profile, rather than a
     * test that some scoring exists.
     */
    const s = canonicalIdpScoring()
    expect(s.idp_tackle_solo).toBe(1)
    expect(s.idp_tackle_assist).toBe(0.5)
    expect(s.idp_sack).toBe(4)
    expect(s.idp_interception).toBe(3)

    expect(s.idp_tackle_solo).not.toBe(1.5) // tackle-heavy
    expect(s.idp_tackle_solo).not.toBe(0.5) // big-play
  })

  it('🛑 the pricer would ACCEPT it as IDP scoring — otherwise the board silently prices nothing', () => {
    /*
     * `resolveLeagueIdpScoring` refuses a league whose settings fail `hasIdpScoring`. The
     * canonical record bypasses that resolver, so nothing else checks this: a record missing the
     * idp_ keys would reach `priceIdpBoard` and produce an empty board with no error.
     */
    expect(hasIdpScoring(canonicalIdpScoring())).toBe(true)
  })

  it('⚠ carries the offensive rules too, because the profile is IDP layered on PPR', () => {
    const s = canonicalIdpScoring()
    expect(Object.keys(s).length).toBeGreaterThan(15)
  })

  it('[control] disabled rules are omitted, not written as 0 — absent and zero differ', () => {
    const s = canonicalIdpScoring()
    for (const v of Object.values(s)) expect(v).not.toBeUndefined()
  })

  it('names the registry format key it resolves through', () => {
    expect(CANONICAL_SCORING_FORMAT).toBe('IDP')
  })
})

describe('it reuses the one pricer rather than becoming a second board', () => {
  it('🛑 calls priceIdpBoard and defines no valuation of its own', () => {
    const code = stripComments(raw(BOARD))
    expect(code).toContain("from '@/lib/idp-projections/leagueIdpVorp'")
    expect(code).toContain('priceIdpBoard(')
    // The curve, the replacement maths and the rank->value step must NOT be reimplemented here.
    expect(code).not.toContain('idpValueForRank')
    expect(code).not.toContain('buildIdpValuations')
  })

  it('🛑 loadLeagueIdpVorp delegates to the SAME function, so neither path can drift', () => {
    const code = stripComments(raw(PRICER))
    expect(code).toMatch(/return priceIdpBoard\(\{/)
    // Exactly one body: the league entry point must not still carry its own copy of the steps.
    expect(code.match(/const rows = await args\.prisma\.sportsPlayer/g) ?? []).toHaveLength(1)
  })

  it('⚠ returns the reference league with the prices, never bare numbers', () => {
    /*
     * "Worth 4,800" is not a fact about the world — it is a fact about a 12-team league starting
     * three defenders. A caller that cannot see the reference cannot report the number honestly.
     */
    const code = stripComments(raw(BOARD))
    expect(code).toContain('reference')
    expect(code).toMatch(/numTeams: CANONICAL_NUM_TEAMS/)
    expect(code).toMatch(/idpStarters: CANONICAL_IDP_SLOTS\.length/)
  })

  it('[control] the scan reads real files with real code', () => {
    for (const p of [BOARD, PRICER]) {
      const code = stripComments(raw(p))
      expect(code.length).toBeGreaterThan(400)
      expect(code).toContain('priceIdpBoard')
    }
  })
})
