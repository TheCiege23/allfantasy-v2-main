import { describe, expect, it } from 'vitest'
import { buildLeagueShape } from '@/lib/trade-value/leagueShape'
import { formatModelFor, formatModelForLeague } from '@/lib/trade-value/formats/registry'

const shape = buildLeagueShape({ teams: 12, starterSlots: ['QB', 'RB', 'WR', 'FLEX'], rosterSize: 16, deadlineWeek: 12 })!

describe('specialty trade value models', () => {
  it('uses the receiving team cap ledger and the actual contract', () => {
    const model = formatModelFor('salary_cap')!
    const input = {
      base: 5000, position: 'WR', shape,
      acquiringTeamState: { capSpace: 1_000, salaryOut: 0 },
      assetState: { salary: 4_000, yearsRemaining: 3, playerValueInCapUnits: 10_000 },
    }
    expect(model.canTrade!(input).ok).toBe(false)
    expect(model.adjust(input)!.reason).toMatch(/actual salary/i)
  })

  it('grades Survivor by this roster’s before/after survival probability', () => {
    const model = formatModelFor('survivor')!
    const fit = model.adjust({ base: 5000, position: 'RB', shape, acquiringTeamState: {
      survivalProbabilityBefore: 0.4, survivalProbabilityAfter: 0.5,
    } })!
    expect(fit.multiplier).toBe(1.25)
    expect(fit.reason).toContain('40.0% before')
  })

  it('supports Survivor Guillotine as its own combined rules contract', () => {
    expect(formatModelFor('survivor_guillotine')?.label).toBe('Survivor Guillotine')
  })

  it('prices King exposure from the roster and player’s modeled weekly risk', () => {
    const model = formatModelForLeague({ leagueType: 'redraft', aliasTags: ['king_of_the_hill'] })!
    const fit = model.adjust({ base: 5000, position: 'WR', shape, teamState: { viewerIsKing: true, weeklyLossProbability: 0.4 }, assetState: { topThreeScorerProbability: 0.5 } })!
    expect(fit.multiplier).toBeCloseTo(0.8)
  })

  it('uses the receiver’s three protected players in Pirate', () => {
    const model = formatModelForLeague({ leagueType: 'dynasty', aliasTags: ['pirate_vampire'] })!
    const fit = model.adjust({ base: 7000, position: 'WR', shape, acquiringTeamState: { protectedValues: [9000, 8000, 6000] } })!
    expect(fit.multiplier).toBeCloseTo(1 - 6000 / 7000)
    expect(model.canTrade!({ base: 7000, position: 'WR', shape, teamState: { inLockWindow: true } }).ok).toBe(false)
  })
})
