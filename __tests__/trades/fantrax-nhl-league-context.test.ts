/** @vitest-environment node */
import { describe, expect, it, vi } from 'vitest'
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/league-access', () => ({ resolveLeagueMembership: vi.fn() }))
import { buildTradeLeagueContext } from '@/lib/trades/loadTradeLeagueContext'
import { bestHockeyLineupAssignment, hockeySlotEligible } from '@/lib/trades/hockeyLineupImpact'

const category = (code: string, points: number) => ({ points,
  position: { shortName: 'Default' }, scoringCategory: { code } })
function league(extra: unknown[] = []) {
  return { id: 'league', platformLeagueId: 'source', name: 'Hockey', platform: 'fantrax',
    sport: 'NHL', season: 2026, leagueType: null, isDynasty: false, leagueSize: 12,
    scoring: 'HEAD_TO_HEAD_POINTS_BASED', starters: ['D:3', 'F:5', 'G:2'],
    waiverBudget: null, taxiSlots: null, irSlots: null, settings: {
      scoringSettings: { rules: { pim: 0.2 }, rulesDetail: [{ statKey: 'pim', pointsValue: 0.2 }] },
      fantrax_settings: { scoringSystem: { scoringCategorySettings: [
        { group: { code: 'HOCKEY_SKATING' }, configs: [category('INDIVIDUAL_PENALTY_MINUTES', 0.2)] },
        { group: { code: 'HOCKEY_GOALIE' }, configs: [category('INDIVIDUAL_PENALTY_MINUTES', 0.5),
          category('INDIVIDUAL_ASSISTS', 3), ...extra] },
      ] } },
    } } as Parameters<typeof buildTradeLeagueContext>[0]
}

describe('legacy Fantrax NHL scoring context', () => {
  it('fills the imported forward flex slot with a forward', () => {
    expect(hockeySlotEligible('C', 'FLEX_CW')).toBe(true)
    expect(hockeySlotEligible('D', 'FLEX_CW')).toBe(false)
    expect(hockeySlotEligible('G', 'FLEX_CW')).toBe(false)
    expect(bestHockeyLineupAssignment([{ playerId: 'f', position: 'LW', pointsPerGame: 4 }],
      { FLEX_CW: 1 })).toEqual({ points: 4, filledSlots: 1, slotCount: 1 })
  })
  it('recognizes Fantrax points mode and restores distinct goalie and skater weights', () => {
    const context = buildTradeLeagueContext(league(), [], '')
    expect(context.scoringMode).toBe('points')
    expect(context.scoringRules).toEqual({ penalty_minutes: 0.2,
      goalie_penalty_minutes: 0.5, goalie_assists: 3 })
    expect(context.scoringRuleDetails).toEqual([])
  })
  it('blocks incomplete scoring when a weighted category cannot be mapped', () => {
    const context = buildTradeLeagueContext(league([category('UNSUPPORTED_BONUS', 4)]), [], '')
    expect(context.scoringRules).toEqual({})
    expect(context.missing).toContain('scoring_rules')
  })
})
