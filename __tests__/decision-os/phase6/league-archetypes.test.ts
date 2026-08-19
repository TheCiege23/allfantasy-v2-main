/**
 * Decision OS — Phase 6.3 League Archetype Classifier tests.
 *
 * 12 test groups covering every archetype + meta-properties:
 *   (1)  highly_engaged
 *   (2)  casual_social
 *   (3)  commissioner_driven
 *   (4)  competitive_balanced
 *   (5)  high_churn_risk
 *   (6)  low_engagement
 *   (7)  trade_heavy
 *   (8)  waiver_active
 *   (9)  inactive_or_stale
 *   (10) unknown — sparse signals (completeness < 20)
 *   (11) determinism — same input → same output, always
 *   (12) derivation chain — every evaluated signal present + missing signals listed
 */

import { describe, it, expect } from 'vitest'
import { classifyLeagueArchetype, ARCHETYPE_VERSION } from '@/lib/decision-os/phase6/archetypes/league-archetypes'
import type { LeagueArchetypeInput } from '@/lib/decision-os/phase6/archetypes/types'

// ── Fixture factories ─────────────────────────────────────────────────────────

function base(): LeagueArchetypeInput {
  return {
    leagueEngagementScore:     65,
    leagueEngagementTier:      'active',
    participationDistribution: {
      totalManagers:    10,
      activeManagers:   8,
      inactiveManagers: 2,
      activePercent:    80,
      inactivePercent:  20,
    },
    tradeActivity:   { tier: 'moderate', perManagerRate: 1.2 },
    waiverActivity:  { tier: 'moderate', perManagerRate: 1.5 },
    draftActivity:   { tier: 'moderate', perManagerRate: 1.0 },
    retentionRisk:   'low',
    commissionerWorkload: 'moderate',
    completeness:    80,
  }
}

function highlyEngagedFixture(): LeagueArchetypeInput {
  return {
    ...base(),
    leagueEngagementScore:     88,
    leagueEngagementTier:      'elite',
    participationDistribution: {
      totalManagers:    12,
      activeManagers:   11,
      inactiveManagers: 1,
      activePercent:    91.7,
      inactivePercent:  8.3,
    },
    tradeActivity:  { tier: 'high', perManagerRate: 3.2 },
    waiverActivity: { tier: 'high', perManagerRate: 4.1 },
    retentionRisk:  'low',
    commissionerWorkload: 'light',
  }
}

function casualSocialFixture(): LeagueArchetypeInput {
  // ET='moderate' (not elite/active) prevents highly_engaged from reaching 0.50.
  // IP=29% prevents high_churn_risk from reaching 0.50.
  // All activities 'none' → casual_social scores: 0.20+0.25+0.25+0.20 = 0.90
  return {
    leagueEngagementScore:     55,
    leagueEngagementTier:      'moderate',
    participationDistribution: {
      totalManagers:    7,
      activeManagers:   5,
      inactiveManagers: 2,
      activePercent:    71,
      inactivePercent:  29,
    },
    tradeActivity:  { tier: 'none', perManagerRate: 0 },
    waiverActivity: { tier: 'none', perManagerRate: 0 },
    draftActivity:  { tier: 'none', perManagerRate: 0 },
    retentionRisk:  'low',
    commissionerWorkload: 'light',
    completeness:   80,
  }
}

function commissionerDrivenFixture(): LeagueArchetypeInput {
  // IP=20% keeps high_churn_risk below 0.50 (only RR=medium→0.22 + ET=moderate→0.20 = 0.42).
  // AP=80% but ET=moderate means highly_engaged gets only 0+0+0.20+0.15 = 0.35 < 0.50.
  // CW=critical + ET=moderate → commissioner_driven = 0.45+0.25+0.15+0.15 = 1.00.
  return {
    leagueEngagementScore:     45,
    leagueEngagementTier:      'moderate',
    participationDistribution: {
      totalManagers:    10,
      activeManagers:   8,
      inactiveManagers: 2,
      activePercent:    80,
      inactivePercent:  20,
    },
    tradeActivity:  { tier: 'low', perManagerRate: 0.4 },
    waiverActivity: { tier: 'low', perManagerRate: 0.5 },
    draftActivity:  { tier: 'low', perManagerRate: 0.3 },
    retentionRisk:  'medium',
    commissionerWorkload: 'critical',
    completeness:   80,
  }
}

