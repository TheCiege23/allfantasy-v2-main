/**
 * Decision OS Manager Intelligence Platform — Phase 4: Transaction Readiness aggregator.
 *
 * Pure, deterministic aggregation + contract tests. No DB, no mocks — plain
 * roster fixtures in, `ManagerTransactionReadinessV1` out. Covers the spec's
 * required cases (empty roster, healthy flexible roster, injury pressure, bye
 * pressure, tight bench, high roster pressure, missing roster settings, no
 * recommendation language) plus the documented thresholds, counts, and determinism.
 */
import { describe, it, expect } from 'vitest'
import { aggregateTransactionReadiness } from '@/lib/decision-os/manager-intelligence/transaction-readiness/transactionReadinessAggregator'
import {
  MANAGER_TRANSACTION_READINESS_VERSION,
  type TransactionReadinessRosterConfigInput,
  type TransactionReadinessRosterPlayerInput,
} from '@/lib/decision-os/manager-intelligence/transaction-readiness/types'

const FIXED = new Date('2026-10-08T00:00:00.000Z')

function p(
  slotType: string,
  injuryStatus: string | null = null,
  byeWeek: number | null = null,
  droppedAt: Date | string | null = null,
): TransactionReadinessRosterPlayerInput {
  return { slotType, injuryStatus, byeWeek, droppedAt }
}
function cfg(maxRosterSize = 15, source: 'commissioner' | 'defaults' = 'commissioner'): TransactionReadinessRosterConfigInput {
  return { maxRosterSize, source }
}
const STARTERS = () => [p('QB'), p('RB'), p('RB'), p('WR'), p('WR'), p('TE'), p('FLEX'), p('K'), p('DEF')]
const BENCH = (n: number) => Array.from({ length: n }, () => p('BENCH'))

// Banned recommendation/advice language (word-boundary so "reserve"/"counts" are safe).
const BANNED = /\b(add|drop|waiver|recommend|pickup|claim|target)\b|trade for/i

describe('aggregateTransactionReadiness — empty roster', () => {
  it('returns null when there are no active players', () => {
    expect(aggregateTransactionReadiness({ players: [], currentWeek: 5, rosterConfig: cfg() }, FIXED)).toBeNull()
    const allDropped = [p('QB', null, null, new Date()), p('BENCH', null, null, '2026-10-01')]
    expect(aggregateTransactionReadiness({ players: allDropped, currentWeek: 5, rosterConfig: cfg() }, FIXED)).toBeNull()
  })
})

describe('aggregateTransactionReadiness — healthy flexible roster', () => {
  it('all pressures low, bench flexible, low roster pressure', () => {
    const t = aggregateTransactionReadiness({ players: [...STARTERS(), ...BENCH(6)], currentWeek: 5, rosterConfig: cfg(16) }, FIXED)!
    expect(t.injuryPressure).toBe('low')
    expect(t.byePressure).toBe('low')
    expect(t.benchFlexibility).toBe('flexible')
    expect(t.rosterPressure).toBe('low')
    expect(t.benchCount).toBe(6)
    expect(t.reserveCount).toBe(6)
    expect(t.injuredReserveCount).toBe(0)
    expect(t.rosterOpenings).toBe(1) // 16 max − 15 active
    expect(t.summary).toMatch(/low transaction pressure this week/i)
  })
})

describe('aggregateTransactionReadiness — pressure signals', () => {
  it('injury pressure: high at >=3 injured/questionable starters, moderate at >=1', () => {
    const high = aggregateTransactionReadiness({ players: [p('QB', 'Out'), p('RB', 'Out'), p('WR', 'Questionable'), ...BENCH(4)], currentWeek: 5, rosterConfig: cfg() }, FIXED)!
    expect(high.injuryPressure).toBe('high')
    const moderate = aggregateTransactionReadiness({ players: [p('QB', 'Questionable'), p('RB'), ...BENCH(4)], currentWeek: 5, rosterConfig: cfg() }, FIXED)!
    expect(moderate.injuryPressure).toBe('moderate')
  })

  it('bye pressure: counts only starters whose byeWeek === currentWeek', () => {
    const players = [p('QB', null, 5), p('RB', null, 5), p('WR', null, 5), p('TE', null, 9), ...BENCH(4)]
    expect(aggregateTransactionReadiness({ players, currentWeek: 5, rosterConfig: cfg() }, FIXED)!.byePressure).toBe('high')
    expect(aggregateTransactionReadiness({ players, currentWeek: 9, rosterConfig: cfg() }, FIXED)!.byePressure).toBe('moderate')
    expect(aggregateTransactionReadiness({ players, currentWeek: 1, rosterConfig: cfg() }, FIXED)!.byePressure).toBe('low')
  })

  it('bench flexibility: flexible (>=6 & low IR), limited (>=3), tight (<3)', () => {
    expect(aggregateTransactionReadiness({ players: [...STARTERS(), ...BENCH(6)], currentWeek: 5, rosterConfig: cfg() }, FIXED)!.benchFlexibility).toBe('flexible')
    expect(aggregateTransactionReadiness({ players: [...STARTERS(), ...BENCH(4)], currentWeek: 5, rosterConfig: cfg() }, FIXED)!.benchFlexibility).toBe('limited')
    expect(aggregateTransactionReadiness({ players: [...STARTERS(), ...BENCH(2)], currentWeek: 5, rosterConfig: cfg() }, FIXED)!.benchFlexibility).toBe('tight')
  })

  it('a big bench with too many IR players is NOT flexible (IR must be low)', () => {
    const t = aggregateTransactionReadiness({ players: [...STARTERS(), ...BENCH(6), p('IR'), p('IR')], currentWeek: 5, rosterConfig: cfg(20) }, FIXED)!
    expect(t.injuredReserveCount).toBe(2)
    expect(t.benchFlexibility).toBe('limited') // bench 6 but IR 2 > low → drops out of "flexible"
  })

  it('high roster pressure only when a high injury/bye signal meets a tight bench', () => {
    const high = aggregateTransactionReadiness({ players: [p('QB', 'Out'), p('RB', 'Out'), p('WR', 'Out'), p('TE'), ...BENCH(1)], currentWeek: 5, rosterConfig: cfg() }, FIXED)!
    expect(high.injuryPressure).toBe('high')
    expect(high.benchFlexibility).toBe('tight')
    expect(high.rosterPressure).toBe('high')
    // Same injuries but a deep bench → high signal is absorbed → moderate, not high.
    const absorbed = aggregateTransactionReadiness({ players: [p('QB', 'Out'), p('RB', 'Out'), p('WR', 'Out'), p('TE'), ...BENCH(6)], currentWeek: 5, rosterConfig: cfg(20) }, FIXED)!
    expect(absorbed.rosterPressure).toBe('moderate')
  })
})

