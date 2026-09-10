import type { TeamWindowFacts } from '@/lib/decision-os/value-v2/window'
import { describe, expect, it } from 'vitest'
import {
  assembleWindowFacts,
  MAX_FORECAST_WEEK_LAG,
  type WindowFactsPort,
  type WindowFactsScope,
} from '@/lib/decision-os/value-v2/windowFacts'
import { resolveCompetitiveWindow } from '@/lib/decision-os/value-v2/window'

/**
 * ⚠ NARROWED, NOT CAST BLIND. `TeamWindowFacts` is a discriminated union now, so reading a
 * dynasty-only field means proving the arm first — which is also an assertion worth having: if
 * an assembly silently produced redraft facts here, this throws instead of reading `undefined`.
 */
function asDynasty(facts: TeamWindowFacts | null | undefined) {
  if (!facts || facts.format !== 'dynasty') throw new Error(`expected dynasty facts, got ${facts?.format ?? 'none'}`)
  return facts
}


const scope: WindowFactsScope = { leagueId: 'l1', teamId: 't1', season: 2026, week: 11 }

const port = (over: Partial<WindowFactsPort> = {}): WindowFactsPort => ({
  identity: async () => ({ teamId: 't1', teamName: 'Anvil Chorus', managerName: 'Rae', rosterSize: 4 }),
  allPlay: async () => ({ wins: 7, losses: 4, ties: 0, luckWins: 1.5, weeksCounted: 11, pointsFor: 1200 }),
  forecast: async () => ({ season: 2026, week: 11, playoffProbabilityPct: 82.5, generatedAt: '2026-10-06T12:00:00.000Z' }),
  dynasty: async () => ({ season: 2026, projectedStrength3YearsPct: 71, projectedStrengthNextYearPct: 68, windowStartYear: 2026, windowEndYear: 2029, confidencePct: 74, generatedAt: '2026-10-06T12:00:00.000Z' }),
  /*
   * These fixtures are DYNASTY, so this is never consulted. It is present because the port
   * contract requires it, and null is the honest answer for an assembly that never calls it.
   */
  restOfSeason: async () => null,
  injuries: async () => ({ unavailableShare: 0.1, basis: 'test-basis', coverage: 1, treatment: 'excluded' }),
  ...over,
})

describe('assembleWindowFacts converts stored units without inventing them', () => {
  it('turns the stored percentages into unit values', async () => {
    const { facts, gaps } = await assembleWindowFacts(scope, port())
    expect(gaps).toEqual([])
    expect(facts!.playoffProbability).toBeCloseTo(0.825, 10)
    expect(asDynasty(facts).rosterStrength3Year).toBeCloseTo(0.71, 10)
  })

  it('carries the all-play record through unchanged, luck included', async () => {
    const { facts } = await assembleWindowFacts(scope, port())
    expect(facts).toMatchObject({ wins: 7, losses: 4, ties: 0, luckWins: 1.5 })
  })

  it('declares picks already inside the stored dynasty strength', async () => {
    const { facts } = await assembleWindowFacts(scope, port())
    expect(asDynasty(facts).pickTreatment).toBe('included-in-roster-strength')
    expect(asDynasty(facts).futurePickCapital).toBeNull()
  })

  it('produces facts the resolver accepts end to end', async () => {
    const { facts } = await assembleWindowFacts(scope, port())
    const resolved = resolveCompetitiveWindow(facts!)
    expect(resolved.gaps).toEqual([])
    expect(resolved.status).not.toBeNull()
  })
})

