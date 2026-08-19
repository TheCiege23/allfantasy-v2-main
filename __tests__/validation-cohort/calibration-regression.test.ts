/**
 * Fantasy OS Suite — Phase V7.3 (Part A): calibration regression guards.
 *
 * Phase V7.1's real smoke run found ZERO proven Decision OS defects — so there is no fix to lock in.
 * What it DID observe are two EXPECTED deterministic behaviors, encoded here as provider-neutral guards
 * so a future change can't silently turn them into over-firing or fabrication:
 *
 *   1. The trade-activity recommendation is EVIDENCE-DRIVEN, not generic: a low-trade league receives a
 *      trade-stimulation recommendation; a high-trade league does not. (This is what makes the "same rec
 *      across 8/10 leagues" observation expected — those leagues genuinely shared a low-trade state — and
 *      guards against the recommendation over-firing on active leagues.)
 *   2. The DB-less reachability boundary holds: manager/trade/waiver remain db-backed-only, never
 *      fabricated as available.
 *
 * No provider usernames or raw provider IDs appear in these fixtures.
 */
import { describe, expect, it } from 'vitest'
import { probeLeague } from '@/lib/validation-cohort/decisionOsProbe'
import type { NormalizedLeagueFacts } from '@/lib/validation-cohort/types'

function neutralFacts(over: Partial<NormalizedLeagueFacts> = {}): NormalizedLeagueFacts {
  return {
    leagueReference: 'lg_fixture01',
    season: '2024',
    sport: 'NFL',
    formatType: 'redraft',
    numTeams: 12,
    hasSuperflex: false,
    hasIdp: false,
    tightEndPremium: false,
    playoffTeams: 6,
    waiverType: 'FAAB',
    totalTrades: 0,
    totalWaiverClaims: 20,
    totalTransactions: 40,
    draftState: 'complete',
    sourceIsCommissioner: true,
    activeManagers: 12,
    inactiveManagers: 0,
    ...over,
  }
}

const TRADE_STIMULATION = /trade (activity|deadline|deals|brokering)|stimulate trade/i

describe('calibration guard — trade-activity recommendation is evidence-driven, not generic', () => {
  it('a LOW-trade league receives a trade-stimulation recommendation', () => {
    const { health } = probeLeague(neutralFacts({ totalTrades: 0 }))
    const recs = health!.interventionRecommendations.join(' | ')
    expect(recs).toMatch(TRADE_STIMULATION)
  })

  it('a HIGH-trade league does NOT receive the trade-stimulation recommendation (no over-firing)', () => {
    const { health } = probeLeague(neutralFacts({ totalTrades: 40 }))
    const recs = health!.interventionRecommendations.join(' | ')
    expect(recs).not.toMatch(TRADE_STIMULATION)
  })

  it('outputs differ where evidence differs (low vs high trade leagues are not identical)', () => {
    const low = probeLeague(neutralFacts({ totalTrades: 0 })).health!
    const high = probeLeague(neutralFacts({ totalTrades: 40 })).health!
    expect(low.interventionRecommendations).not.toEqual(high.interventionRecommendations)
  })
})

describe('calibration guard — DB-less reachability boundary is intact (no fabrication)', () => {
  it('manager/trade/waiver/platform stay db-backed-only; commissioner/league health stay available', () => {
    const { probes } = probeLeague(neutralFacts())
    const reach = Object.fromEntries(probes.map((p) => [p.os + ':' + p.output, p.reachability]))
    expect(reach['commissioner:league-health']).toBe('available')
    expect(probes.filter((p) => p.os === 'manager').every((p) => p.reachability === 'db-backed-only')).toBe(true)
    expect(probes.filter((p) => p.os === 'waiver').every((p) => p.reachability === 'db-backed-only')).toBe(true)
    expect(probes.filter((p) => p.os === 'trade').every((p) => p.reachability === 'db-backed-only')).toBe(true)
    expect(probes.filter((p) => p.os === 'platform').every((p) => p.reachability === 'db-backed-only')).toBe(true)
  })
})
