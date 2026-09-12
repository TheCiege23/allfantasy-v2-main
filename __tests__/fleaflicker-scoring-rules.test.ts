// @vitest-environment node
/**
 * Guards `lib/league-import/fleaflicker/fleaflickerScoringRules.ts` — the "rules"
 * third of P2 item 1. The Fleaflicker adapter emitted `scoring: null` and its own
 * coverage said "Fleaflicker scoring rules not mapped in v1".
 *
 * ⚠ DRIVEN BY THE COMMITTED FIXTURE, NOT BY HAND-WRITTEN SAMPLES. Every
 * structural claim below — 48 rules, a group with no `scoringRules` key, a
 * category carrying seven rules, abbreviations that collide eight ways — is a
 * property of `contracts/fleaflicker/fixtures/rules.NFL.json`. Inventing a tidy
 * sample would test a response shape the provider does not send, which is the
 * whole reason this repo keeps contracts with real fixtures.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  normalizeFleaflickerScoringRules,
  ruleRate,
  rulePositions,
  summarizeFleaflickerRosterShape,
} from '@/lib/league-import/fleaflicker/fleaflickerScoringRules'
import type { FleaflickerRulesResponse } from '@/lib/league-import/fleaflicker/types'

const fixture = JSON.parse(
  readFileSync('contracts/fleaflicker/fixtures/rules.NFL.json', 'utf8'),
) as FleaflickerRulesResponse

describe('the fixture itself still has the properties these tests rely on', () => {
  /*
   * 🛑 THESE ARE NOT PADDING. Each assertion below pins a fixture property that a
   * later test's meaning depends on. If someone re-captures the fixture from a
   * different league, these fail FIRST and say why — rather than the behaviour
   * tests going quietly green against data that no longer exercises the case.
   */
  it('has 8 groups, one of which omits scoringRules entirely', () => {
    expect(fixture.groups).toHaveLength(8)
    const absent = (fixture.groups ?? []).filter((g) => g.scoringRules === undefined)
    expect(absent).toHaveLength(1)
    expect(absent[0]?.label).toBe('Punting')
    // ⚠ absent, NOT empty — the distinction the normalizer's `?? []` exists for
    expect(absent[0]?.scoringRules).toBeUndefined()
    expect(absent[0]?.allCategories?.length).toBeGreaterThan(0)
  })

  it('has a category carrying several rules (banded scoring)', () => {
    const byId = new Map<number, number>()
    for (const g of fixture.groups ?? []) {
      for (const r of g.scoringRules ?? []) {
        byId.set(r.category.id, (byId.get(r.category.id) ?? 0) + 1)
      }
    }
    expect(byId.get(11)).toBe(7) // QB Rating tiers
    expect(byId.get(102)).toBe(3) // Field Goal Made distance bands
  })

  it('has abbreviations that collide across groups', () => {
    const byAbbr = new Map<string, number>()
    for (const g of fixture.groups ?? []) {
      for (const r of g.scoringRules ?? []) {
        const a = r.category.abbreviation ?? ''
        byAbbr.set(a, (byAbbr.get(a) ?? 0) + 1)
      }
    }
    // "Yd" and "TD" span several groups — this is why stat_key is the id
    expect((byAbbr.get('Yd') ?? 0)).toBeGreaterThan(1)
    expect((byAbbr.get('TD') ?? 0)).toBeGreaterThan(1)
  })
})

