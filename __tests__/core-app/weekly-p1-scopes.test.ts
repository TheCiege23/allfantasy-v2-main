// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
const h = vi.hoisted(() => ({ rows: vi.fn(), teams: vi.fn(), facts: vi.fn(), metadata: vi.fn(), seasons: vi.fn(), rosters: vi.fn(), games: vi.fn(), leagues: vi.fn(), cache: vi.fn(), upsert: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: {
  weeklyMatchup: { findMany: h.rows }, leagueTeam: { findMany: h.teams }, matchupFact: { findMany: h.facts }, league: { findMany: h.leagues },
  redraftSeason: { findMany: h.seasons }, redraftRoster: { findMany: h.rosters }, redraftMatchup: { findMany: h.games }, sportsDataCache: { findMany: h.cache, upsert: h.upsert },
} }))
vi.mock('@/lib/core-app/leagueWeekMetadata', () => ({ readLeagueWeekMetadata: h.metadata }))
vi.mock('@/lib/core-app/seasonPhase', () => ({ getFirstStatedKickoff: async () => null }))
import { getWeekBoard, readWeeklyHistory, buildProfiles, winProbabilityOf } from '@/lib/core-app/weekBoard'
import { getSeasonOutlook } from '@/lib/core-app/seasonOutlook'
import { weeklyFormat, weeklyScopeKey, canCertifyWeeklyPlayoffStatus } from '@/lib/core-app/weeklyCapabilities'
const cards = (b: Awaited<ReturnType<typeof getWeekBoard>>) => [...b.coinFlips, ...b.leaning, ...b.unprojected]
beforeEach(() => { vi.resetAllMocks(); for (const fn of Object.values(h)) fn.mockResolvedValue([]) })
describe('weekly format capabilities', () => {
  it.each([['roto','roto'], ['h2h_category','categories'], ['season_points','season-points'], ['h2h_points','head-to-head']])('dispatches %s without inventing an elimination', (mode, expected) => expect(weeklyFormat({ settings: { scoring_mode: mode } })).toBe(expected))
  it('requires stated survival rules, regardless of a league name or missing pairs', () => { expect(weeklyFormat({ leagueType: 'redraft' })).toBe('head-to-head'); expect(weeklyFormat({ leagueType: 'guillotine' })).toBe('elimination') })
  it('qualifies external IDs by provider and native IDs by league', () => {
    expect(weeklyScopeKey({ id:'A', platform:'espn', platformLeagueId:'123' })).not.toBe(weeklyScopeKey({ id:'B', platform:'yahoo', platformLeagueId:'123' }))
    expect(weeklyScopeKey({ id:'A', platform:'native' })).toBe('native:A')
  })
  it('withholds exact qualification claims for default fields, divisions and median rules', () => {
    expect(canCertifyWeeklyPlayoffStatus({}, 'default')).toBe(false)
    expect(canCertifyWeeklyPlayoffStatus({ division_count: 2 }, 'league')).toBe(false)
    expect(canCertifyWeeklyPlayoffStatus({ league_average_match: 1 }, 'league')).toBe(false)
    expect(canCertifyWeeklyPlayoffStatus({}, 'league')).toBe(true)
  })
})
describe('canonical and native weekly coverage', () => {
  it('never assigns ambiguous legacy weekly rows to two providers; uses canonical facts separately', async () => {
    const leagues = [{ id:'A', name:'ESPN', platform:'espn', platformLeagueId:'123' }, { id:'B', name:'Yahoo', platform:'yahoo', platformLeagueId:'123' }]
    h.rows.mockResolvedValue([{ leagueId:'123', seasonYear:2026, week:4, rosterId:'1', matchupId:1, pointsFor:999, pointsAgainst:1, win:1 }, { leagueId:'123', seasonYear:2026, week:4, rosterId:'2', matchupId:1, pointsFor:1, pointsAgainst:999, win:0 }])
    h.teams.mockImplementation(async a => leagues.flatMap(l => (a.where.claimedByUserId ? ['1'] : ['1','2']).map(externalId => ({ externalId, teamName:`${l.name} ${externalId}`, league:l }))))
    h.metadata.mockResolvedValue(leagues.map(l => ({ ...l, season:2026, sport:'NFL', status:'complete', settings:{ leg:'4' } })))
    h.facts.mockResolvedValue(leagues.map((l,i) => ({ leagueId:l.id, season:2026, weekOrPeriod:4, teamA:'1', teamB:'2', scoreA:100+i*20, scoreB:90 })))
    const board = await getWeekBoard('u', leagues)
    expect(cards(board).map(c => [c.leagueId,c.live?.you,c.opponent.name])).toEqual([['A',100,'ESPN 2'],['B',120,'Yahoo 2']])
    expect(board.historyIncomplete).toBe(true)
    expect(h.teams.mock.calls[0][0].where.leagueId.in).toEqual(['A','B'])
    const focused=await readWeeklyHistory('u',[leagues[0]],leagues)
    expect(focused?.rows.find(r=>r.rosterId==='1')?.pointsFor).toBe(100)
    expect(focused?.historyIncomplete).toBe(true)
  })
  it('reads an AF native league with no external IDs, including zero-point final ties', async () => {
    const league = { id:'N', name:'Native NBA', platform:'allfantasy', sport:'NBA' }
    h.seasons.mockResolvedValue([{ id:'s', leagueId:'N', season:2026, currentWeek:4 }])
    h.rosters.mockResolvedValue([{ id:'r1', leagueId:'N', ownerId:'u', ownerName:'User', teamName:'My native team', avatarUrl:null, season:{season:2026} }, { id:'r2', leagueId:'N', ownerId:'v', ownerName:'Rival', teamName:'Native rival', avatarUrl:null, season:{season:2026} }])
    h.games.mockResolvedValue([1,2,3,4].map(week => ({ id:`g${week}`, leagueId:'N', week, homeRosterId:'r1', awayRosterId:'r2', homeScore:week===4?0:100, awayScore:week===4?0:90, status:'final', season:{season:2026} })))
    const board = await getWeekBoard('u',[league],'N')
    expect(cards(board)).toHaveLength(1)
    expect(board.leagueBoard).toMatchObject({ yourTeamName:'My native team', yourRosterId:'r1', records:{ r1:{wins:3,losses:0,ties:1} }, rivalry:{wins:3,losses:0,ties:1}, yours:{live:{you:0,them:0,final:true}} })
    expect(board.withoutSchedule).toBe(0)
    h.games.mockResolvedValue([1,2,3,4,5,6].map(week => ({ id:`g${week}`, leagueId:'N', week, homeRosterId:'r1', awayRosterId:'r2', homeScore:week<4?100:0, awayScore:week<4?90:0, status:week<4?'final':'scheduled', season:{season:2026} })))
    h.seasons.mockResolvedValue([{id:'s',leagueId:'N',season:2026,currentWeek:4,playoffStartWeek:7,medianGame:false}])
    h.leagues.mockResolvedValue([{...league,season:2026,settings:{playoff_teams:2}}])
    const outlook=await getSeasonOutlook('u',[league])
    expect(outlook.leagues[0]).toMatchObject({leagueId:'N',season:2026,weeksRemaining:3,you:{rosterId:'r1',wins:3,losses:0,modelled:true}})
    expect(outlook.leagues[0].assumptions.playoffTeams.source).toBe('league')
    expect(outlook.leagues[0].assumptions.regularSeasonEndWeek).toBe(6)
    h.seasons.mockResolvedValue([{id:'s',leagueId:'N',season:2026,currentWeek:4,playoffStartWeek:7,medianGame:true}])
    expect((await getSeasonOutlook('u',[league])).withheld[0].reason).toContain('median games')
    h.seasons.mockResolvedValue([{id:'new-season',leagueId:'N',season:2027,currentWeek:1}])
    h.leagues.mockResolvedValue([{...league,season:2027,settings:{playoff_teams:2,playoff_start_week:7}}])
    const nextSeason=await getSeasonOutlook('u',[league])
    expect(nextSeason.leagues).toHaveLength(0)
    expect(nextSeason.withheld[0].reason).toContain('No current-season schedule is on file for 2027')
  })
  it('shows category goals and withholds the head-to-head points playoff model', async () => {
    const league = { id:'C', name:'Categories', platform:'espn', platformLeagueId:'cat', settings:{scoring_mode:'h2h_category'} }
    h.metadata.mockResolvedValue([{ ...league, season:2026, sport:'MLB', status:'in_season', settings:{leg:'6'} }])
    h.teams.mockResolvedValue([{ externalId:'1', teamName:'Mine', league }])
    h.rows.mockResolvedValue([{ leagueId:'cat',seasonYear:2026,week:6,rosterId:'1',matchupId:null,pointsFor:3,pointsAgainst:0,win:0 }])
    h.leagues.mockResolvedValue([{ ...league, sport:'MLB', season:2026, status:'in_season' }])
    const board = await getWeekBoard('u',[league],'C')
    expect(board.eliminationWeeks).toHaveLength(0)
    expect(board.formatWeeks).toMatchObject([{leagueId:'C',format:'categories'}])
    const outlook = await getSeasonOutlook('u',[league])
    expect(outlook.leagues).toHaveLength(0)
    expect(outlook.withheld[0].reason).toContain('category')
  })
  it('keeps manual canonical history without a platform league ID', async () => {
    const league={id:'M',name:'Manual',platform:'manual'}
    h.metadata.mockResolvedValue([{...league,platformLeagueId:null,season:2026,sport:'SOCCER',status:'complete',settings:{leg:'2'}}])
    h.teams.mockResolvedValue([{externalId:'1',teamName:'Mine',league}])
    h.facts.mockResolvedValue([{leagueId:'M',season:2026,weekOrPeriod:2,teamA:'1',teamB:'2',scoreA:20,scoreB:10}])
    expect(cards(await getWeekBoard('u',[league],'M'))[0]).toMatchObject({leagueId:'M',live:{you:20,them:10}})
  })
  it('fills absent games in a partially imported current season without inflating a scoring sample', async () => {
    const league={id:'A',platform:'espn',platformLeagueId:'pid'}
    h.teams.mockResolvedValue([{externalId:'1',league}])
    h.rows.mockResolvedValue([{leagueId:'pid',seasonYear:2026,week:1,rosterId:'1',matchupId:1,pointsFor:100,pointsAgainst:90,win:1},{leagueId:'pid',seasonYear:2026,week:1,rosterId:'2',matchupId:1,pointsFor:90,pointsAgainst:100,win:0}])
    h.facts.mockResolvedValue([1,2,3].map(week=>({leagueId:'A',season:2026,weekOrPeriod:week,teamA:'1',teamB:'2',scoreA:100,scoreB:90})))
    const board=await getWeekBoard('u',[league])
    expect(cards(board)[0].yourSampleWeeks).toBe(3)
  })
  it('historical probabilities are invariant to a change of scoring units', () => {
    const rows=[1,2,3].flatMap(week=>['a','b'].map(rosterId=>({leagueId:'L',seasonYear:2026,week,rosterId,matchupId:1,pointsFor:rosterId==='a'?10:9,pointsAgainst:rosterId==='a'?9:10,win:rosterId==='a'?1:0})))
    const p=buildProfiles(rows), q=buildProfiles(rows.map(r=>({...r,pointsFor:r.pointsFor*100,pointsAgainst:r.pointsAgainst*100})))
    expect(q.get('L:a')!.sigma/p.get('L:a')!.sigma).toBeCloseTo(100)
    expect(q.get('L:b')!.mu/p.get('L:b')!.mu).toBeCloseTo(100)
    expect(winProbabilityOf(p.get('L:a')!,p.get('L:b')!)).toBeCloseTo(winProbabilityOf(q.get('L:a')!,q.get('L:b')!))
  })
})
