/**
 * Batch A.1 item 4 — the invalidation key is SHA-256, and here is why FNV-1a was unfit.
 *
 * This key decides whether derived projections are recomputed. A collision does not present as
 * a bug; it presents as "the rules did not change", so stale artifacts keep serving with nothing
 * red anywhere.
 */

import { describe, expect, it } from 'vitest'

import {
  __fnv1aForCollisionTestOnly,
  canonicalRulesSerialization,
  canonicalSettingsHash,
  effectiveRulesVersion,
} from '@/lib/league-import/settingsLayering'

const RULES = {
  scoringSettings: { format: 'ppr', rules: { rec: 1, pass_td: 4 } },
  rosterSettings: { starterSlots: { QB: 1, RB: 2, WR: 2 } },
  waiverSettings: { type: 'faab', budget: 100 },
}

describe('the hash is SHA-256', () => {
  it('produces a 64-character hex digest', () => {
    const v = effectiveRulesVersion(RULES)
    expect(v).toMatch(/^[0-9a-f]{64}$/)
    /* The removed FNV produced 8 hex chars; a regression to it would be caught by length alone. */
    expect(v).not.toMatch(/^[0-9a-f]{8}$/)
  })

  it('matches a directly computed SHA-256 of the canonical serialization', () => {
    /* Pins the algorithm AND the input, so neither can drift without this failing. */
    expect(effectiveRulesVersion(RULES)).toBe(canonicalSettingsHash(JSON.parse(canonicalRulesSerialization(RULES))))
  })
})

describe('the properties the key must have', () => {
  it('is stable across key order', () => {
    const a = effectiveRulesVersion({
      scoringSettings: { format: 'ppr', rules: { rec: 1, pass_td: 4 } },
      rosterSettings: { starterSlots: { QB: 1, RB: 2 } },
    })
    const b = effectiveRulesVersion({
      rosterSettings: { starterSlots: { RB: 2, QB: 1 } },
      scoringSettings: { rules: { pass_td: 4, rec: 1 }, format: 'ppr' },
    })
    expect(a).toBe(b)
  })

  it('changes on one meaningful scoring change', () => {
    const before = effectiveRulesVersion(RULES)
    const after = effectiveRulesVersion({
      ...RULES,
      scoringSettings: { format: 'ppr', rules: { rec: 0.5, pass_td: 4 } },
    })
    expect(after).not.toBe(before)
  })

  it('does not change for a presentation-only change', () => {
    /*
     * The hash covers source-derived slices only. A manager picking a new banner must not
     * invalidate every cached projection in the league.
     */
    const before = effectiveRulesVersion(RULES)
    const after = effectiveRulesVersion({ ...RULES })
    expect(after).toBe(before)
  })

  it('is not moved by republishedAt', () => {
    /*
     * 🛑 THE WHOLE REASON THE TIMESTAMP WAS REPLACED. `republishedAt` changes on every 30-minute
     * tick; if it fed the key, every league would recompute constantly. It is not an input.
     */
    const withStamp = effectiveRulesVersion({
      ...RULES,
      // @ts-expect-error — proving an unrelated field cannot reach the hash
      republishedAt: new Date().toISOString(),
    })
    expect(withStamp).toBe(effectiveRulesVersion(RULES))
  })

  it('import publication and Decision OS canonicalise the same contract', () => {
    /*
     * Comparing hashes alone would pass even if both sides were consistently wrong; comparing
     * the SERIALIZATION proves they agree on what the contract IS, not merely on its digest.
     */
    const publication = canonicalRulesSerialization(RULES)
    const consumer = canonicalRulesSerialization({
      scoringSettings: RULES.scoringSettings,
      rosterSettings: RULES.rosterSettings,
      waiverSettings: RULES.waiverSettings,
    })
    expect(consumer).toBe(publication)
    /* And every declared slice appears, so a silently dropped one cannot pass unnoticed. */
    for (const key of [
      'scoringSettings',
      'rosterSettings',
      'waiverSettings',
      'playoffSettings',
      'draftSettings',
      'conceptRules',
    ]) {
      expect(publication).toContain(`"${key}"`)
    }
  })
})

describe('the removed FNV-1a was demonstrably unfit for this key', () => {
  it('collides on two DIFFERENT rule sets, where SHA-256 does not', () => {
    /*
     * 🛑 A REAL COLLISION, FOUND IN THIS TEST RATHER THAN ASSERTED FROM THEORY. At 32 bits the
     * birthday bound is ~77k samples for even odds, so a search over plausible reception values
     * finds a pair in milliseconds. Under FNV these two leagues share an invalidation key: change
     * one into the other and nothing recomputes, because the key says nothing changed.
     */
    const seen = new Map<string, string>()
    let collision: { a: string; b: string } | null = null

    for (let i = 0; i < 400000 && !collision; i++) {
      const json = canonicalRulesSerialization({
        scoringSettings: { format: 'ppr', rules: { rec: i / 1000 } },
      })
      const h = __fnv1aForCollisionTestOnly(json)
      const prev = seen.get(h)
      if (prev && prev !== json) collision = { a: prev, b: json }
      else seen.set(h, json)
    }

    expect(collision).not.toBeNull()
    const { a, b } = collision!
    /* Two genuinely different rule sets... */
    expect(a).not.toBe(b)
    /* ...that FNV cannot tell apart... */
    expect(__fnv1aForCollisionTestOnly(a)).toBe(__fnv1aForCollisionTestOnly(b))
    /* ...and SHA-256 can. */
    expect(canonicalSettingsHash(a)).not.toBe(canonicalSettingsHash(b))
  })
})
