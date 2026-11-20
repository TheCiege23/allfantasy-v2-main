import { describe, expect, it, vi } from 'vitest'
import { FantraxLeagueMapper } from '@/lib/league-import/adapters/fantrax/FantraxLeagueMapper'
import type { FantraxImportPayload } from '@/lib/league-import/adapters/fantrax/types'
import { fantraxScoringRules } from '@/lib/league-import/fantrax/fantraxScoring'

import { createStateFromImportedLeague } from '@/lib/create-league-v2/import-template'
import { matchSharedFantraxPlayers } from '@/lib/player-identity/fantraxSharedPlayerIds'
import type { SleeperPlayer } from '@/lib/sleeper-client'
import { getEffectiveLeagueType } from '@/lib/create-league-v2/state'
import { normalizeConceptToFormat } from '@/lib/league-creation/canonical/normalizeConcept'
import { submitCreateLeagueV2 } from '@/lib/create-league-v2/submit'
import { fantraxStarterSlot } from '@/lib/league-import/fantrax/fantraxProSports'
import { projectFantraxStandings } from '@/lib/redraft/fantraxNativePresentation'
import { fantraxCategoryTieWinner, parseFantraxPublicRules } from '@/lib/league-import/fantrax/fantraxPublicRules'
import { normalizeNbaGameStats } from '@/lib/scoring-runtime/dailySportStatNormalization'
import { normalizeMlbGameStats } from '@/lib/scoring-runtime/mlbStatNormalization'
import { playoffFinalWeek } from '@/lib/playoff-runtime/playoffFit'
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
      expect(playoffFinalWeek({ teams, playoffStartWeek: start, weeksPerRound: 1 })).toBe(last)
    })
  it('imports the keeper type, ordered tiebreakers, reseeding and division winner policy from the rules page', () => {
    const rules=parseFantraxPublicRules(`<title>League Rules Summary - Test - Fantrax</title>
      <ul><li><span>Reseed each playoff round:</span> Yes</li><li>Playoff Seeding:: Division winners get top seeds</li>
      <li>Keeper league Type: Dynasty</li></ul><table><tr><th>Standings Tie Breakers</th></tr>
      <tr><td><p>1. Most wins in entire season</p></td></tr><tr><td>2. Randomly selected</td></tr>
      <tr><th>Playoff Tie Breakers</th></tr><tr><td>1. Best Bench players</td></tr></table>`)
    expect(rules).toMatchObject({keeperType:'dynasty',divisionWinners:'top_seeds',reseed:true,standingsOrder:['wins','coin_flip'],playoffTies:['Best Bench players']})
    const input=source('MLB',12,23,26)
    input.settings!.raw.publicRules=rules
    expect(FantraxLeagueMapper.map(input)).toMatchObject({isDynasty:true,league_type:'dynasty',tiebreaker_order:['wins','coin_flip'],
      playoff_structure:{playoff_team_count:12,first_round_byes:4,total_rounds:4,reseed_behavior:'reseed_after_each_round'}})
    expect(parseFantraxPublicRules('<title>Login</title><ul><li>Reseed each playoff round: Yes</li></ul>')).toBeNull()
  })
  it('settles a tied category matchup in the published order only when the preceding categories are known', () => {
    const order=['Points','Field Goals Made','Steals'].map(name=>'Ahead in specific scoring category - '+name)
    const outcomes=[{name:'Points',winnerTeamId:null},{name:'Field Goals Made',winnerTeamId:'home'},{name:'Steals',winnerTeamId:'away'}]
    expect(fantraxCategoryTieWinner(order,outcomes)).toBe('home')
    expect(fantraxCategoryTieWinner(order,outcomes.slice(1))).toBeNull()
  })
  it('scores the NBA shooting penalties from each game and leaves missing attempts unknown', () => {
    const row=normalizeNbaGameStats({stats:{two_points_made:5,two_points_attempted:8,three_points_made:3,
      three_points_attempted:7,free_throws_made:2,free_throws_attempted:4,fouls:2,points:21,rebounds:12,assists:10,steals:10}}).stats
    expect(row).toMatchObject({twos:5,two_missed:3,three_missed:4,ft_missed:2,personal_fouls:2,quad_dbl:1})
    expect(normalizeNbaGameStats({stats:{three_points_made:3}}).stats.three_missed).toBeUndefined()
  })
  it.each(['dynasty', 'keeper'] as const)('submits a 34-team %s IDP import with its retention rules', async type => {
    const state = createStateFromImportedLeague({ name: 'Football', sport: 'NFL', leagueType: type,
      leagueVariant: 'IDP', leagueSize: 34, scoringPresetId: null, draftType: 'snake' })
    expect(getEffectiveLeagueType(state)).toBe(type)
    let body: Record<string, unknown> = {}
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      body = JSON.parse(String(init?.body))
      return Response.json({ success: true, leagueId: 'native' })
    })
    try {
      await submitCreateLeagueV2(state, 'imported', false)
      expect(body.teamCount).toBe(34)
      expect(normalizeConceptToFormat(String(body.concept))).toEqual({ formatId: type, aliasTags: ['idp'] })
    } finally { fetch.mockRestore() }
  })
  it('requires two independent player IDs with a unique athlete in both directions', () => {
    const radar='abc12345-1234-4123-8123-000011112222'
    const player = {player_id:'native', sportradar_id:radar, rotowire_id:41} as SleeperPlayer
    const ref = {fantraxId:'provider',name:'Player, One',team:'BUF',position:'WR',sportRadarId:radar.toUpperCase(),rotowireId:'41'}
    expect(matchSharedFantraxPlayers([ref],[player])).toEqual([{fantraxId:'provider',player}])
    expect(matchSharedFantraxPlayers([{...ref,rotowireId:'42'}],[player])).toEqual([])
    expect(matchSharedFantraxPlayers([ref],[player,{...player,player_id:'second',rotowire_id:42}])).toEqual([])
    expect(matchSharedFantraxPlayers([ref,{...ref,fantraxId:'duplicate'}],[player])).toEqual([])
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
    ]}})
    expect(rules).toEqual({ rules: [{stat_key:'kr_yd',points_value:0.05},{stat_key:'pr_yd',points_value:0.1}],gaps:[] })
  })
  it('keeps the occupied NFL flex slot when an eligible athlete plays several positions', () => {
    expect(['RWT','SFX','ID','DE'].map(code=>fantraxStarterSlot('NFL',code))).toEqual(['FLEX','SUPER_FLEX','IDP_FLEX','DE'])
    expect(fantraxStarterSlot('NFL','UNKNOWN')).toBeUndefined()
  })
  it('uses the official records when source scoreboards tie and the standings award a winner', () => {
    const teams = [{ id: 'a' }, { id: 'b' }]
    const schedule = [{ status:'final', type:'regular', week:1, homeRosterId:'a', awayRosterId:'b', homeScore:6.5, awayScore:6.5 }]
    const table = projectFantraxStandings(teams, schedule as never, [
      { rosterId:'a', rank:2, wins:0, losses:1, ties:0, pointsFor:null },
      { rosterId:'b', rank:1, wins:1, losses:0, ties:0, pointsFor:null },
    ])
    expect(table[0]).toMatchObject({id:'b', currentRank:1, wins:1, ties:0, pointsFor:null})
  })
  it('maps sport-specific weights onto stat keys produced by the game feed', () => {
    const info=(group:string,codes:string[]) => ({scoringSystem:{ scoringCategorySettings:[{group:{code:group},
      configs:codes.map(code=>({scoringCategory:{code},points:1}))}]}})
    const basket=info('BASKETBALL_PLAYER',['INDIVIDUAL_FREE_THROWS_MADE','INDIVIDUAL_DOUBLE_DOUBLES_PLUS_TRIPLE_DOUBLES','INDIVIDUAL_TRIPLE_DOUBLES'])
    const nba=normalizeNbaGameStats({stats:{points:15,rebounds:12,assists:11,free_throws_made:4}}).stats
    expect(fantraxScoringRules(basket,'nba').rules.map(r=>nba[r.stat_key])).toEqual([4,1,1])
    expect(fantraxScoringRules(basket,'ncaab').gaps).toHaveLength(3)
    const batting=normalizeMlbGameStats({group:'batting',stats:{IBB:1,SO:2}}).stats
    expect(fantraxScoringRules(info('BASEBALL_HITTING',['INDIVIDUAL_INTENTIONAL_WALKS','INDIVIDUAL_STRIKE_OUTS'])).rules.map(r=>batting[r.stat_key])).toEqual([1,2])
    const pitching=normalizeMlbGameStats({group:'pitching',stats:{BS:1}}).stats
    expect(fantraxScoringRules(info('BASEBALL_PITCHING',['INDIVIDUAL_BLOWN_SAVES'])).rules.map(r=>pitching[r.stat_key])).toEqual([1])
  })
})
