import { describe, expect, it } from 'vitest'
import { buildTradeLeagueContext } from '@/lib/trades/loadTradeLeagueContext'

type Row = Parameters<typeof buildTradeLeagueContext>[0]
type Team = Parameters<typeof buildTradeLeagueContext>[1][number]

const league = (patch: Partial<Row> = {}): Row => ({
  id: 'league-1', platformLeagueId: 'source-1', name: 'Test league', platform: 'fantrax',
  sport: 'NCAAF', season: 2026, leagueType: 'dynasty', isDynasty: true,
  leagueSize: null, scoring: null, settings: null, starters: null,
  waiverBudget: null, taxiSlots: null, irSlots: null,
  ...patch,
})

const team = (n: number, owner: string | null = null): Team => ({
  id: `team-${n}`, externalId: `source-team-${n}`, teamName: 'Same Name',
  claimedByUserId: owner, wins: n % 8, losses: 8 - n % 8, ties: 0,
  currentRank: n + 1,
})

describe('provider-neutral trade league context', () => {
  it('keeps all 128 Fantrax teams and every team owned by one account', () => {
    const teams = Array.from({ length: 128 }, (_, n) => team(n, n === 2 || n === 87 ? 'viewer' : null))
    const context = buildTradeLeagueContext(league({
      starters: ['QB', 'RB:2', 'WR:3', 'DL', 'BN:8', 'TAXI:4'],
      settings: { scoring_settings: { pass_yd: 0.04, rec: 0.5 } },
    }), teams, 'viewer')

    expect(context.teamCount).toBe(128)
    expect(context.teams).toHaveLength(128)
    expect(context.viewerTeamIds).toEqual(['team-2', 'team-87'])
    expect(context.starterSlots).toEqual({ QB: 1, RB: 2, WR: 3, DL: 1 })
    expect(context.benchSlots).toBe(8)
    expect(context.taxiSlots).toBe(4)
    expect(context.scoringRules).toEqual({ pass_yd: 0.04, rec: 0.5 })
    expect(context.missing).toEqual([])
  })

  it('uses stored NBA category rules and roster slots without a points or NFL default', () => {
    const context = buildTradeLeagueContext(league({
      platform: 'native', sport: 'NBA', leagueType: 'redraft', isDynasty: false,
      leagueSize: 12, scoring: 'h2h categories',
      settings: {
        scoringSettings: { scoringMode: 'h2h_category', categoryPresetId: 'nba_9cat' },
        rosterSettings: { starterSlots: { PG: 1, SG: 1, G: 1, UTIL: 2 }, benchSlots: 3 },
      },
    }), Array.from({ length: 12 }, (_, n) => team(n)), 'viewer')

    expect(context.sport).toBe('NBA')
    expect(context.scoringMode).toBe('h2h_category')
    expect(context.categoryPresetId).toBe('nba_9cat')
    expect(context.starterSlots.UTIL).toBe(2)
    expect(context.missing).toEqual([])
  })

  it('reads ESPN aggregate slots and keeps baseball disabled list out of starters', () => {
    const context = buildTradeLeagueContext(league({
      platform: 'espn', sport: 'MLB', leagueSize: 16, isDynasty: false,
      starters: ['C:1', 'OF:5', 'UTIL:2', 'BE:6', 'DL:3'],
      settings: { scoring_settings: { HR: 4 } },
    }), Array.from({ length: 16 }, (_, n) => team(n)), 'viewer')

    expect(context.starterSlots).toEqual({ C: 1, OF: 5, UTIL: 2 })
    expect(context.benchSlots).toBe(6)
    expect(context.irSlots).toBe(3)
    expect(context.teamCount).toBe(16)
  })

  it('retains position-qualified scoring rules from canonical imported settings', () => {
    const context = buildTradeLeagueContext(league({
      platform: 'fantrax', sport: 'NCAAF', leagueSize: 32,
      settings: {
        scoringSettings: {
          scoringMode: 'points',
          rules: { 'rec@RB': 0.5, 'rec@WR': 1, 'rec@TE': 1.5 },
          rulesDetail: [
            { statKey: 'rec', pointsValue: 0.5, positions: ['RB'] },
            { statKey: 'rec', pointsValue: 1.5, positions: ['TE'] },
          ],
        },
        rosterSettings: { starterSlots: { QB: 1 } },
      },
    }), [team(0)], 'viewer')

    expect(context.scoringRules['rec@RB']).toBe(0.5)
    expect(context.scoringRules['rec@TE']).toBe(1.5)
    expect(context.scoringRuleDetails).toHaveLength(2)
    expect(context.scoringRuleDetails[1]).toMatchObject({ positions: ['TE'], pointsValue: 1.5 })
  })

  it('reports absent scoring, slots, and team data rather than inventing defaults', () => {
    const context = buildTradeLeagueContext(league(), [], 'viewer')
    expect(context.teamCount).toBeNull()
    expect(context.scoringMode).toBe('unknown')
    expect(context.starterSlots).toEqual({})
    expect(context.benchSlots).toBeNull()
    expect(context.missing).toEqual(['team_count', 'scoring_rules', 'roster_slots', 'teams'])
  })
})
