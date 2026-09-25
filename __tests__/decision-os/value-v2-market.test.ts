import { describe, expect, it } from 'vitest'
import { leagueFingerprint, marketCohortKey, type LeagueFingerprintInput, type MarketCohortV2 } from '@/lib/decision-os/value-v2/cohort'
import { marketSnapshot, type MarketObservationV2 } from '@/lib/decision-os/value-v2/market'
import { playerValueRowObservation } from '@/lib/decision-os/value-v2/marketAdapters'
import { buildConsoleValueV2Shadow } from '@/lib/decision-os/value-v2/consoleShadow'

const cohort: MarketCohortV2 = { sport: 'NFL', format: 'dynasty', numQbs: 2, numTeams: 12, ppr: 1 }
const observation: MarketObservationV2 = { assetId: 'p1', source: 'fixture', observedAt: '2026-09-09T10:00:00Z', timestampResolution: 'instant', cohort,
  value: 4000, liquidity: 0.002, trend30d: -150, standardDeviation: 200, sampleSize: null }
const capture = (o: MarketObservationV2 | null = observation) => marketSnapshot({ assetId: 'p1', kind: 'player', observation: o,
  policy: { now: '2026-09-09T12:00:00Z', maxAgeMs: 2 * 3600000, expectedCohort: cohort } })
const league: LeagueFingerprintInput = { sport: 'NFL', format: 'dynasty', teamCount: 12,
  scoring: [{ stat: 'rec', points: 1 }, { stat: 'rec', points: 0.75, positions: ['TE'] }],
  slots: [{ id: 'QB', count: 1, eligiblePositions: ['QB'] }, { id: 'SF', count: 1, eligiblePositions: ['QB', 'RB', 'WR', 'TE'] }],
  benchSlots: 12, reserveSlots: 2, taxiSlots: 3, formatRules: { keeper: { rounds: 3, count: 2 }, deadline: 12 } }

describe('versioned cohort and league identity', () => {
  it('canonicalizes sport casing and distinguishes every market axis', () => {
    expect(marketCohortKey(cohort)).toBe(marketCohortKey({ ...cohort, sport: ' nfl ' }))
    for (const change of [{ format: 'redraft' as const }, { numQbs: 1 as const }, { numTeams: 14 }, { ppr: 0.5 }, { numTeams: null }]) {
      expect(marketCohortKey({ ...cohort, ...change })).not.toBe(marketCohortKey(cohort))
    }
  })
  it('is stable across rule order, flex position order and slot labels', () => {
    expect(leagueFingerprint(league)).toBe(leagueFingerprint({ ...league, sport: 'nfl', scoring: [...league.scoring!].reverse(),
      slots: [...league.slots!].reverse().map(s => ({ ...s, id: `other-${s.id}`, eligiblePositions: [...s.eligiblePositions].reverse() })),
      formatRules: { deadline: 12, keeper: { count: 2, rounds: 3 } } }))
  })
  it('distinguishes exact TEP, bench depth, specialty rules and unknown settings', () => {
    for (const change of [{ scoring: [{ stat: 'rec', points: 0.5, positions: ['TE'] }] }, { benchSlots: 6 }, { slots: null }, { formatRules: { keeper: { cost: 7 } } }]) {
      expect(leagueFingerprint({ ...league, ...change })).not.toBe(leagueFingerprint(league))
    }
  })
  it('does not fingerprint user or league identity and rejects invalid settings', () => {
    expect(leagueFingerprint({ ...league, ...{ userId: 'other', leagueId: 'other' } })).toBe(leagueFingerprint(league))
    expect(() => leagueFingerprint({ ...league, benchSlots: -1 })).toThrow()
    expect(() => leagueFingerprint({ ...league, formatRules: { invalid: Infinity } })).toThrow()
  })
})

describe('market evidence gate', () => {
  it('preserves observation time, price, liquidity and dispersion without inventing an interval', () => {
    const snapshot = capture()
    expect(snapshot.capturedAt).toBe('2026-09-09T12:00:00Z')
    expect(snapshot.marketValue?.evidence.asOf).toBe(observation.observedAt)
    expect(snapshot.marketValue).toMatchObject({ value: 4000, low: null, high: null })
    expect(snapshot.standardDeviation).toBe(200)
    expect(snapshot.trend30d).toBe(-150)
    expect(snapshot.liquidity).toBe(0.002)
    expect(snapshot.gaps).toContain('market_uncertainty_not_calibrated')
  })
  it.each([
    [{ observedAt: null }, 'market_timestamp_missing'],
    [{ observedAt: 'bad-date' }, 'market_timestamp_missing'],
    [{ observedAt: '2026-09-09T09:59:59Z' }, 'market_stale'],
    [{ observedAt: '2026-09-09T12:00:01Z' }, 'market_timestamp_in_future'],
    [{ assetId: 'wrong-player' }, 'market_identity_mismatch'],
    [{ value: NaN }, 'market_value_invalid'],
    [{ value: -1 }, 'market_value_invalid'],
    [{ source: '' }, 'market_source_missing'],
    [{ cohort: { ...cohort, ppr: 0.5 } }, 'market_cohort_mismatch'],
    [{ cohort: { ...cohort, numTeams: null } }, 'market_cohort_incomplete'],
  ] as const)('refuses invalid evidence %s', (change, gap) => {
    const snapshot = capture({ ...observation, ...change })
    expect(snapshot.marketValue).toBeNull()
    expect(snapshot.gaps).toContain(gap)
  })
  it('retains genuine zero and refuses a different numeric quote', () => {
    expect(capture({ ...observation, value: 0 }).marketValue?.value).toBe(0)
    expect(marketSnapshot({ assetId: 'p1', kind: 'player', observation, expectedValue: 5000,
      policy: { now: '2026-09-09T12:00:00Z', maxAgeMs: 86400000 } }).gaps).toContain('market_value_observation_mismatch')
  })
  it('preserves the limits of legacy history instead of filling missing cohort settings', () => {
    const row = { sleeperId: 'p1', source: 'FANTASYCALC', format: 'DYNASTY', qbFormat: 'SUPERFLEX', value: 4000,
      capturedAt: new Date('2026-09-09T00:00:00Z'), overallRank: 10, positionRank: 3, tradeFrequency: 0.002, trend30d: -150, marketStdDev: 200 }
    const o = playerValueRowObservation(row)!
    expect(o.cohort).toMatchObject({ numTeams: null, ppr: null })
    expect(o.observedAt).toBe('2026-09-09T00:00:00.000Z')
    expect(o.timestampResolution).toBe('day')
    expect(playerValueRowObservation({ ...row, source: 'UNKNOWN' })).toBeNull()
  })
  it('refuses console prices without identity-linked observations', () => {
    const a = { name: 'Ambiguous name', type: 'player' as const, value: 4000, position: 'WR', source: 'fantasycalc' as const,
      assetValue: { marketValue: 4000, impactValue: 1000, vorpValue: 200, volatility: 0.2 } }
    const snapshot = buildConsoleValueV2Shadow({ give: [a], get: [a], sport: 'NFL', isDynasty: true, ppr: 1, numTeams: 12, isSuperFlex: true,
      capturedAt: '2026-09-09T12:00:00Z', observationsByPlayerId: new Map([['p1', observation]]) })
    expect(snapshot.marketComplete).toBe(false)
    expect(snapshot.assets.every(a => a.marketValue === null)).toBe(true)
  })
})
