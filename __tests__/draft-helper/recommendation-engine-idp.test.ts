import { describe, expect, it } from 'vitest'
import { computeDraftPlayerRankings, type RecommendationInput, type RecommendationPlayer } from '@/lib/draft-helper/RecommendationEngine'

function basePlayer(overrides: Partial<RecommendationPlayer>): RecommendationPlayer {
  return { name: 'X', position: 'WR', team: 'AAA', adp: 50, ...overrides }
}

function baseInput(overrides: Partial<RecommendationInput>): RecommendationInput {
  return {
    available: [],
    teamRoster: [],
    rosterSlots: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX'],
    round: 5,
    pick: 5,
    totalTeams: 12,
    sport: 'NFL',
    mode: 'needs',
    ...overrides,
  }
}

// Phase 32: real finding -- RecommendationEngine.ts's FOOTBALL_POSITION_TARGETS and
// FLEX_SLOT_NAMES had no IDP awareness at all (no DE/DT/LB/CB entries, no DL/DB/IDP_FLEX
// flex recognition), even though the underlying player pool (SportsPlayer: 6,712 real NFL
// rows across DE/DT/LB/CB/DB/DL) and roster-template infrastructure
// (lib/multi-sport/RosterTemplateService.ts's NFL_IDP_EXTRA_SLOTS/NFL_IDP_FLEX_SLOTS)
// already exist. These tests verify the engine now recognizes real IDP roster slots using
// the exact same eligibility mapping RosterTemplateService.ts already defines.
describe('RecommendationEngine — IDP position targets and flex slots (Phase 32, needs mode)', () => {
  it('a DE gets a real, non-fallback need score when the roster has dedicated DE slots', () => {
    const de = basePlayer({ name: 'Elite DE', position: 'DE', adp: 40 })
    const input = baseInput({
      available: [de],
      rosterSlots: ['QB', 'RB', 'WR', 'TE', 'DE', 'DE'],
    })
    const result = computeDraftPlayerRankings(input)!
    // Real target: starter=2 (2 DE slots), 0 currently rostered -> high need (88+).
    expect(result.needs.DE).toBeGreaterThanOrEqual(88)
  })

  it('an IDP_FLEX slot boosts DE/DT/LB/CB need scores', () => {
    const withoutFlex = computeDraftPlayerRankings(
      baseInput({ available: [basePlayer({ name: 'DE1', position: 'DE' })], rosterSlots: ['QB', 'DE'] })
    )!.needs.DE
    const withFlex = computeDraftPlayerRankings(
      baseInput({ available: [basePlayer({ name: 'DE1', position: 'DE' })], rosterSlots: ['QB', 'DE', 'IDP_FLEX'] })
    )!.needs.DE

    expect(withFlex).toBeGreaterThan(withoutFlex)
  })

  it('a DL slot boosts DE/DT needs but not LB/CB', () => {
    const rosterSlots = ['QB', 'DE', 'DT', 'LB', 'CB', 'DL']
    const result = computeDraftPlayerRankings(
      baseInput({
        available: [basePlayer({ name: 'X', position: 'WR' })],
        rosterSlots,
      })
    )!
    const withoutDl = computeDraftPlayerRankings(
      baseInput({ available: [basePlayer({ name: 'X', position: 'WR' })], rosterSlots: ['QB', 'DE', 'DT', 'LB', 'CB'] })
    )!

    expect(result.needs.DE).toBeGreaterThan(withoutDl.needs.DE)
    expect(result.needs.DT).toBeGreaterThan(withoutDl.needs.DT)
    expect(result.needs.LB).toBe(withoutDl.needs.LB)
    expect(result.needs.CB).toBe(withoutDl.needs.CB)
  })

  it('a DB slot boosts CB needs but not DE/DT/LB', () => {
    const withDb = computeDraftPlayerRankings(
      baseInput({ available: [basePlayer({ name: 'X', position: 'WR' })], rosterSlots: ['QB', 'DE', 'DT', 'LB', 'CB', 'DB'] })
    )!
    const withoutDb = computeDraftPlayerRankings(
      baseInput({ available: [basePlayer({ name: 'X', position: 'WR' })], rosterSlots: ['QB', 'DE', 'DT', 'LB', 'CB'] })
    )!

    expect(withDb.needs.CB).toBeGreaterThan(withoutDb.needs.CB)
    expect(withDb.needs.DE).toBe(withoutDb.needs.DE)
    expect(withDb.needs.LB).toBe(withoutDb.needs.LB)
  })

  it('a non-IDP league (no defensive slots in rosterSlots) leaves a DE player at the generic fallback need score, unaffected', () => {
    const de = basePlayer({ name: 'Random DE', position: 'DE', adp: 200 })
    const input = baseInput({ available: [de], rosterSlots: ['QB', 'RB', 'WR', 'TE', 'FLEX'] })
    const result = computeDraftPlayerRankings(input)!
    expect(result.scored[0].needScore).toBe(20)
  })

  it('is deterministic: identical IDP rosterSlots always produce identical needs', () => {
    const input = baseInput({
      available: [basePlayer({ name: 'DE1', position: 'DE' })],
      rosterSlots: ['QB', 'DE', 'DT', 'LB', 'CB', 'IDP_FLEX'],
    })
    const run1 = computeDraftPlayerRankings(input)!.needs
    const run2 = computeDraftPlayerRankings(input)!.needs
    expect(run1).toEqual(run2)
  })
})
