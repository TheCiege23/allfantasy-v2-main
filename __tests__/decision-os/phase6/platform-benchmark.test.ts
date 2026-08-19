/**
 * Decision OS — Phase 6.5 Platform Benchmarking tests.
 *
 * Coverage:
 *  1.  Percentile math — min=0, max=100, correct distribution
 *  2.  Rank math — rank 1 is the best (highest value)
 *  3.  Sparse platform (< 3 leagues) — insufficientData flag + null archetype ranks
 *  4.  Empty input — graceful zero output
 *  5.  Missing archetypes — leagues without an archetype entry get 'unknown'
 *  6.  'unknown' archetype — never gets cohort percentiles
 *  7.  Archetype cohort grouping — correct membership, averages, distributions
 *  8.  Small cohort (< 3 members) — archetypePercentile = null + 'small_cohort' warning
 *  9.  Top/bottom league signals — correct ordering + tie-break by leagueId
 * 10.  Platform statistics — avg, median, P25, P75
 * 11.  No mutation of input arrays
 * 12.  Deterministic — same input → same output
 * 13.  Completeness + warnings per league
 * 14.  Version is BENCHMARK_VERSION
 * 15.  Retention safety and commissioner efficiency inversion mappings
 */

import { describe, it, expect } from 'vitest'
import {
  assemblePlatformBenchmark,
  BENCHMARK_VERSION,
} from '@/lib/decision-os/phase6/benchmark/benchmark'
import type {
  LeagueSignalInput,
  TaggedArchetypeResult,
} from '@/lib/decision-os/phase6/benchmark/types'

// ── Fixture factories ─────────────────────────────────────────────────────────

function makeSignal(
  leagueId: string,
  engagementScore: number,
  opts: {
    retentionRisk?:       'low' | 'medium' | 'high' | 'critical'
    tradeRate?:           number
    waiverRate?:          number
    commissionerWorkload?: 'light' | 'moderate' | 'heavy' | 'critical'
    completeness?:        number
  } = {},
): LeagueSignalInput {
  return {
    leagueId,
    leagueEngagementScore: engagementScore,
    retentionRisk:          opts.retentionRisk          ?? 'low',
    tradeActivity:          { perManagerRate: opts.tradeRate   ?? 1.0 },
    waiverActivity:         { perManagerRate: opts.waiverRate  ?? 2.0 },
    commissionerWorkload:   opts.commissionerWorkload   ?? 'moderate',
    completeness:           opts.completeness           ?? 80,
  }
}

function makeArchetype(leagueId: string, archetype: string, confidence = 0.80): TaggedArchetypeResult {
  return { leagueId, archetype, confidence }
}

/** Five leagues with distinct scores 20/40/60/80/100. */
function fiveLeagueFixture(): {
  signals: LeagueSignalInput[]
  archetypes: TaggedArchetypeResult[]
} {
  const signals = [
    makeSignal('l-a', 100, { retentionRisk: 'low',      tradeRate: 5.0, waiverRate: 6.0, commissionerWorkload: 'light' }),
    makeSignal('l-b',  80, { retentionRisk: 'low',      tradeRate: 3.0, waiverRate: 4.0, commissionerWorkload: 'moderate' }),
    makeSignal('l-c',  60, { retentionRisk: 'medium',   tradeRate: 2.0, waiverRate: 3.0, commissionerWorkload: 'moderate' }),
    makeSignal('l-d',  40, { retentionRisk: 'high',     tradeRate: 1.0, waiverRate: 2.0, commissionerWorkload: 'heavy' }),
    makeSignal('l-e',  20, { retentionRisk: 'critical', tradeRate: 0.0, waiverRate: 1.0, commissionerWorkload: 'critical' }),
  ]
  const archetypes = [
    makeArchetype('l-a', 'highly_engaged'),
    makeArchetype('l-b', 'highly_engaged'),
    makeArchetype('l-c', 'casual_social'),
    makeArchetype('l-d', 'high_churn_risk'),
    makeArchetype('l-e', 'inactive_or_stale'),
  ]
  return { signals, archetypes }
}