describe('assembleWindowFacts refuses rather than filling gaps', () => {
  it('names each missing producer', async () => {
    const { facts, gaps } = await assembleWindowFacts(scope, port({
      identity: async () => null, allPlay: async () => null, forecast: async () => null,
      dynasty: async () => null, injuries: async () => null,
    }))
    expect(facts).toBeNull()
    expect(gaps).toEqual(expect.arrayContaining([
      'team_identity_missing', 'all_play_record_missing', 'season_forecast_missing',
      'dynasty_projection_missing', 'injury_load_missing',
    ]))
  })

  it('refuses when the resolved identity is a different team', async () => {
    const { facts, gaps } = await assembleWindowFacts(scope, port({
      identity: async () => ({ teamId: 'someone-else', teamName: null, managerName: null, rosterSize: 4 }),
    }))
    expect(facts).toBeNull()
    expect(gaps).toContain('team_identity_mismatch')
  })

  it('refuses a record accumulated over no scored week', async () => {
    const { facts, gaps } = await assembleWindowFacts(scope, port({
      allPlay: async () => ({ wins: 0, losses: 0, ties: 0, luckWins: 0, weeksCounted: 0, pointsFor: 0 }),
    }))
    expect(facts).toBeNull()
    expect(gaps).toContain('all_play_no_scored_weeks')
  })

  it('refuses an injury share measured over too little of the roster', async () => {
    const { facts, gaps } = await assembleWindowFacts(scope, port({
      injuries: async () => ({ unavailableShare: 0.5, basis: 'test-basis', coverage: 0.2, treatment: 'excluded' }),
    }))
    expect(facts).toBeNull()
    expect(gaps).toContain('injury_coverage_below_floor')
  })

  it('surfaces the injury basis rather than leaving it to be assumed', async () => {
    const { evidence } = await assembleWindowFacts(scope, port())
    expect(evidence.injuries!.basis).toBe('test-basis')
  })

  it('never assumes a team is healthy when no injury load exists', async () => {
    const { facts, gaps } = await assembleWindowFacts(scope, port({ injuries: async () => null }))
    expect(facts).toBeNull()
    expect(gaps).toContain('injury_load_missing')
  })

  it('refuses a forecast from a previous season', async () => {
    const { gaps } = await assembleWindowFacts(scope, port({
      forecast: async () => ({ season: 2025, week: 11, playoffProbabilityPct: 82.5, generatedAt: null }),
    }))
    expect(gaps).toContain('season_forecast_wrong_season')
  })

  it('refuses a dynasty projection from a previous season', async () => {
    const { gaps } = await assembleWindowFacts(scope, port({
      dynasty: async () => ({ season: 2025, projectedStrength3YearsPct: 71, projectedStrengthNextYearPct: null, windowStartYear: null, windowEndYear: null, confidencePct: null, generatedAt: null }),
    }))
    expect(gaps).toContain('dynasty_projection_wrong_season')
  })

  it('refuses a stale forecast rather than reading it as current', async () => {
    const stale = await assembleWindowFacts(scope, port({
      forecast: async () => ({ season: 2026, week: 11 - MAX_FORECAST_WEEK_LAG - 1, playoffProbabilityPct: 82.5, generatedAt: null }),
    }))
    expect(stale.gaps).toContain('season_forecast_stale')
    const fresh = await assembleWindowFacts(scope, port({
      forecast: async () => ({ season: 2026, week: 11 - MAX_FORECAST_WEEK_LAG, playoffProbabilityPct: 82.5, generatedAt: null }),
    }))
    expect(fresh.gaps).toEqual([])
  })

  it('refuses a forecast from a week that has not happened', async () => {
    const { gaps } = await assembleWindowFacts(scope, port({
      forecast: async () => ({ season: 2026, week: 12, playoffProbabilityPct: 82.5, generatedAt: null }),
    }))
    expect(gaps).toContain('season_forecast_stale')
  })

  it('refuses an out-of-range stored percentage instead of clamping it', async () => {
    const high = await assembleWindowFacts(scope, port({
      forecast: async () => ({ season: 2026, week: 11, playoffProbabilityPct: 140, generatedAt: null }),
    }))
    expect(high.facts).toBeNull()
    expect(high.gaps).toContain('season_forecast_probability_out_of_range')

    const negative = await assembleWindowFacts(scope, port({
      dynasty: async () => ({ season: 2026, projectedStrength3YearsPct: -3, projectedStrengthNextYearPct: null, windowStartYear: null, windowEndYear: null, confidencePct: null, generatedAt: null }),
    }))
    expect(negative.facts).toBeNull()
    expect(negative.gaps).toContain('dynasty_projection_strength_out_of_range')
  })

  it('rejects an invalid scope before reading anything', async () => {
    let touched = false
    const spy = port({ allPlay: async () => { touched = true; return null } })
    const { facts, gaps } = await assembleWindowFacts({ ...scope, week: 0 }, spy)
    expect(facts).toBeNull()
    expect(gaps).toEqual(['window_scope_invalid'])
    expect(touched).toBe(false)
  })
})
