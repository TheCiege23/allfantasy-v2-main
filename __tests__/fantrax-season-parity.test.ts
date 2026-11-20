import { describe, expect, it, vi } from 'vitest'
import { FantraxLeagueMapper } from '@/lib/league-import/adapters/fantrax/FantraxLeagueMapper'
import type { FantraxImportPayload } from '@/lib/league-import/adapters/fantrax/types'
import { fantraxScoringRules } from '@/lib/league-import/fantrax/fantraxScoring'
import type { FantraxLeagueInfo } from '@/lib/league-import/fantrax/fantraxApi'
import { scoredFantraxMatchups, resolveFantraxChampionTeamId } from '@/lib/league-import/fantrax/FantraxHistoricalBackfillService'

vi.mock('@/lib/prisma', () => ({ prisma: {} }))
function source(sport: string, teams: number, start: number, last: number): FantraxImportPayload {
  return {
    league: { sport, currentWeek: 2, isFinished: false },
    settings: { raw: { seasonState: 'in_progress', lastPeriod: last,
      playoffs: { used: true, firstPlayoffPeriod: start, lastRegularSeasonPeriod: start - 1, numPlayoffTeams: teams } }, rosterPositions: [] },
    teams: [{ rank: 1, teamId: 'a', rosterPlayerIds: ['p'] }], draftPicks: [],
    schedule: [{ week: 1, matchups: [{ teamId1: 'a', teamId2: 'b', points1: 4, points2: 3 }] }],
  } as unknown as FantraxImportPayload
}
describe('published Fantrax first-season calendars', () => {
  it.each([['NBA',16,22,25],['MLB',12,23,26],['NFL',14,14,17],['NCAAB',32,14,18],['NBA',8,20,22],['NHL',6,25,27]] as const)(
    'keeps the %s field of %i with its actual starting period', (sport, teams, start, last) => {
      expect(FantraxLeagueMapper.map(source(sport,teams,start,last))).toMatchObject({
        playoff_team_count: teams, playoff_teams: teams, playoff_start_week: start, regular_season_length: start-1, current_week: 2,
      })
    })
  it('preserves an explicit no-playoffs league', () => {
    const input = source('MLB',12,23,26)
    input.settings!.raw.playoffs = { used: false, numPlayoffTeams: 12, firstPlayoffPeriod: 23 }
    expect(FantraxLeagueMapper.map(input)).toMatchObject({ playoff_teams: 0, playoff_start_week: undefined })
  })
  it('leaves the current score on the schedule and out of finalized matchup facts', () => {
    const input = source('NBA',16,22,25)
    input.settings!.raw.scoringPeriods = [{ number: 1, endDate: '2100-01-01T00:00:00Z' }]
    expect(scoredFantraxMatchups(input)).toEqual([])
    expect(input.schedule[0].matchups[0].points1).toBe(4)
  })
  it('does not award the title on a missing final', () => {
    const input = source('NFL',14,14,17)
    input.league.isFinished = true
    input.schedule[0].week=16
    input.schedule[0].matchups[0].isPlayoff=true
    expect(resolveFantraxChampionTeamId(input)).toBeNull()
  })
  it('keeps player return yards distinct from team defense', () => {
    const config=(group:string,code:string,points:number) => ({group:{code:group},configs:[{scoringCategory:{code},points}]})
    const rules=fantraxScoringRules({scoringSystem:{type:'HEAD_TO_HEAD_POINTS_BASED',scoringCategorySettings:[
      config('FOOTBALL_OFFENSE','INDIVIDUAL_KICKOFF_RETURN_YARDS',0.05),config('FOOTBALL_DEFENSE','INDIVIDUAL_PUNT_RETURN_YARDS',0.1),
    ]}} as FantraxLeagueInfo)
    expect(rules).toEqual({ rules: [{stat_key:'kr_yd',points_value:0.05},{stat_key:'pr_yd',points_value:0.1}],gaps:[] })
  })
})

