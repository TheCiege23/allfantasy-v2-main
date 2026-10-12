import { beforeEach, describe, expect, it, vi } from 'vitest'
const m=vi.hoisted(()=>({session:vi.fn(),access:vi.fn(),league:vi.fn(),teams:vi.fn(),standing:vi.fn(),weeks:vi.fn(),roster:vi.fn(),labels:vi.fn()}))
vi.mock('next-auth',()=>({getServerSession:m.session}))
vi.mock('@/lib/auth',()=>({authOptions:{}}))
vi.mock('@/lib/league-access',()=>({resolveLeagueAccess:m.access}))
vi.mock('@/lib/scoring-engine/resolveTeamLabels',()=>({buildRosterLabelMap:m.labels}))
vi.mock('@/lib/prisma',()=>({prisma:{league:{findFirst:m.league},leagueTeam:{findMany:m.teams},fantasyStanding:{findMany:m.standing},teamWeekResult:{findMany:m.weeks},roster:{findFirst:m.roster}}}))
import { GET } from '@/app/api/leagues/[leagueId]/scoring/standings/route'
const request=(season?:string)=>GET({nextUrl:new URL(`https://allfantasy.ai/api/leagues/l/scoring/standings${season?'?season='+season:''}`)} as never,{params:Promise.resolve({leagueId:'l'})})
beforeEach(()=>{vi.resetAllMocks();m.session.mockResolvedValue({user:{id:'u'}});m.access.mockResolvedValue({isMember:true});m.league.mockResolvedValue({id:'l',platform:'fantrax',season:2026,settings:{}});m.teams.mockResolvedValue([{id:'team',teamName:'Actual team',claimedByUserId:'u',wins:2,losses:1,ties:0,pointsFor:205.75,pointsAgainst:200,currentRank:3}])})
describe('real standings sources',()=>{
  it('requires authentication and canonical membership before scores',async()=>{
    m.session.mockResolvedValue(null);expect((await request()).status).toBe(401);expect(m.teams).not.toHaveBeenCalled()
    m.session.mockResolvedValue({user:{id:'u'}});m.access.mockResolvedValue(null);expect((await request()).status).toBe(403);expect(m.teams).not.toHaveBeenCalled()
  })
  it('uses imported published records and claim identity, ignoring synthetic native aggregates',async()=>{
    const response=await request(),data=await response.json()
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(data.source).toBe('imported');expect(data.viewerRosterId).toBe('team')
    expect(data.standings[0]).toMatchObject({rank:3,wins:2,pointsFor:205.75,categoryWinsFor:null,allPlay:null})
    expect(m.standing).not.toHaveBeenCalled();expect(m.weeks).not.toHaveBeenCalled()
  })
  it('excludes archived franchises while retaining current and unclassified teams', async () => {
    // Model the database predicate, so the legacy duplicate would leak if the filter is removed.
    const teams = [
      { id: 'archived', teamName: 'Ciege82', lifecycleState: 'ARCHIVED', claimedByUserId: 'u', wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0 },
      { id: 'current', teamName: 'Ciege82', lifecycleState: 'CURRENT', claimedByUserId: 'u', wins: 2, losses: 4, ties: 0, pointsFor: 1005.84, pointsAgainst: 0 },
      { id: 'unclassified', teamName: 'Open team', lifecycleState: 'UNKNOWN', wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 0 },
    ]
    m.teams.mockImplementation(async ({ where }) => teams.filter(t => t.lifecycleState !== where.lifecycleState?.not))
    const data = await (await request()).json()
    expect(m.teams).toHaveBeenCalledWith(expect.objectContaining({ where: { leagueId: 'l', lifecycleState: { not: 'ARCHIVED' } } }))
    expect(data.standings.map((t: { rosterId: string }) => t.rosterId)).toEqual(['current', 'unclassified'])
    expect(data.viewerRosterId).toBe('current')
  })
  it('leaves unreported Fantrax points-against unknown', async () => {
    expect((await (await request()).json()).standings[0].pointsAgainst).toBeNull()
    m.teams.mockResolvedValue([{ id: 't', wins: 0, losses: 0, ties: 0, pointsFor: 0, pointsAgainst: 200, currentRank: 1 }])
    expect((await (await request()).json()).standings).toEqual([])
  })
  it.each([0, 200])('preserves a reported imported points-against value of %s', async (pointsAgainst) => {
    m.league.mockResolvedValue({ id: 'l', platform: 'sleeper', season: 2026, settings: {} })
    m.teams.mockResolvedValue([{ id: 't', wins: 2, losses: 1, ties: 0, pointsFor: 205.75, pointsAgainst }])
    expect((await (await request()).json()).standings[0].pointsAgainst).toBe(pointsAgainst)
  })
  it('does not reuse current imported records for an unimported historical season',async()=>{
    expect((await (await request('2025')).json()).standings).toEqual([])
  })
  it('does not invent rankings or games for an unplayed imported league',async()=>{
    m.teams.mockResolvedValue([{id:'t',wins:0,losses:0,ties:0,pointsFor:0,pointsAgainst:0,currentRank:1}])
    expect((await (await request()).json()).standings).toEqual([])
  })
  it('reads only finalized native weeks and suppresses unscored placeholder teams',async()=>{
    m.league.mockResolvedValue({id:'l',platform:'allfantasy',season:2026,settings:{scoring_mode:'h2h_category'},bestBallMode:false})
    m.standing.mockResolvedValue([{rosterId:'r',wins:1,losses:0,ties:0,pointsFor:-2,pointsAgainst:0,rank:1,categoryWinsFor:5},{rosterId:'unscored',rank:2}])
    m.weeks.mockResolvedValue([{week:1,rosterId:'r',totalPoints:-2,winLoss:'W'}]);m.labels.mockResolvedValue(new Map([['r','Actual native team']]));m.roster.mockResolvedValue({id:'r'})
    const data=await (await request()).json()
    expect(m.weeks).toHaveBeenCalledWith(expect.objectContaining({where:{leagueId:'l',season:2026,status:'final'}}))
    expect(data.source).toBe('native');expect(data.scoredWeeks).toBe(1);expect(data.standings).toHaveLength(1);expect(data.standings[0]).toMatchObject({teamName:'Actual native team',pointsFor:-2,categoryWinsFor:5})
  })
})