function competitiveBalancedFixture(): LeagueArchetypeInput {
  // ET='moderate' + RR='medium' drops highly_engaged to 0+0+0.20+0.15 = 0.35 < 0.50.
  // Both trade=high AND waiver=moderate (≥moderate) pass the gate.
  // competitive_balanced = 0.30+0.30+0.20(ET≠dormant/passive)+0.20(AP≥60%) = 1.00.
  return {
    leagueEngagementScore:     72,
    leagueEngagementTier:      'moderate',
    participationDistribution: {
      totalManagers:    10,
      activeManagers:   9,
      inactiveManagers: 1,
      activePercent:    90,
      inactivePercent:  10,
    },
    tradeActivity:  { tier: 'high',     perManagerRate: 2.8 },
    waiverActivity: { tier: 'moderate', perManagerRate: 1.8 },
    draftActivity:  { tier: 'moderate', perManagerRate: 1.0 },
    retentionRisk:  'medium',
    commissionerWorkload: 'moderate',
    completeness:   80,
  }
}

function highChurnRiskFixture(): LeagueArchetypeInput {
  return {
    ...base(),
    leagueEngagementScore:     28,
    leagueEngagementTier:      'passive',
    participationDistribution: {
      totalManagers:    10,
      activeManagers:   5,
      inactiveManagers: 5,
      activePercent:    50,
      inactivePercent:  50,
    },
    tradeActivity:  { tier: 'none', perManagerRate: 0 },
    waiverActivity: { tier: 'low',  perManagerRate: 0.2 },
    retentionRisk:  'critical',
    commissionerWorkload: 'heavy',
  }
}

function lowEngagementFixture(): LeagueArchetypeInput {
  // IP=29% keeps high_churn_risk at 0+0+0.20+0.10 = 0.30 (RR=low).
  // AP=71% keeps highly_engaged at 0+0.30+0+0 = 0.30 (ET=passive, no activity).
  // low_engagement = 0.45 (ET=passive) + 0.25 (ES=32<40) + 0 (RR=low) = 0.70.
  return {
    leagueEngagementScore:     32,
    leagueEngagementTier:      'passive',
    participationDistribution: {
      totalManagers:    7,
      activeManagers:   5,
      inactiveManagers: 2,
      activePercent:    71,
      inactivePercent:  29,
    },
    tradeActivity:  { tier: 'none', perManagerRate: 0 },
    waiverActivity: { tier: 'none', perManagerRate: 0 },
    draftActivity:  { tier: 'none', perManagerRate: 0 },
    retentionRisk:  'low',
    commissionerWorkload: 'moderate',
    completeness:   80,
  }
}

function tradeHeavyFixture(): LeagueArchetypeInput {
  // Waiver='low' blocks competitive_balanced gate (needs both ≥ moderate).
  // ET='moderate' + RR='medium' drops highly_engaged to 0+0+0.20+0.15 = 0.35 < 0.50.
  // trade_heavy = 0.45+0.25(TR≥WR)+0.15(not dormant)+0.15(not critical) = 1.00.
  return {
    leagueEngagementScore:     68,
    leagueEngagementTier:      'moderate',
    participationDistribution: {
      totalManagers:    10,
      activeManagers:   9,
      inactiveManagers: 1,
      activePercent:    90,
      inactivePercent:  10,
    },
    tradeActivity:  { tier: 'high', perManagerRate: 5.2 },
    waiverActivity: { tier: 'low',  perManagerRate: 1.1 },
    draftActivity:  { tier: 'low',  perManagerRate: 0.5 },
    retentionRisk:  'medium',
    commissionerWorkload: 'light',
    completeness:   80,
  }
}

