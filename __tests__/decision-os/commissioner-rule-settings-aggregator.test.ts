/**
 * Commissioner Intelligence Platform — Phase 6: Rule / Settings aggregator test.
 *
 * Pure, deterministic classification + contract tests. Covers the spec's required
 * cases (standard / custom / advanced, playoff needs_review only for an OBJECTIVE
 * inconsistency, missing settings, defaults fallback) and proves the output is
 * DESCRIPTIVE — no judgmental/advice language and no raw settings JSON leaks.
 */
import { describe, it, expect } from 'vitest'
import { aggregateCommissionerRuleSettings } from '@/lib/decision-os/commissioner-intelligence/rule-settings/ruleSettingsAggregator'
import {
  COMMISSIONER_RULE_SETTINGS_VERSION,
  type RuleSettingsInput,
} from '@/lib/decision-os/commissioner-intelligence/rule-settings/types'

const NOW = new Date('2026-11-20T00:00:00.000Z')

function baseInput(over: Partial<RuleSettingsInput> = {}): RuleSettingsInput {
  return {
    hasSettings: true,
    source: 'settings_snapshot',
    starterSlots: { QB: 1, RB: 2, WR: 2, TE: 1, DEF: 1 }, // 7 starters
    benchSlots: 6,
    irSlots: 1,
    taxiSlots: 0,
    devyCollegeSlots: 0,
    scoringFormat: 'half_ppr',
    scoringMode: 'points',
    scoringRules: null,
    leagueType: 'redraft',
    waiverType: 'faab',
    tradeReviewMode: null,
    tradeReviewHours: null,
    tradeDeadlineWeek: null,
    playoffTeams: 6,
    playoffStartWeek: 15,
    playoffSeedingRule: 'default',
    leagueTeamCount: 12,
    defaults: { starterCount: 7, benchSlots: 6, irSlots: 1, scoringFormat: 'half_ppr', playoffTeams: 6, teamCount: 12, waiverType: 'faab', seasonWeeks: 14 },
    ...over,
  }
}

// Judgmental / advice language that must never appear.
const BANNED = /\b(unfair|recommend)\b|should change|bad rule|poorly configured|managers will (dislike|hate)|ban this/i

describe('aggregateCommissionerRuleSettings — format tiers', () => {
  it('standard: all defaults → standard / simple / open / standard playoff', () => {
    const r = aggregateCommissionerRuleSettings(baseInput(), NOW)
    expect(r.leagueFormat).toBe('standard')
    expect(r.rosterComplexity).toBe('simple')
    expect(r.scoringComplexity).toBe('simple')
    expect(r.transactionPolicy).toBe('open')
    expect(r.playoffConfiguration).toBe('standard')
  })

  it('custom: one notable custom setting (Superflex) → custom', () => {
    const r = aggregateCommissionerRuleSettings(baseInput({ starterSlots: { QB: 1, RB: 2, WR: 2, TE: 1, SF: 1, DEF: 1 } }), NOW)
    expect(r.leagueFormat).toBe('custom')
    expect(r.settingsHighlights).toContain('Superflex')
  })

  it('advanced: 2+ advanced flags (Superflex + IDP) → advanced + complex roster', () => {
    const r = aggregateCommissionerRuleSettings(
      baseInput({ starterSlots: { QB: 1, RB: 2, WR: 2, TE: 1, SF: 1, DL: 2, LB: 2, DB: 2 }, leagueType: 'idp_dynasty' }),
      NOW,
    )
    expect(r.leagueFormat).toBe('advanced')
    expect(r.rosterComplexity).toBe('complex')
    expect(r.settingsHighlights).toEqual(expect.arrayContaining(['Superflex', 'IDP']))
  })
})

describe('aggregateCommissionerRuleSettings — scoring + transactions', () => {
  it('scoring: IDP or non-points mode → complex; TE premium → moderate', () => {
    expect(aggregateCommissionerRuleSettings(baseInput({ leagueType: 'idp' }), NOW).scoringComplexity).toBe('complex')
    expect(aggregateCommissionerRuleSettings(baseInput({ scoringMode: 'h2h_category' }), NOW).scoringComplexity).toBe('complex')
    expect(aggregateCommissionerRuleSettings(baseInput({ scoringRules: { positionMultipliers: { TE: 1.5 } } }), NOW).scoringComplexity).toBe('moderate')
  })

  it('transaction: review window → reviewed; review + deadline → restricted', () => {
    expect(aggregateCommissionerRuleSettings(baseInput({ tradeReviewHours: 48 }), NOW).transactionPolicy).toBe('reviewed')
    expect(aggregateCommissionerRuleSettings(baseInput({ tradeReviewHours: 48, tradeDeadlineWeek: 13 }), NOW).transactionPolicy).toBe('restricted')
  })
})