/** Three leagues with same engagement score (for tie-break testing). */
function tiedScoreFixture(): {
  signals: LeagueSignalInput[]
  archetypes: TaggedArchetypeResult[]
} {
  const signals = [
    makeSignal('z-league', 70),
    makeSignal('a-league', 70),
    makeSignal('m-league', 70),
  ]
  const archetypes = [
    makeArchetype('z-league', 'casual_social'),
    makeArchetype('a-league', 'casual_social'),
    makeArchetype('m-league', 'casual_social'),
  ]
  return { signals, archetypes }
}

// ── 1. Percentile math ────────────────────────────────────────────────────────

describe('Phase 6.5 — Platform Benchmarking', () => {
  describe('1. Percentile math — distribution correctness', () => {
    it('highest engagement score gets percentile 100', () => {
      const { signals, archetypes } = fiveLeagueFixture()
      const result = assemblePlatformBenchmark(signals, archetypes)
      const best = result.leagueBenchmarks.find((b) => b.leagueId === 'l-a')!
      expect(best.engagement.percentile).toBe(100)
    })

    it('lowest engagement score gets percentile 0', () => {
      const { signals, archetypes } = fiveLeagueFixture()
      const result = assemblePlatformBenchmark(signals, archetypes)
      const worst = result.leagueBenchmarks.find((b) => b.leagueId === 'l-e')!
      expect(worst.engagement.percentile).toBe(0)
    })

    it('middle engagement score gets percentile 50 in a 5-league set', () => {
      const { signals, archetypes } = fiveLeagueFixture()
      const result = assemblePlatformBenchmark(signals, archetypes)
      // l-c has score 60 — middle of [20,40,60,80,100], rank 3/5, percentile = (5-3)/(5-1)*100 = 50
      const mid = result.leagueBenchmarks.find((b) => b.leagueId === 'l-c')!
      expect(mid.engagement.percentile).toBe(50)
    })

    it('percentiles are all within [0, 100]', () => {
      const { signals, archetypes } = fiveLeagueFixture()
      const result = assemblePlatformBenchmark(signals, archetypes)
      for (const lb of result.leagueBenchmarks) {
        expect(lb.engagement.percentile).toBeGreaterThanOrEqual(0)
        expect(lb.engagement.percentile).toBeLessThanOrEqual(100)
        expect(lb.retentionSafety.percentile).toBeGreaterThanOrEqual(0)
        expect(lb.retentionSafety.percentile).toBeLessThanOrEqual(100)
        expect(lb.tradeActivity.percentile).toBeGreaterThanOrEqual(0)
        expect(lb.tradeActivity.percentile).toBeLessThanOrEqual(100)
        expect(lb.waiverActivity.percentile).toBeGreaterThanOrEqual(0)
        expect(lb.waiverActivity.percentile).toBeLessThanOrEqual(100)
        expect(lb.commissionerEfficiency.percentile).toBeGreaterThanOrEqual(0)
        expect(lb.commissionerEfficiency.percentile).toBeLessThanOrEqual(100)
      }
    })

    it('single-league set: all percentiles are 50', () => {
      const signal = makeSignal('solo', 65)
      const archetype = makeArchetype('solo', 'casual_social')
      const result = assemblePlatformBenchmark([signal], [archetype])
      const lb = result.leagueBenchmarks[0]!
      expect(lb.engagement.percentile).toBe(50)
      expect(lb.retentionSafety.percentile).toBe(50)
    })
  })

  // ── 2. Rank math ─────────────────────────────────────────────────────────────

  describe('2. Rank math', () => {
    it('highest engagement score gets rank 1', () => {
      const { signals, archetypes } = fiveLeagueFixture()
      const result = assemblePlatformBenchmark(signals, archetypes)
      const best = result.leagueBenchmarks.find((b) => b.leagueId === 'l-a')!
      expect(best.engagement.rank).toBe(1)
    })

    it('lowest engagement score gets rank equal to total', () => {
      const { signals, archetypes } = fiveLeagueFixture()
      const result = assemblePlatformBenchmark(signals, archetypes)
      const worst = result.leagueBenchmarks.find((b) => b.leagueId === 'l-e')!
      expect(worst.engagement.rank).toBe(5)
      expect(worst.engagement.total).toBe(5)
    })

    it('tied scores get the same rank', () => {
      const { signals, archetypes } = tiedScoreFixture()
      const result = assemblePlatformBenchmark(signals, archetypes)
      const ranks = result.leagueBenchmarks.map((b) => b.engagement.rank)
      // All three should have rank 1 (no value above 70)
      expect(ranks).toEqual([1, 1, 1])
    })
  })

  // ── 3. Sparse platform (< 3 leagues) ─────────────────────────────────────────

  describe('3. Sparse platform — < 3 leagues', () => {
    it('insufficientData = true for 1 league', () => {
      const result = assemblePlatformBenchmark(
        [makeSignal('solo', 50)],
        [makeArchetype('solo', 'casual_social')],
      )
      expect(result.insufficientData).toBe(true)
      expect(result.leagueBenchmarks[0]!.insufficient).toBe(true)
    })

    it('insufficientData = true for 2 leagues', () => {
      const result = assemblePlatformBenchmark(
        [makeSignal('a', 80), makeSignal('b', 40)],
        [makeArchetype('a', 'highly_engaged'), makeArchetype('b', 'low_engagement')],
      )
      expect(result.insufficientData).toBe(true)
    })

    it('insufficientData = false for 3 leagues', () => {
      const result = assemblePlatformBenchmark(
        [makeSignal('a', 80), makeSignal('b', 60), makeSignal('c', 40)],
        [
          makeArchetype('a', 'highly_engaged'),
          makeArchetype('b', 'casual_social'),
          makeArchetype('c', 'low_engagement'),
        ],
      )
      expect(result.insufficientData).toBe(false)
    })

    it('sparse platform still computes per-league benchmarks', () => {
      const result = assemblePlatformBenchmark(
        [makeSignal('a', 70), makeSignal('b', 30)],
        [makeArchetype('a', 'casual_social'), makeArchetype('b', 'low_engagement')],
      )
      expect(result.leagueBenchmarks).toHaveLength(2)
      expect(result.leagueBenchmarks[0]!.engagement.percentile).toBeGreaterThanOrEqual(0)
    })

    it('sparse platform league gets insufficient_platform_sample warning', () => {
      const result = assemblePlatformBenchmark(
        [makeSignal('a', 70)],
        [makeArchetype('a', 'casual_social')],
      )
      expect(result.leagueBenchmarks[0]!.warnings).toContain('insufficient_platform_sample')
    })
  })

  // ── 4. Empty input ────────────────────────────────────────────────────────────

  describe('4. Empty input — graceful zero output', () => {
    it('empty signals produce empty benchmark', () => {
      const result = assemblePlatformBenchmark([], [])
      expect(result.leagueBenchmarks).toHaveLength(0)
      expect(result.archetypeCohorts).toHaveLength(0)
      expect(result.insufficientData).toBe(true)
      expect(result.totalLeaguesBenchmarked).toBe(0)
      expect(result.warnings).toContain('no_league_signals_provided')
    })

    it('empty signals produce zero platform stats', () => {
      const result = assemblePlatformBenchmark([], [])
      expect(result.platformStats.totalLeagues).toBe(0)
      expect(result.platformStats.avgEngagementScore).toBe(0)
      expect(result.platformStats.medianEngagementScore).toBe(0)
    })
  })

  // ── 5. Missing archetypes ─────────────────────────────────────────────────────

  describe('5. Missing archetype entries default to "unknown"', () => {
    it('league with no matching archetype entry gets archetype = "unknown"', () => {
      const signals = [makeSignal('orphan', 55), makeSignal('known', 65)]
      // Only 'known' has an archetype entry
      const archetypes = [makeArchetype('known', 'casual_social')]
      const result = assemblePlatformBenchmark(signals, archetypes)
      const orphanBenchmark = result.leagueBenchmarks.find((b) => b.leagueId === 'orphan')!
      expect(orphanBenchmark.archetype).toBe('unknown')
    })

    it('platform-wide percentiles are still computed for leagues with unknown archetype', () => {
      const signals = [makeSignal('orphan', 55), makeSignal('known', 65)]
      const archetypes = [makeArchetype('known', 'casual_social')]
      const result = assemblePlatformBenchmark(signals, archetypes)
      const orphanBenchmark = result.leagueBenchmarks.find((b) => b.leagueId === 'orphan')!
      expect(orphanBenchmark.engagement.total).toBe(2)
      expect(orphanBenchmark.engagement.percentile).toBeGreaterThanOrEqual(0)
    })
  })

  // ── 6. 'unknown' archetype has no cohort percentiles ─────────────────────────

  describe('6. "unknown" archetype — no cohort benchmarks', () => {
    it('league with archetype "unknown" always has null archetypePercentile', () => {
      const signals = [makeSignal('u1', 60), makeSignal('u2', 70), makeSignal('u3', 50)]
      const archetypes = [
        makeArchetype('u1', 'unknown'),
        makeArchetype('u2', 'unknown'),
        makeArchetype('u3', 'unknown'),
      ]
      const result = assemblePlatformBenchmark(signals, archetypes)
      for (const lb of result.leagueBenchmarks) {
        expect(lb.engagement.archetypePercentile).toBeNull()
        expect(lb.engagement.archetypeRank).toBeNull()
        expect(lb.engagement.archetypeCohortSize).toBe(0)
      }
    })

    it('"unknown" leagues do not appear in archetypeCohorts', () => {
      const signals = [makeSignal('u1', 60), makeSignal('u2', 70)]
      const archetypes = [makeArchetype('u1', 'unknown'), makeArchetype('u2', 'unknown')]
      const result = assemblePlatformBenchmark(signals, archetypes)
      const unknownCohort = result.archetypeCohorts.find((c) => c.archetype === 'unknown')
      expect(unknownCohort).toBeUndefined()
    })
  })

  // ── 7. Archetype cohort grouping ──────────────────────────────────────────────

  describe('7. Archetype cohort grouping', () => {
    it('cohort stats count is correct per archetype', () => {
      const { signals, archetypes } = fiveLeagueFixture()
      const result = assemblePlatformBenchmark(signals, archetypes)
      const highlyEngaged = result.archetypeCohorts.find((c) => c.archetype === 'highly_engaged')!
      expect(highlyEngaged.count).toBe(2) // l-a and l-b
      const inactiveOrStale = result.archetypeCohorts.find((c) => c.archetype === 'inactive_or_stale')!
      expect(inactiveOrStale.count).toBe(1)
    })

    it('cohort avgEngagementScore is arithmetic mean of its members', () => {
      const { signals, archetypes } = fiveLeagueFixture()
      const result = assemblePlatformBenchmark(signals, archetypes)
      // highly_engaged: l-a=100, l-b=80 → avg=90
      const cohort = result.archetypeCohorts.find((c) => c.archetype === 'highly_engaged')!
      expect(cohort.avgEngagementScore).toBe(90)
    })

    it('cohort medianEngagementScore is correct for even count', () => {
      // 4 leagues in same archetype: scores 20, 40, 60, 80 → median = (40+60)/2 = 50
      const signals = [
        makeSignal('e1', 20), makeSignal('e2', 40),
        makeSignal('e3', 60), makeSignal('e4', 80),
      ]
      const archetypes = signals.map((s) => makeArchetype(s.leagueId, 'waiver_active'))
      const result = assemblePlatformBenchmark(signals, archetypes)
      const cohort = result.archetypeCohorts.find((c) => c.archetype === 'waiver_active')!
      expect(cohort.medianEngagementScore).toBe(50)
    })

    it('cohort retentionRiskDistribution sums to cohort count', () => {
      const { signals, archetypes } = fiveLeagueFixture()
      const result = assemblePlatformBenchmark(signals, archetypes)
      for (const cohort of result.archetypeCohorts) {
        const total =
          cohort.retentionRiskDistribution.low +
          cohort.retentionRiskDistribution.medium +
          cohort.retentionRiskDistribution.high +
          cohort.retentionRiskDistribution.critical
        expect(total).toBe(cohort.count)
      }
    })

    it('archetypeCohorts are sorted by count descending', () => {
      // Create a set where one archetype has 3 members and another has 1
      const signals = [
        makeSignal('a', 70), makeSignal('b', 80), makeSignal('c', 60),
        makeSignal('d', 50),
      ]
      const archetypes = [
        makeArchetype('a', 'trade_heavy'),
        makeArchetype('b', 'trade_heavy'),
        makeArchetype('c', 'trade_heavy'),
        makeArchetype('d', 'waiver_active'),
      ]
      const result = assemblePlatformBenchmark(signals, archetypes)
      expect(result.archetypeCohorts[0]!.archetype).toBe('trade_heavy')
      expect(result.archetypeCohorts[0]!.count).toBe(3)
      expect(result.archetypeCohorts[1]!.count).toBe(1)
    })
  })

  // ── 8. Small cohort (< 3 members) ────────────────────────────────────────────

  describe('8. Small cohort — archetypePercentile = null + small_cohort warning', () => {
    it('archetype cohort of 1 yields null archetypePercentile for its member', () => {
      const signals = [
        makeSignal('solo-c', 60),
        makeSignal('a',      80),
        makeSignal('b',      70),
        makeSignal('c',      50),
      ]
      const archetypes = [
        makeArchetype('solo-c', 'inactive_or_stale'), // cohort size 1
        makeArchetype('a', 'highly_engaged'),
        makeArchetype('b', 'highly_engaged'),
        makeArchetype('c', 'highly_engaged'),
      ]
      const result = assemblePlatformBenchmark(signals, archetypes)
      const soloBench = result.leagueBenchmarks.find((b) => b.leagueId === 'solo-c')!
      expect(soloBench.engagement.archetypePercentile).toBeNull()
      expect(soloBench.engagement.archetypeRank).toBeNull()
    })

    it('archetype cohort of 1 carries small_cohort_low_confidence warning in ArchetypeCohortStats', () => {
      const signals = [
        makeSignal('solo-c', 60),
        makeSignal('a', 80), makeSignal('b', 70), makeSignal('c', 50),
      ]
      const archetypes = [
        makeArchetype('solo-c', 'inactive_or_stale'),
        makeArchetype('a', 'highly_engaged'),
        makeArchetype('b', 'highly_engaged'),
        makeArchetype('c', 'highly_engaged'),
      ]
      const result = assemblePlatformBenchmark(signals, archetypes)
      const cohort = result.archetypeCohorts.find((c) => c.archetype === 'inactive_or_stale')!
      expect(cohort.warnings).toContain('small_cohort_low_confidence')
    })

    it('archetype cohort of 3 yields valid archetypePercentile', () => {
      const signals = [
        makeSignal('he-1', 90, { tradeRate: 4 }),
        makeSignal('he-2', 70, { tradeRate: 2 }),
        makeSignal('he-3', 50, { tradeRate: 1 }),
      ]
      const archetypes = signals.map((s) => makeArchetype(s.leagueId, 'highly_engaged'))
      const result = assemblePlatformBenchmark(signals, archetypes)
      const best = result.leagueBenchmarks.find((b) => b.leagueId === 'he-1')!
      expect(best.engagement.archetypePercentile).toBe(100)
      const worst = result.leagueBenchmarks.find((b) => b.leagueId === 'he-3')!
      expect(worst.engagement.archetypePercentile).toBe(0)
    })
  })

  // ── 9. Top/bottom league signals ──────────────────────────────────────────────

  describe('9. Top/bottom league signals — ordering + tie-break', () => {
    it('topLeagues are ordered by engagement score descending', () => {
      const { signals, archetypes } = fiveLeagueFixture()
      const result = assemblePlatformBenchmark(signals, archetypes)
      expect(result.topLeagues[0]!.leagueId).toBe('l-a') // score 100
      expect(result.topLeagues[1]!.leagueId).toBe('l-b') // score 80
      expect(result.topLeagues[2]!.leagueId).toBe('l-c') // score 60
    })

    it('bottomLeagues are ordered by engagement score ascending', () => {
      const { signals, archetypes } = fiveLeagueFixture()
      const result = assemblePlatformBenchmark(signals, archetypes)
      expect(result.bottomLeagues[0]!.leagueId).toBe('l-e') // score 20
      expect(result.bottomLeagues[1]!.leagueId).toBe('l-d') // score 40
      expect(result.bottomLeagues[2]!.leagueId).toBe('l-c') // score 60
    })

    it('topTradeLeagues are ordered by trade rate descending', () => {
      const { signals, archetypes } = fiveLeagueFixture()
      const result = assemblePlatformBenchmark(signals, archetypes)
      expect(result.topTradeLeagues[0]!.leagueId).toBe('l-a') // rate 5.0
      expect(result.topTradeLeagues[1]!.leagueId).toBe('l-b') // rate 3.0
    })

    it('topWaiverLeagues are ordered by waiver rate descending', () => {
      const { signals, archetypes } = fiveLeagueFixture()
      const result = assemblePlatformBenchmark(signals, archetypes)
      expect(result.topWaiverLeagues[0]!.leagueId).toBe('l-a') // rate 6.0
    })

    it('ties in top list are broken by leagueId ascending', () => {
      const { signals, archetypes } = tiedScoreFixture()
      const result = assemblePlatformBenchmark(signals, archetypes)
      // All three tied at 70; top list should order by leagueId ascending
      expect(result.topLeagues[0]!.leagueId).toBe('a-league')
      expect(result.topLeagues[1]!.leagueId).toBe('m-league')
      expect(result.topLeagues[2]!.leagueId).toBe('z-league')
    })

    it('top lists are capped at 3 entries', () => {
      const { signals, archetypes } = fiveLeagueFixture()
      const result = assemblePlatformBenchmark(signals, archetypes)
      expect(result.topLeagues).toHaveLength(3)
      expect(result.bottomLeagues).toHaveLength(3)
      expect(result.topTradeLeagues).toHaveLength(3)
      expect(result.topWaiverLeagues).toHaveLength(3)
    })
  })

  // ── 10. Platform statistics ───────────────────────────────────────────────────

  describe('10. Platform statistics — avg, median, P25, P75', () => {
    it('avgEngagementScore is arithmetic mean', () => {
      const { signals, archetypes } = fiveLeagueFixture()
      const result = assemblePlatformBenchmark(signals, archetypes)
      // [20,40,60,80,100] → mean = 60
      expect(result.platformStats.avgEngagementScore).toBe(60)
    })

    it('medianEngagementScore is correct for odd count', () => {
      const { signals, archetypes } = fiveLeagueFixture()
      const result = assemblePlatformBenchmark(signals, archetypes)
      // [20,40,60,80,100] → median = 60
      expect(result.platformStats.medianEngagementScore).toBe(60)
    })

    it('p75 and p25 bracket the median', () => {
      const { signals, archetypes } = fiveLeagueFixture()
      const result = assemblePlatformBenchmark(signals, archetypes)
      expect(result.platformStats.p75EngagementScore).toBeGreaterThanOrEqual(
        result.platformStats.medianEngagementScore,
      )
      expect(result.platformStats.p25EngagementScore).toBeLessThanOrEqual(
        result.platformStats.medianEngagementScore,
      )
    })

    it('archetypeDistribution sums to totalLeagues', () => {
      const { signals, archetypes } = fiveLeagueFixture()
      const result = assemblePlatformBenchmark(signals, archetypes)
      const total = Object.values(result.platformStats.archetypeDistribution).reduce((s, n) => s + n, 0)
      expect(total).toBe(result.platformStats.totalLeagues)
    })

    it('archetypeDistribution reflects correct counts', () => {
      const { signals, archetypes } = fiveLeagueFixture()
      const result = assemblePlatformBenchmark(signals, archetypes)
      // 2 highly_engaged, 1 casual_social, 1 high_churn_risk, 1 inactive_or_stale
      expect(result.platformStats.archetypeDistribution['highly_engaged']).toBe(2)
      expect(result.platformStats.archetypeDistribution['casual_social']).toBe(1)
    })
  })

  // ── 11. No mutation of input arrays ──────────────────────────────────────────

  describe('11. No mutation of input arrays', () => {
    it('input signals array is not modified', () => {
      const { signals, archetypes } = fiveLeagueFixture()
      const originalSignalIds = signals.map((s) => s.leagueId)
      const originalEngagement = signals.map((s) => s.leagueEngagementScore)
      assemblePlatformBenchmark(signals, archetypes)
      expect(signals.map((s) => s.leagueId)).toEqual(originalSignalIds)
      expect(signals.map((s) => s.leagueEngagementScore)).toEqual(originalEngagement)
    })

    it('input archetypes array is not modified', () => {
      const { signals, archetypes } = fiveLeagueFixture()
      const originalIds = archetypes.map((a) => a.leagueId)
      const originalLabels = archetypes.map((a) => a.archetype)
      assemblePlatformBenchmark(signals, archetypes)
      expect(archetypes.map((a) => a.leagueId)).toEqual(originalIds)
      expect(archetypes.map((a) => a.archetype)).toEqual(originalLabels)
    })
  })

  // ── 12. Deterministic ─────────────────────────────────────────────────────────

  describe('12. Determinism — same input → same output', () => {
    it('same inputs produce identical results across three calls', () => {
      const { signals, archetypes } = fiveLeagueFixture()
      const r1 = assemblePlatformBenchmark(signals, archetypes)
      const r2 = assemblePlatformBenchmark(signals, archetypes)
      const r3 = assemblePlatformBenchmark(signals, archetypes)
      expect(r1).toStrictEqual(r2)
      expect(r2).toStrictEqual(r3)
    })

    it('same inputs in different object references produce identical results', () => {
      const { signals: s1, archetypes: a1 } = fiveLeagueFixture()
      const { signals: s2, archetypes: a2 } = fiveLeagueFixture()
      const r1 = assemblePlatformBenchmark(s1, a1)
      const r2 = assemblePlatformBenchmark(s2, a2)
      expect(r1).toStrictEqual(r2)
    })
  })

  // ── 13. Completeness + per-league warnings ────────────────────────────────────

  describe('13. Completeness + per-league warnings', () => {
    it('benchmarkCompleteness matches the league signal completeness', () => {
      const signal = makeSignal('l1', 70, { completeness: 45 })
      const archetype = makeArchetype('l1', 'casual_social')
      // Need 3 leagues for non-insufficient
      const result = assemblePlatformBenchmark(
        [signal, makeSignal('l2', 80), makeSignal('l3', 60)],
        [archetype, makeArchetype('l2', 'highly_engaged'), makeArchetype('l3', 'low_engagement')],
      )
      const lb = result.leagueBenchmarks.find((b) => b.leagueId === 'l1')!
      expect(lb.benchmarkCompleteness).toBe(45)
    })

    it('low_league_completeness warning for completeness < 30', () => {
      const lowCompleteness = makeSignal('low', 60, { completeness: 20 })
      const result = assemblePlatformBenchmark(
        [lowCompleteness, makeSignal('b', 70), makeSignal('c', 80)],
        [
          makeArchetype('low', 'casual_social'),
          makeArchetype('b', 'highly_engaged'),
          makeArchetype('c', 'highly_engaged'),
        ],
      )
      const lb = result.leagueBenchmarks.find((b) => b.leagueId === 'low')!
      expect(lb.warnings).toContain('low_league_completeness')
    })

    it('no low_completeness warning when completeness >= 30', () => {
      const goodSignal = makeSignal('good', 60, { completeness: 80 })
      const result = assemblePlatformBenchmark(
        [goodSignal, makeSignal('b', 70), makeSignal('c', 80)],
        [
          makeArchetype('good', 'casual_social'),
          makeArchetype('b', 'highly_engaged'),
          makeArchetype('c', 'highly_engaged'),
        ],
      )
      const lb = result.leagueBenchmarks.find((b) => b.leagueId === 'good')!
      expect(lb.warnings).not.toContain('low_league_completeness')
    })
  })

  // ── 14. Version ───────────────────────────────────────────────────────────────

  describe('14. Version is BENCHMARK_VERSION', () => {
    it('result carries BENCHMARK_VERSION', () => {
      const result = assemblePlatformBenchmark([], [])
      expect(result.version).toBe(BENCHMARK_VERSION)
      expect(BENCHMARK_VERSION).toBe('6.5.0')
    })

    it('BENCHMARK_VERSION is stable across calls', () => {
      const r1 = assemblePlatformBenchmark([], [])
      const r2 = assemblePlatformBenchmark([], [])
      expect(r1.version).toBe(r2.version)
    })
  })

  // ── 15. Retention safety and commissioner efficiency inversions ───────────────

  describe('15. Inversion mappings for retention safety and commissioner efficiency', () => {
    it('low retentionRisk produces highest retentionSafety percentile', () => {
      const signals = [
        makeSignal('safe',    80, { retentionRisk: 'low' }),
        makeSignal('risky',   80, { retentionRisk: 'critical' }),
        makeSignal('mid',     80, { retentionRisk: 'medium' }),
      ]
      const archetypes = signals.map((s) => makeArchetype(s.leagueId, 'highly_engaged'))
      const result = assemblePlatformBenchmark(signals, archetypes)
      const safe  = result.leagueBenchmarks.find((b) => b.leagueId === 'safe')!
      const risky = result.leagueBenchmarks.find((b) => b.leagueId === 'risky')!
      expect(safe.retentionSafety.percentile).toBe(100)
      expect(risky.retentionSafety.percentile).toBe(0)
    })

    it('light commissionerWorkload produces highest commissionerEfficiency percentile', () => {
      const signals = [
        makeSignal('eff',       70, { commissionerWorkload: 'light' }),
        makeSignal('overloaded',70, { commissionerWorkload: 'critical' }),
        makeSignal('mid',       70, { commissionerWorkload: 'moderate' }),
      ]
      const archetypes = signals.map((s) => makeArchetype(s.leagueId, 'casual_social'))
      const result = assemblePlatformBenchmark(signals, archetypes)
      const eff  = result.leagueBenchmarks.find((b) => b.leagueId === 'eff')!
      const over = result.leagueBenchmarks.find((b) => b.leagueId === 'overloaded')!
      expect(eff.commissionerEfficiency.percentile).toBe(100)
      expect(over.commissionerEfficiency.percentile).toBe(0)
    })

    it('retentionSafety value reflects inversion mapping', () => {
      const signal = makeSignal('test', 70, { retentionRisk: 'high' })
      const archetype = makeArchetype('test', 'high_churn_risk')
      const result = assemblePlatformBenchmark([signal], [archetype])
      // 'high' retention risk → safety score 1
      expect(result.leagueBenchmarks[0]!.retentionSafety.value).toBe(1)
    })

    it('commissionerEfficiency value reflects inversion mapping', () => {
      const signal = makeSignal('test', 70, { commissionerWorkload: 'heavy' })
      const archetype = makeArchetype('test', 'commissioner_driven')
      const result = assemblePlatformBenchmark([signal], [archetype])
      // 'heavy' workload → efficiency score 1
      expect(result.leagueBenchmarks[0]!.commissionerEfficiency.value).toBe(1)
    })
  })
})