function waiverActiveFixture(): LeagueArchetypeInput {
  // ET='moderate' + RR='medium' drops highly_engaged to 0+0+0.20+0.15 = 0.35 < 0.50.
  // Trade='low' keeps competitive_balanced gate blocked.
  // waiver_active = 0.45+0.25(WR≥TR)+0.15(not dormant)+0.15(not critical) = 1.00.
  return {
    leagueEngagementScore:     65,
    leagueEngagementTier:      'moderate',
    participationDistribution: {
      totalManagers:    10,
      activeManagers:   9,
      inactiveManagers: 1,
      activePercent:    90,
      inactivePercent:  10,
    },
    tradeActivity:  { tier: 'low',  perManagerRate: 0.4 },
    waiverActivity: { tier: 'high', perManagerRate: 6.8 },
    draftActivity:  { tier: 'low',  perManagerRate: 0.3 },
    retentionRisk:  'medium',
    commissionerWorkload: 'light',
    completeness:   80,
  }
}

function inactiveOrStaleFixture(): LeagueArchetypeInput {
  return {
    ...base(),
    leagueEngagementScore:     8,
    leagueEngagementTier:      'dormant',
    participationDistribution: {
      totalManagers:    10,
      activeManagers:   1,
      inactiveManagers: 9,
      activePercent:    10,
      inactivePercent:  90,
    },
    tradeActivity:  { tier: 'none', perManagerRate: 0 },
    waiverActivity: { tier: 'none', perManagerRate: 0 },
    draftActivity:  { tier: 'none', perManagerRate: 0 },
    retentionRisk:  'critical',
    commissionerWorkload: 'light',
  }
}

function sparseSignalsFixture(): LeagueArchetypeInput {
  return {
    ...base(),
    completeness: 10, // below MIN_COMPLETENESS (20)
  }
}

// ── 1. highly_engaged ─────────────────────────────────────────────────────────

