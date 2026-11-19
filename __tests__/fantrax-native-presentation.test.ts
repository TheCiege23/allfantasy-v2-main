// @vitest-environment node
import {beforeEach,describe,expect,it,vi} from 'vitest'
const tx=vi.hoisted(()=>({league:{findUnique:vi.fn()},fantraxLeague:{findUnique:vi.fn()},redraftSeason:{findMany:vi.fn(),updateMany:vi.fn()},$executeRaw:vi.fn()}))
vi.mock('@/lib/prisma',()=>({prisma:{$transaction:(f:any)=>f(tx)}}))
import {syncFantraxNativePresentation,projectFantraxHistory,projectFantraxStandings} from '@/lib/redraft/fantraxNativePresentation'
const info:any={seasonYear:2026,teamInfo:{a:{id:'a',name:'Alpha'},b:{id:'b',name:'Beta'}},scoringPeriods:[{number:4,startDate:'2026-09-22',endDate:'2026-09-29'},{number:5,startDate:'2026-09-29',endDate:'2026-10-06'}]}
beforeEach(()=>{vi.clearAllMocks();tx.league.findUnique.mockResolvedValue({platform:'fantrax',platformLeagueId:'snapshot',userId:'owner',sport:'NCAAF',season:2026,settings:{}});tx.fantraxLeague.findUnique.mockResolvedValue({appUserId:'owner'});tx.redraftSeason.findMany.mockResolvedValue([{rosters:[{id:'ra',teamName:'Alpha'},{id:'rb',teamName:'Beta'}]}]);tx.redraftSeason.updateMany.mockResolvedValue({count:1})})
describe('source presentation authorization and scope',()=>{
 it('refuses an ownership mismatch before metadata writes',async()=>{tx.fantraxLeague.findUnique.mockResolvedValue({appUserId:'other'});await expect(syncFantraxNativePresentation('league',info,[],new Date('2026-10-01'))).rejects.toThrow(/ownership/);expect(tx.$executeRaw).toHaveBeenCalledTimes(1);expect(tx.redraftSeason.updateMany).not.toHaveBeenCalled()})
 it('updates calendar metadata only and honors stable mapping after renames',async()=>{tx.league.findUnique.mockResolvedValue({platform:'fantrax',platformLeagueId:'snapshot',userId:'owner',sport:'NCAAF',season:2026,settings:{fantrax_native_team_ids:{a:'ra',b:'rb'}}});tx.redraftSeason.findMany.mockResolvedValue([{rosters:[{id:'ra',teamName:'Renamed'},{id:'rb',teamName:'Beta'}]}]);expect(await syncFantraxNativePresentation('league',info,[],new Date('2026-10-01'))).toMatchObject({currentWeek:5,changed:true});expect(tx.redraftSeason.updateMany.mock.calls[0]![0].data).toEqual({currentWeek:5});expect(tx.$executeRaw.mock.calls[1]![0].join('')).not.toContain('fantasyPoints')})
 it('advances a Fantrax Soccer season using the split-year calendar', async () => {
   tx.league.findUnique.mockResolvedValue({ platform: 'fantrax', platformLeagueId: 'snapshot', userId: 'owner', sport: 'SOCCER', season: 2026, settings: {} })
   const soccerInfo = { ...info, seasonYear: 2027, startDate: '2026-08-15' }
   const result = await syncFantraxNativePresentation('league', soccerInfo, [], new Date('2026-10-01'))
   expect(result).toMatchObject({ currentWeek: 5, changed: true })
   expect(tx.redraftSeason.updateMany.mock.calls[0]![0].data).toEqual({ currentWeek: 5, status: 'in_season' })
 })
 it('rejects ambiguous roster ownership instead of picking a matching name',async()=>{tx.redraftSeason.findMany.mockResolvedValue([{rosters:[{id:'ra',teamName:'Alpha'},{id:'rx',teamName:'Alpha'},{id:'rb',teamName:'Beta'}]}]);await expect(syncFantraxNativePresentation('league',info,[])).rejects.toThrow(/ambiguous/);expect(tx.redraftSeason.updateMany).not.toHaveBeenCalled()})
 it('projects records from completed regular results, excluding live and playoffs',()=>{const rosters=[{id:'ra'},{id:'rb'}];const r=projectFantraxHistory({seasonId:'season',leagueId:'league',info,teamIds:{a:'ra',b:'rb'},rosters,now:new Date('2026-10-01'),rows:[{week:4,homeTeam:'Alpha',awayTeam:'Beta',homeTeamId:'a',awayTeamId:'b',homeScore:10,awayScore:8,played:true,isPlayoff:false},{week:5,homeTeam:'Alpha',awayTeam:'Beta',homeTeamId:'a',awayTeamId:'b',homeScore:0,awayScore:1,played:true,isPlayoff:false}]});expect(projectFantraxStandings(rosters,r.matchups)).toMatchObject([{id:'ra',wins:1,losses:0,pointsFor:10},{id:'rb',wins:0,losses:1,pointsFor:8}])})
})

describe('Points For in a league that plays several games a period', () => {
  it('counts a team\'s period score once, and averages the period\'s opponents for Points Against', () => {
    const rosters = [{ id: 'ra' }, { id: 'rb' }, { id: 'rc' }]
    const game = (week: number, homeRosterId: string, homeScore: number, awayRosterId: string, awayScore: number) =>
      ({ week, type: 'regular', status: 'final', homeRosterId, awayRosterId, homeScore, awayScore })
    // Period 1: every team plays the other two with the same period score (a 120, b 100, c 90).
    const matchups = [game(1, 'ra', 120, 'rb', 100), game(1, 'ra', 120, 'rc', 90), game(1, 'rb', 100, 'rc', 90)] as any
    const table = projectFantraxStandings(rosters, matchups)
    const of = (id: string) => table.find((row: any) => row.id === id)!
    // Points Against is the average of the period's opponents: a faced 100 and 90, and so on.
    expect(of('ra')).toMatchObject({ wins: 2, losses: 0, pointsFor: 120, pointsAgainst: 95 })
    expect(of('rb')).toMatchObject({ wins: 1, losses: 1, pointsFor: 100, pointsAgainst: 105 })
    expect(of('rc')).toMatchObject({ wins: 0, losses: 2, pointsFor: 90, pointsAgainst: 110 })
  })
})
