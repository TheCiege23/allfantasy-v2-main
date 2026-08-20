import { describe, expect, it } from 'vitest'
import { getLeagueDefaults } from '@/lib/league-defaults/getLeagueDefaults'

/**
 * Waiver, playoff and schedule defaults for a newly created league.
 *
 * This replaces three e2e specs — league-creation-{waiver,playoff,schedule}-settings
 * — that drove a detailed advanced-settings form inside the create wizard. The G30
 * simplified flow removed that form (its `league-creation-advanced-*` testids exist
 * nowhere in the app any more) and moved rule configuration to the post-creation
 * settings panels, so those specs could only ever fail.
 *
 * What they were really protecting is still worth protecting: that a league created
 * through the wizard starts with coherent rules rather than whatever survived the
 * merge of preset, sport profile and canonical snapshot. That property now lives in
 * getLeagueDefaults, so it is asserted here — at the layer that actually decides it,
 * across the sport/format matrix rather than for one NFL redraft league.
 *
 * Deliberately asserted on the snake_case shape. getLeagueDefaults emits a camelCase
 * mirror too, and the two DISAGREE for several configurations (auction leagues get
 * playoff_team_count 6 alongside playoffTeams 4; devy gets playoff_start_week 13
 * alongside playoffStartWeek 15). That drift is a real bug and is tracked separately
 * — pinning the mirror here would either encode the wrong values or make this file
 * red for a defect it is not about.
 */

const CONFIGS = [
  { label: 'NFL redraft snake', sport: 'NFL', format: 'redraft', draftType: 'snake', scoringPreset: 'fb_half_ppr', managerCount: 12 },
  { label: 'NFL dynasty snake', sport: 'NFL', format: 'dynasty', draftType: 'snake', scoringPreset: 'fb_dynasty_ppr', managerCount: 10 },
  { label: 'NFL redraft auction', sport: 'NFL', format: 'redraft', draftType: 'auction', scoringPreset: 'fb_half_ppr', managerCount: 8 },
  { label: 'NCAAF devy snake', sport: 'NCAAF', format: 'devy', draftType: 'snake', scoringPreset: 'ncaaf_devy_ppr', managerCount: 12 },
  { label: 'NCAAF C2C snake', sport: 'NCAAF', format: 'c2c', draftType: 'snake', scoringPreset: 'ncaaf_c2c_ppr', managerCount: 14 },
] as const

function defaultsFor(config: (typeof CONFIGS)[number]) {
  const { label: _label, ...input } = config
  const d = getLeagueDefaults(input as never)
  return {
    waiver: d.waiverSettings as Record<string, unknown>,
    playoff: d.playoffSettings as Record<string, unknown>,
    schedule: d.scheduleSettings as Record<string, unknown>,
  }
}

describe.each(CONFIGS)('$label — league starts with usable rules', (config) => {
  it('has a waiver system that can actually process a claim', () => {
    const { waiver } = defaultsFor(config)

    expect(waiver.waiver_type).toBeTruthy()
    expect(['faab', 'rolling', 'reverse_standings']).toContain(waiver.waiver_type)

    // A processing day with no time (or the reverse) leaves the scheduler unable to
    // pick a moment to run, which surfaces as waivers that silently never process.
    expect(Array.isArray(waiver.processing_days)).toBe(true)
    expect((waiver.processing_days as unknown[]).length).toBeGreaterThan(0)
    expect(waiver.processing_time_utc).toMatch(/^\d{2}:\d{2}$/)

    expect(Number(waiver.max_claims_per_period)).toBeGreaterThan(0)
  })

  it('does not enable FAAB without a budget to bid from', () => {
    const { waiver } = defaultsFor(config)
    if (waiver.faab_enabled === true) {
      expect(Number(waiver.FAAB_budget_default)).toBeGreaterThan(0)
    }
  })

  it('has a playoff bracket that fits the league', () => {
    const { playoff } = defaultsFor(config)
    const teams = Number(playoff.playoff_team_count)

    expect(teams).toBeGreaterThanOrEqual(2)
    // More playoff berths than managers would seed empty slots.
    expect(teams).toBeLessThanOrEqual(config.managerCount)
    expect(Number(playoff.playoff_weeks)).toBeGreaterThanOrEqual(1)

    // Byes are taken out of the bracket, so giving one to every team leaves nobody
    // to play the first round.
    expect(Number(playoff.first_round_byes)).toBeLessThan(teams)

    expect(Array.isArray(playoff.tiebreaker_rules)).toBe(true)
    expect((playoff.tiebreaker_rules as unknown[]).length).toBeGreaterThan(0)
  })

  it('starts the playoffs inside the season it schedules', () => {
    const { playoff, schedule } = defaultsFor(config)
    const start = Number(playoff.playoff_start_week)
    const regularSeasonLength = Number(schedule.regular_season_length)

    expect(start).toBeGreaterThan(0)
    expect(start).toBeLessThanOrEqual(regularSeasonLength)
  })

  it('agrees with the schedule about when the playoffs begin', () => {
    // playoffSettings and scheduleSettings are built from different inputs, so this
    // is the seam where a sport profile change quietly desynchronises them — the
    // bracket opens one week and the schedule hands over another.
    const { playoff, schedule } = defaultsFor(config)
    expect(Number(schedule.playoff_transition_point)).toBe(Number(playoff.playoff_start_week))
  })
})