describe('Phase 6.3 — League Archetype Classifier', () => {
  describe('1. highly_engaged', () => {
    it('classifies an elite-tier, low-risk, high-participation league as highly_engaged', () => {
      const result = classifyLeagueArchetype(highlyEngagedFixture())
      expect(result.archetype).toBe('highly_engaged')
      expect(result.confidence).toBeGreaterThanOrEqual(0.50)
      expect(result.confidence).toBeLessThanOrEqual(1.0)
      expect(result.reasons.length).toBeGreaterThan(0)
    })

    it('highly_engaged result includes engagement tier in derivation', () => {
      const result = classifyLeagueArchetype(highlyEngagedFixture())
      const etStep = result.derivation.find(d => d.signal === 'leagueEngagementTier')
      expect(etStep).toBeDefined()
      expect(etStep?.value).toBe('elite')
    })

    it('highly_engaged result includes retention risk in derivation', () => {
      const result = classifyLeagueArchetype(highlyEngagedFixture())
      const rrStep = result.derivation.find(d => d.signal === 'retentionRisk')
      expect(rrStep).toBeDefined()
      expect(rrStep?.value).toBe('low')
    })
  })

  // ── 2. casual_social ─────────────────────────────────────────────────────────

  describe('2. casual_social', () => {
    it('classifies an active-but-low-transaction league as casual_social', () => {
      const result = classifyLeagueArchetype(casualSocialFixture())
      expect(result.archetype).toBe('casual_social')
      expect(result.confidence).toBeGreaterThanOrEqual(0.50)
    })

    it('casual_social requires active/moderate engagement (gate check)', () => {
      const fixture = { ...casualSocialFixture(), leagueEngagementTier: 'dormant' as const }
      const result = classifyLeagueArchetype(fixture)
      expect(result.archetype).not.toBe('casual_social')
    })

    it('casual_social is blocked when trade is high (gate check)', () => {
      const fixture = { ...casualSocialFixture(), tradeActivity: { tier: 'high' as const, perManagerRate: 5 } }
      const result = classifyLeagueArchetype(fixture)
      expect(result.archetype).not.toBe('casual_social')
    })
  })

  // ── 3. commissioner_driven ────────────────────────────────────────────────────

  describe('3. commissioner_driven', () => {
    it('classifies heavy-workload moderate-engagement league as commissioner_driven', () => {
      const result = classifyLeagueArchetype(commissionerDrivenFixture())
      expect(result.archetype).toBe('commissioner_driven')
      expect(result.confidence).toBeGreaterThanOrEqual(0.50)
    })

    it('commissioner_driven requires heavy/critical workload (gate check)', () => {
      const fixture = { ...commissionerDrivenFixture(), commissionerWorkload: 'light' as const }
      const result = classifyLeagueArchetype(fixture)
      expect(result.archetype).not.toBe('commissioner_driven')
    })

    it('commissioner_driven is blocked when engagement is elite (gate check)', () => {
      const fixture = { ...commissionerDrivenFixture(), leagueEngagementTier: 'elite' as const }
      const result = classifyLeagueArchetype(fixture)
      expect(result.archetype).not.toBe('commissioner_driven')
    })

    it('commissioner_driven derivation includes workload signal', () => {
      const result = classifyLeagueArchetype(commissionerDrivenFixture())
      const cwStep = result.derivation.find(d => d.signal === 'commissionerWorkload')
      expect(cwStep).toBeDefined()
      expect(cwStep?.value).toBe('critical')
    })
  })

  // ── 4. competitive_balanced ───────────────────────────────────────────────────

  describe('4. competitive_balanced', () => {
    it('classifies high-trade + moderate-waiver active league as competitive_balanced', () => {
      const result = classifyLeagueArchetype(competitiveBalancedFixture())
      expect(result.archetype).toBe('competitive_balanced')
      expect(result.confidence).toBeGreaterThanOrEqual(0.50)
    })

    it('competitive_balanced requires both trade AND waiver ≥ moderate (gate — trade only)', () => {
      const fixture = {
        ...competitiveBalancedFixture(),
        waiverActivity: { tier: 'low' as const, perManagerRate: 0.3 },
      }
      const result = classifyLeagueArchetype(fixture)
      expect(result.archetype).not.toBe('competitive_balanced')
    })

    it('competitive_balanced requires both trade AND waiver ≥ moderate (gate — waiver only)', () => {
      const fixture = {
        ...competitiveBalancedFixture(),
        tradeActivity: { tier: 'low' as const, perManagerRate: 0.3 },
      }
      const result = classifyLeagueArchetype(fixture)
      expect(result.archetype).not.toBe('competitive_balanced')
    })
  })

  // ── 5. high_churn_risk ────────────────────────────────────────────────────────

  describe('5. high_churn_risk', () => {
    it('classifies critical-risk + 50% inactive league as high_churn_risk', () => {
      const result = classifyLeagueArchetype(highChurnRiskFixture())
      expect(result.archetype).toBe('high_churn_risk')
      expect(result.confidence).toBeGreaterThanOrEqual(0.50)
    })

    it('high_churn_risk derivation includes retentionRisk signal', () => {
      const result = classifyLeagueArchetype(highChurnRiskFixture())
      const rrStep = result.derivation.find(d => d.signal === 'retentionRisk')
      expect(rrStep).toBeDefined()
      expect(rrStep?.contribution).toMatch(/supports/)
    })

    it('high_churn_risk derivation includes inactivePercent signal', () => {
      const result = classifyLeagueArchetype(highChurnRiskFixture())
      const ipStep = result.derivation.find(d => d.signal === 'participationDistribution.inactivePercent')
      expect(ipStep).toBeDefined()
    })
  })

  // ── 6. low_engagement ─────────────────────────────────────────────────────────

  describe('6. low_engagement', () => {
    it('classifies passive-tier medium-risk league as low_engagement', () => {
      const result = classifyLeagueArchetype(lowEngagementFixture())
      expect(result.archetype).toBe('low_engagement')
      expect(result.confidence).toBeGreaterThanOrEqual(0.50)
    })

    it('low_engagement includes engagement score in derivation', () => {
      const result = classifyLeagueArchetype(lowEngagementFixture())
      const esStep = result.derivation.find(d => d.signal === 'leagueEngagementScore')
      expect(esStep).toBeDefined()
      expect(esStep?.value).toBe(32)
    })
  })

  // ── 7. trade_heavy ────────────────────────────────────────────────────────────

  describe('7. trade_heavy', () => {
    it('classifies high-trade dominant league as trade_heavy', () => {
      const result = classifyLeagueArchetype(tradeHeavyFixture())
      expect(result.archetype).toBe('trade_heavy')
      expect(result.confidence).toBeGreaterThanOrEqual(0.50)
    })

    it('trade_heavy requires trade tier = high (gate check)', () => {
      const fixture = {
        ...tradeHeavyFixture(),
        tradeActivity: { tier: 'moderate' as const, perManagerRate: 2.5 },
      }
      const result = classifyLeagueArchetype(fixture)
      expect(result.archetype).not.toBe('trade_heavy')
    })

    it('trade_heavy derivation includes tradeActivity.tier and tradeActivity.perManagerRate', () => {
      const result = classifyLeagueArchetype(tradeHeavyFixture())
      const ttStep = result.derivation.find(d => d.signal === 'tradeActivity.tier')
      const trStep = result.derivation.find(d => d.signal === 'tradeActivity.perManagerRate')
      expect(ttStep).toBeDefined()
      expect(trStep).toBeDefined()
    })
  })

  // ── 8. waiver_active ──────────────────────────────────────────────────────────

  describe('8. waiver_active', () => {
    it('classifies high-waiver dominant league as waiver_active', () => {
      const result = classifyLeagueArchetype(waiverActiveFixture())
      expect(result.archetype).toBe('waiver_active')
      expect(result.confidence).toBeGreaterThanOrEqual(0.50)
    })

    it('waiver_active requires waiver tier = high (gate check)', () => {
      const fixture = {
        ...waiverActiveFixture(),
        waiverActivity: { tier: 'moderate' as const, perManagerRate: 3.0 },
      }
      const result = classifyLeagueArchetype(fixture)
      expect(result.archetype).not.toBe('waiver_active')
    })

    it('waiver_active derivation includes waiverActivity.perManagerRate signal', () => {
      const result = classifyLeagueArchetype(waiverActiveFixture())
      const wrStep = result.derivation.find(d => d.signal === 'waiverActivity.perManagerRate')
      expect(wrStep).toBeDefined()
      expect(wrStep?.value).toBe(6.8)
    })
  })

  // ── 9. inactive_or_stale ──────────────────────────────────────────────────────

  describe('9. inactive_or_stale', () => {
    it('classifies dormant-tier league as inactive_or_stale', () => {
      const result = classifyLeagueArchetype(inactiveOrStaleFixture())
      expect(result.archetype).toBe('inactive_or_stale')
      expect(result.confidence).toBeGreaterThanOrEqual(0.50)
    })

    it('dormant tier alone (0.60 weight) crosses the MIN_CONFIDENCE threshold', () => {
      // Minimal dormant fixture — only tier is dormant, everything else is neutral
      const minimal: LeagueArchetypeInput = {
        ...base(),
        leagueEngagementTier:  'dormant',
        retentionRisk:         'low',     // no extra support
        participationDistribution: {
          totalManagers:    10,
          activeManagers:   8,
          inactiveManagers: 2,
          activePercent:    80,           // no extra support
          inactivePercent:  20,
        },
      }
      const result = classifyLeagueArchetype(minimal)
      expect(result.archetype).toBe('inactive_or_stale')
      // Should be exactly 0.60 (tier alone, no supporting signals)
      expect(result.confidence).toBeCloseTo(0.60, 2)
    })

    it('inactive_or_stale derivation includes engagement tier signal', () => {
      const result = classifyLeagueArchetype(inactiveOrStaleFixture())
      const etStep = result.derivation.find(d => d.signal === 'leagueEngagementTier')
      expect(etStep).toBeDefined()
      expect(etStep?.value).toBe('dormant')
      expect(etStep?.contribution).toMatch(/supports/)
    })
  })

  // ── 10. unknown ───────────────────────────────────────────────────────────────

  describe('10. unknown — sparse signals', () => {
    it('returns unknown when completeness < 20', () => {
      const result = classifyLeagueArchetype(sparseSignalsFixture())
      expect(result.archetype).toBe('unknown')
      expect(result.confidence).toBe(0)
      expect(result.reasons[0]).toMatch(/Insufficient data/)
    })

    it('returns unknown when no classifier reaches minimum confidence', () => {
      // ET='passive' + RR='low' + IP=29% + all activity 'none':
      //   inactive_or_stale: ET≠dormant → 0
      //   high_churn_risk:   RR=low→0, IP=29%<30%→0, ET=passive→0.20, ES=65>35→0 = 0.20
      //   highly_engaged:    ET=passive→0, RR=low→0.30, AP=71%<75%→0, noActivity→0 = 0.30
      //   low_engagement:    ET=passive→0.45, ES=65>40→0, RR=low→0 = 0.45
      //   All others: gated out. No classifier reaches 0.50 → 'unknown'.
      const noWinner: LeagueArchetypeInput = {
        leagueEngagementScore:     65,
        leagueEngagementTier:      'passive',
        participationDistribution: {
          totalManagers:    7,
          activeManagers:   5,
          inactiveManagers: 2,
          activePercent:    71,
          inactivePercent:  29,
        },
        tradeActivity:  { tier: 'none', perManagerRate: 0 },
        waiverActivity: { tier: 'none', perManagerRate: 0 },
        draftActivity:  { tier: 'none', perManagerRate: 0 },
        retentionRisk:  'low',
        commissionerWorkload: 'light',
        completeness:   70,
      }
      const result = classifyLeagueArchetype(noWinner)
      expect(result.archetype).toBe('unknown')
      expect(result.confidence).toBe(0)
    })

    it('unknown result when totalManagers is zero', () => {
      const noManagers: LeagueArchetypeInput = {
        ...base(),
        participationDistribution: {
          totalManagers:    0,
          activeManagers:   0,
          inactiveManagers: 0,
          activePercent:    0,
          inactivePercent:  0,
        },
      }
      const result = classifyLeagueArchetype(noManagers)
      expect(result.archetype).toBe('unknown')
      expect(result.reasons[0]).toMatch(/No manager data/)
    })

    it('unknown result carries signalCoverage even when sparse', () => {
      const result = classifyLeagueArchetype(sparseSignalsFixture())
      expect(result.signalCoverage).toBeDefined()
      expect(result.signalCoverage.missing).toContain('chatActivity.tier')
    })
  })

  // ── 11. Determinism ───────────────────────────────────────────────────────────

  describe('11. determinism — same input → same output', () => {
    const fixtures: Array<[string, LeagueArchetypeInput]> = [
      ['highlyEngaged',       highlyEngagedFixture()],
      ['casualSocial',        casualSocialFixture()],
      ['commissionerDriven',  commissionerDrivenFixture()],
      ['competitiveBalanced', competitiveBalancedFixture()],
      ['highChurnRisk',       highChurnRiskFixture()],
      ['lowEngagement',       lowEngagementFixture()],
      ['tradeHeavy',          tradeHeavyFixture()],
      ['waiverActive',        waiverActiveFixture()],
      ['inactiveOrStale',     inactiveOrStaleFixture()],
      ['sparse',              sparseSignalsFixture()],
    ]

    for (const [name, fixture] of fixtures) {
      it(`same input → same output for ${name}`, () => {
        const r1 = classifyLeagueArchetype(fixture)
        const r2 = classifyLeagueArchetype(fixture)
        const r3 = classifyLeagueArchetype(fixture)
        expect(r1).toStrictEqual(r2)
        expect(r2).toStrictEqual(r3)
      })
    }
  })

  // ── 12. Derivation chain integrity ───────────────────────────────────────────

  describe('12. derivation chain — all signals present + missing signals listed honestly', () => {
    const ALL_EVALUABLE_SIGNALS = [
      'leagueEngagementTier',
      'leagueEngagementScore',
      'retentionRisk',
      'commissionerWorkload',
      'tradeActivity.tier',
      'tradeActivity.perManagerRate',
      'waiverActivity.tier',
      'waiverActivity.perManagerRate',
      'draftActivity.tier',
      'participationDistribution.activePercent',
      'participationDistribution.inactivePercent',
      'participationDistribution.totalManagers',
      'completeness',
    ]

    const FUTURE_SIGNALS = [
      'chatActivity.tier',
      'commissionerPostCadence',
      'weekOverWeekEngagementDelta',
      'historicalRetentionRate',
      'benchmarkPercentile',
    ]

    it('result version is always ARCHETYPE_VERSION', () => {
      expect(classifyLeagueArchetype(highlyEngagedFixture()).version).toBe(ARCHETYPE_VERSION)
      expect(classifyLeagueArchetype(inactiveOrStaleFixture()).version).toBe(ARCHETYPE_VERSION)
      expect(classifyLeagueArchetype(sparseSignalsFixture()).version).toBe(ARCHETYPE_VERSION)
      expect(ARCHETYPE_VERSION).toBe('6.3.0')
    })

    it('signalCoverage.available lists all evaluable signals when completeness > 0', () => {
      const result = classifyLeagueArchetype(highlyEngagedFixture())
      for (const sig of ALL_EVALUABLE_SIGNALS) {
        expect(result.signalCoverage.available).toContain(sig)
      }
    })

    it('signalCoverage.missing lists all future signals', () => {
      const result = classifyLeagueArchetype(highlyEngagedFixture())
      for (const sig of FUTURE_SIGNALS) {
        expect(result.signalCoverage.missing).toContain(sig)
      }
    })

    it('derivation chain is non-empty for every non-trivially-blocked archetype', () => {
      const results = [
        classifyLeagueArchetype(highlyEngagedFixture()),
        classifyLeagueArchetype(casualSocialFixture()),
        classifyLeagueArchetype(commissionerDrivenFixture()),
        classifyLeagueArchetype(competitiveBalancedFixture()),
        classifyLeagueArchetype(highChurnRiskFixture()),
        classifyLeagueArchetype(lowEngagementFixture()),
        classifyLeagueArchetype(tradeHeavyFixture()),
        classifyLeagueArchetype(waiverActiveFixture()),
        classifyLeagueArchetype(inactiveOrStaleFixture()),
      ]
      for (const result of results) {
        expect(result.derivation.length).toBeGreaterThan(0)
      }
    })

    it('every derivation step has signal, value, and contribution fields', () => {
      const result = classifyLeagueArchetype(highlyEngagedFixture())
      for (const step of result.derivation) {
        expect(typeof step.signal).toBe('string')
        expect(step.signal.length).toBeGreaterThan(0)
        expect(step.value).not.toBeUndefined()
        expect(typeof step.contribution).toBe('string')
        expect(step.contribution.length).toBeGreaterThan(0)
      }
    })

    it('contribution strings are prefixed with "supports:" or "neutral:"', () => {
      const result = classifyLeagueArchetype(highlyEngagedFixture())
      for (const step of result.derivation) {
        expect(step.contribution).toMatch(/^(supports:|neutral:)/)
      }
    })

    it('every winning archetype result has at least one "supports:" contribution in derivation', () => {
      const results = [
        classifyLeagueArchetype(highlyEngagedFixture()),
        classifyLeagueArchetype(casualSocialFixture()),
        classifyLeagueArchetype(commissionerDrivenFixture()),
        classifyLeagueArchetype(tradeHeavyFixture()),
        classifyLeagueArchetype(waiverActiveFixture()),
        classifyLeagueArchetype(inactiveOrStaleFixture()),
      ]
      for (const result of results) {
        const hasSupport = result.derivation.some(d => d.contribution.startsWith('supports:'))
        expect(hasSupport).toBe(true)
      }
    })

    it('confidence is capped at 1.0', () => {
      // inactiveOrStale with all supporting signals = 0.60+0.25+0.15 = 1.00 exactly
      const result = classifyLeagueArchetype(inactiveOrStaleFixture())
      expect(result.confidence).toBeLessThanOrEqual(1.0)
    })
  })
})