describe('normalizeFleaflickerScoringRules', () => {
  const rules = normalizeFleaflickerScoringRules(fixture)

  it('maps every rule in the fixture, including the banded ones', () => {
    const total = (fixture.groups ?? []).reduce((n, g) => n + (g.scoringRules?.length ?? 0), 0)
    expect(total).toBe(48)
    expect(rules).toHaveLength(48)
  })

  it('does NOT collapse a category that carries several rules', () => {
    /*
     * The flat canonical map is lossy by construction and will collapse these;
     * the detail LIST must not. Seven QB Rating rules in, seven out.
     */
    const qbRating = rules.filter((r) => r.stat_key === '11')
    expect(qbRating).toHaveLength(7)
  })

  it('keys on category.id, never the colliding abbreviation', () => {
    const passingYards = rules.find((r) => r.stat_name === 'Passing Yard')
    expect(passingYards?.stat_key).toBe('3')
    expect(rules.every((r) => /^\d+$/.test(r.stat_key))).toBe(true)
    expect(rules.some((r) => r.stat_key === 'Yd')).toBe(false)
  })

  it('carries the PER-UNIT rate, not the headline number', () => {
    // "1 point for every 25 Passing Yards (0.04 per)"
    const passingYards = rules.find((r) => r.stat_name === 'Passing Yard')
    expect(passingYards?.points_value).toBe(0.04)
    expect(passingYards?.points_value).not.toBe(1)
  })

  it('omits positions when the rule applies to all', () => {
    const global = rules.filter((r) => r.positions === undefined)
    expect(global.length).toBeGreaterThan(0)
    // the fixture has 39 applyToAll rules
    expect(global).toHaveLength(39)
  })

  it('carries positions when the rule IS restricted', () => {
    const restricted = rules.filter((r) => r.positions !== undefined)
    expect(restricted).toHaveLength(9)
    const qbOnly = restricted.find((r) => r.stat_key === '11')
    expect(qbOnly?.positions).toEqual(['QB'])
  })

  it('survives the group that omits scoringRules', () => {
    // Punting contributes nothing and throws nothing — the `?? []` doing its job.
    expect(() => normalizeFleaflickerScoringRules(fixture)).not.toThrow()
  })
})

describe('the helpers, on the cases that decide correctness', () => {
  it('ruleRate prefers pointsPer over points', () => {
    expect(ruleRate({ category: { id: 1 }, points: { value: 1 }, forEvery: 25, pointsPer: { value: 0.04 } })).toBe(0.04)
  })

  it('ruleRate falls back to points when there is no rate', () => {
    expect(ruleRate({ category: { id: 1 }, points: { value: 6 } })).toBe(6)
  })

  it('ruleRate returns null when neither is a finite number', () => {
    expect(ruleRate({ category: { id: 1 } })).toBeNull()
    expect(ruleRate({ category: { id: 1 }, points: { value: NaN } })).toBeNull()
  })

  it('rulePositions returns null for applyToAll EVEN WHEN applyTo is populated', () => {
    /*
     * 🛑 THE ONE THAT WOULD BE EASY TO GET WRONG. 39 of 48 fixture rules look
     * exactly like this: the flag says "everyone" and the array lists today's ten
     * positions. Reading the array turns a universal rule into one that silently
     * stops applying the day an eleventh position exists.
     */
    expect(rulePositions({ category: { id: 1 }, applyToAll: true, applyTo: ['QB', 'RB', 'WR'] })).toBeNull()
  })

  it('rulePositions uppercases and drops blanks', () => {
    expect(rulePositions({ category: { id: 1 }, applyToAll: false, applyTo: [' qb ', '', 'rb'] })).toEqual(['QB', 'RB'])
  })

  it('rulePositions returns null for an empty restriction rather than an empty array', () => {
    // An empty list is not a restriction to nothing; the canonical shape reads
    // "no positions" as global, so this must be null rather than [].
    expect(rulePositions({ category: { id: 1 }, applyToAll: false, applyTo: [] })).toBeNull()
  })
})

describe('degenerate bodies never throw', () => {
  it('null / empty / garbage all return an empty list', () => {
    expect(normalizeFleaflickerScoringRules(null)).toEqual([])
    expect(normalizeFleaflickerScoringRules(undefined)).toEqual([])
    expect(normalizeFleaflickerScoringRules({})).toEqual([])
    expect(normalizeFleaflickerScoringRules({ groups: [] })).toEqual([])
    expect(normalizeFleaflickerScoringRules({ groups: [{ label: 'X' }] })).toEqual([])
  })

  it('a rule with no category id is skipped, not written with a bogus key', () => {
    const out = normalizeFleaflickerScoringRules({
      groups: [{ scoringRules: [{ category: {} as never, points: { value: 1 } }] }],
    })
    expect(out).toEqual([])
  })

  it('roster shape reads the provider counts and tolerates their absence', () => {
    expect(summarizeFleaflickerRosterShape(fixture)).toEqual({
      starters: 16,
      bench: 24,
      maxRosterSize: 68,
    })
    expect(summarizeFleaflickerRosterShape({})).toEqual({
      starters: null,
      bench: null,
      maxRosterSize: null,
    })
  })
})
