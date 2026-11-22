import { describe, expect, it } from 'vitest'
import { leagueSupportsTaxiDevy } from '@/lib/league-creation/prospectStashPolicy'
import { getWaiverDefaults } from '@/lib/sport-defaults/SportDefaultsRegistry'
import { resolveWaiverPhasePolicy } from '@/lib/waiver-wire/season-phase-policy'

describe('league setup policies', () => {
  it('limits taxi and devy slots to the requested league formats', () => {
    for (const leagueType of ['dynasty', 'devy', 'salary_cap', 'c2c']) expect(leagueSupportsTaxiDevy({ leagueType })).toBe(true)
    for (const leagueType of ['zombie', 'redraft', 'keeper', 'guillotine', 'survivor', 'best_ball']) expect(leagueSupportsTaxiDevy({ leagueType })).toBe(false)
    expect(leagueSupportsTaxiDevy({ leagueType: 'zombie', isDynasty: true })).toBe(false)
  })
  it('defaults zombie leagues to free agency for all four sports', () => {
    for (const sport of ['NFL', 'NBA', 'NHL', 'MLB'] as const) {
      const waiver = getWaiverDefaults(sport, 'zombie')
      expect(waiver.waiver_type).toBe('fcfs')
      expect(waiver.processing_days).toBeNull()
      expect(waiver.faab_enabled).toBe(false)
    }
  })
  it('blocks both claims and immediate adds before the draft', () => {
    const result = resolveWaiverPhasePolicy({ phase: 'pre_draft', offseasonRule: 'fcfs', playoffRule: 'all_teams', dynastyFamily: true, eliminated: null })
    expect(result.claimsAllowed).toBe(false)
    expect(result.immediateAddsAllowed).toBe(false)
    expect(result.reason).toMatch(/draft is complete/)
  })
})