describe('aggregateCommissionerRuleSettings — playoff (needs_review is objective-only)', () => {
  it('needs_review ONLY when playoff teams exceed league size (with a neutral caveat)', () => {
    const r = aggregateCommissionerRuleSettings(baseInput({ playoffTeams: 14, leagueTeamCount: 12 }), NOW)
    expect(r.playoffConfiguration).toBe('needs_review')
    expect(r.caveats.some((c) => /exceeds the number of teams — worth a look/i.test(c))).toBe(true)
  })

  it('an odd/custom playoff size is CUSTOM, not needs_review', () => {
    expect(aggregateCommissionerRuleSettings(baseInput({ playoffTeams: 5 }), NOW).playoffConfiguration).toBe('custom')
  })

  it('a normal playoff start week after the regular season is NOT flagged', () => {
    // week 15 playoffs after 14 regular weeks is standard, not an inconsistency
    expect(aggregateCommissionerRuleSettings(baseInput({ playoffStartWeek: 15 }), NOW).playoffConfiguration).toBe('standard')
  })
})

describe('aggregateCommissionerRuleSettings — missing / defaults / provenance', () => {
  it('hasSettings=false → everything unknown + honest caveat', () => {
    const r = aggregateCommissionerRuleSettings(baseInput({ hasSettings: false }), NOW)
    expect(r.leagueFormat).toBe('unknown')
    expect(r.rosterComplexity).toBe('unknown')
    expect(r.playoffConfiguration).toBe('unknown')
    expect(r.settingsHighlights).toEqual([])
    expect(r.caveats.some((c) => /aren't available to summarize/i.test(c))).toBe(true)
  })

  it('source=defaults → a fallback caveat + provenance field', () => {
    const r = aggregateCommissionerRuleSettings(baseInput({ source: 'defaults' }), NOW)
    expect(r.source).toBe('defaults')
    expect(r.caveats.some((c) => /fall back to the format default/i.test(c))).toBe(true)
  })
})

describe('aggregateCommissionerRuleSettings — contract, determinism, safety', () => {
  it('emits the full V1 contract', () => {
    const r = aggregateCommissionerRuleSettings(baseInput(), NOW)
    expect(r.version).toBe(COMMISSIONER_RULE_SETTINGS_VERSION)
    expect(r.derivedAt).toBe(NOW.toISOString())
    expect(Object.keys(r).sort()).toEqual(
      ['caveats', 'derivedAt', 'leagueFormat', 'playoffConfiguration', 'rosterComplexity', 'scoringComplexity', 'settingsHighlights', 'source', 'summary', 'transactionPolicy', 'version'].sort(),
    )
  })

  it('is deterministic', () => {
    const i = baseInput({ starterSlots: { QB: 1, SF: 1, RB: 2, WR: 3, TE: 1 }, tradeReviewHours: 24, playoffTeams: 8 })
    expect(aggregateCommissionerRuleSettings(i, NOW)).toEqual(aggregateCommissionerRuleSettings(i, NOW))
  })

  it('NO judgmental/advice language and NO raw settings JSON across scenarios', () => {
    const scenarios = [
      baseInput(),
      baseInput({ starterSlots: { QB: 1, SF: 1, DL: 2, LB: 2 }, leagueType: 'idp_dynasty', tradeReviewHours: 48, tradeDeadlineWeek: 11, playoffTeams: 14, leagueTeamCount: 12, scoringRules: { positionMultipliers: { TE: 1.5 } } }),
      baseInput({ hasSettings: false }),
    ]
    for (const s of scenarios) {
      const r = aggregateCommissionerRuleSettings(s, NOW)
      const text = [r.summary, ...r.settingsHighlights, ...r.caveats].join(' ')
      expect(BANNED.test(text)).toBe(false)
      // no raw JSON / internal setting keys leaked into human-facing strings
      expect(text).not.toMatch(/[{}]|positionMultipliers|starterSlots|scoringRules|leagueType/)
    }
  })
})