describe('aggregateTransactionReadiness — counts & roster openings', () => {
  it('classifies bench / IR / taxi reserves and computes open slots', () => {
    const t = aggregateTransactionReadiness({ players: [...STARTERS(), ...BENCH(3), p('IR'), p('TAXI'), p('devy')], currentWeek: 5, rosterConfig: cfg(17) }, FIXED)!
    expect(t.benchCount).toBe(3)
    expect(t.injuredReserveCount).toBe(1)
    expect(t.reserveCount).toBe(6) // 3 bench + 1 IR + 1 taxi + 1 devy
    expect(t.rosterOpenings).toBe(2) // 17 max − 15 active
  })

  it('never returns negative openings when the roster is over the configured size', () => {
    const t = aggregateTransactionReadiness({ players: [...STARTERS(), ...BENCH(6)], currentWeek: 5, rosterConfig: cfg(10) }, FIXED)!
    expect(t.rosterOpenings).toBe(0)
  })
})

describe('aggregateTransactionReadiness — missing roster settings (honest caveats)', () => {
  it('adds a caveat when the roster size comes from the format default', () => {
    const t = aggregateTransactionReadiness({ players: [...STARTERS(), ...BENCH(3)], currentWeek: 5, rosterConfig: cfg(15, 'defaults') }, FIXED)!
    expect(t.caveats.some((c) => /format default roster size/i.test(c))).toBe(true)
  })
  it('adds a caveat and 0 openings when no roster config is available at all', () => {
    const t = aggregateTransactionReadiness({ players: [...STARTERS(), ...BENCH(3)], currentWeek: 5, rosterConfig: null }, FIXED)!
    expect(t.rosterOpenings).toBe(0)
    expect(t.caveats.some((c) => /slot limits aren't available/i.test(c))).toBe(true)
  })
})

describe('aggregateTransactionReadiness — contract, determinism, no advice', () => {
  it('emits the full V1 contract with provenance and an ISO derivedAt', () => {
    const t = aggregateTransactionReadiness({ players: [...STARTERS(), ...BENCH(4)], currentWeek: 5, rosterConfig: cfg() }, FIXED)!
    expect(t.version).toBe(MANAGER_TRANSACTION_READINESS_VERSION)
    expect(t.derivedAt).toBe(FIXED.toISOString())
    expect(Object.keys(t).sort()).toEqual(
      [
        'benchCount', 'benchFlexibility', 'byePressure', 'caveats', 'derivedAt', 'injuredReserveCount',
        'injuryPressure', 'reserveCount', 'rosterOpenings', 'rosterPressure', 'summary', 'version',
      ].sort(),
    )
  })
  it('is deterministic — identical input yields identical output', () => {
    const input = { players: [p('QB', 'Out'), p('RB', 'Questionable', 5), ...BENCH(2), p('IR')], currentWeek: 5, rosterConfig: cfg() }
    expect(aggregateTransactionReadiness(input, FIXED)).toEqual(aggregateTransactionReadiness(input, FIXED))
  })
  it('summary + caveats carry NO recommendation / advice language (all scenarios)', () => {
    const scenarios = [
      { players: [...STARTERS(), ...BENCH(6)], currentWeek: 5, rosterConfig: cfg() },
      { players: [p('QB', 'Out'), p('RB', 'Out'), p('WR', 'Out'), ...BENCH(1)], currentWeek: 5, rosterConfig: cfg(15, 'defaults') },
      { players: [p('QB', null, 5), p('RB', null, 5), p('WR', null, 5), ...BENCH(2)], currentWeek: 5, rosterConfig: null },
    ]
    for (const s of scenarios) {
      const t = aggregateTransactionReadiness(s, FIXED)!
      expect(BANNED.test(t.summary)).toBe(false)
      expect(BANNED.test(t.caveats.join(' '))).toBe(false)
    }
  })
})
