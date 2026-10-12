import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks=vi.hoisted(()=>({session:vi.fn(),limit:vi.fn(),catalog:vi.fn(),enabled:vi.fn(),one:vi.fn(),many:vi.fn(),teams:vi.fn(),roster:vi.fn(),ids:vi.fn(),crosswalk:vi.fn(),lookup:vi.fn()}))
vi.mock('next-auth',()=>({getServerSession:mocks.session}))
vi.mock('@/lib/auth',()=>({authOptions:{}}))
vi.mock('@/lib/prisma',()=>({prisma:{sportsPlayer:{findFirst:mocks.one,findMany:mocks.many},leagueTeam:{findMany:mocks.teams}}}))
vi.mock('@/lib/rate-limit',()=>({consumeRateLimit:mocks.limit,getClientIp:()=> 'local'}))
vi.mock('@/lib/highlights/x-catalog',()=>({readXCatalog:mocks.catalog}))
vi.mock('@/lib/highlights/x-provider',()=>({xHighlightsEnabled:mocks.enabled}))
vi.mock('@/lib/core-app/myRoster',()=>({findMyRoster:mocks.roster,rosterPlayerIds:mocks.ids}))
vi.mock('@/lib/core-app/rosterIdCrosswalk',()=>({crosswalkToSleeperIds:mocks.crosswalk,sleeperLookupId:mocks.lookup}))
import { POST } from '@/app/api/core/highlights/clips/route'
const request=(body:unknown)=>new Request('https://allfantasy.ai/api/core/highlights/clips',{method:'POST',body:JSON.stringify(body)})
beforeEach(()=>{
 vi.clearAllMocks();mocks.session.mockResolvedValue({user:{id:'me'}});mocks.limit.mockReturnValue({success:true});mocks.enabled.mockReturnValue(true)
 mocks.catalog.mockResolvedValue({posts:[{id:'2109403783620857925',account:'NFL',text:'Josh Allen touchdown',kind:'play',publishedAt:new Date(Date.now()-1000).toISOString()}],checkedAt:new Date().toISOString()})
 mocks.one.mockResolvedValue({sleeperId:'1',externalId:'x1',name:'Josh Allen'})
 mocks.many.mockResolvedValue([{sleeperId:'1',name:'Josh Allen'}]);mocks.teams.mockResolvedValue([])
 mocks.roster.mockResolvedValue({found:true,playerData:{players:['espn-id']}});mocks.ids.mockReturnValue(['espn-id']);mocks.crosswalk.mockResolvedValue(new Map([['espn-id','1']]));mocks.lookup.mockReturnValue('1')
})
describe('X clips API',()=>{
 it('requires authentication before reading the catalog',async()=>{mocks.session.mockResolvedValue(null);expect((await POST(request({kind:'roster',playerIds:['1']}))).status).toBe(401);expect(mocks.catalog).not.toHaveBeenCalled()})
 it('rejects arbitrary names, excessive IDs, and missing identities',async()=>{
  for(const body of [{kind:'roster',playerIds:Array(61).fill('1')},{kind:'player',sport:'NFL',name:'Josh Allen'},{kind:'player',sport:'NFL'},{kind:'leagues',leagueIds:Array(6).fill('a')}])expect((await POST(request(body))).status).toBe(400)
  expect(mocks.catalog).not.toHaveBeenCalled()
 })
 it('reads canonical names and returns a private response without invoking any X search',async()=>{
  const response=await POST(request({kind:'player',sport:'NFL',sleeperId:'1'}))
  expect(response.status).toBe(200);expect(response.headers.get('Cache-Control')).toBe('private, no-store')
  expect((await response.json()).clips[0].players).toEqual([{id:'1',name:'Josh Allen'}])
  expect(mocks.many.mock.calls[0][0].where).toEqual({sport:{equals:'NFL',mode:'insensitive'},sleeperId:'1'})
 })
 it('names a Sleeper id by its Sleeper row, not a newer TheSportsDB namesake row',async()=>{
  // Production 2026-10-11: TheSportsDB's Elgton Jenkins (G, CLE) carries TE E.J. Jenkins's Sleeper id 11304.
  const rows=[
   {sleeperId:'11304',name:'Elgton Jenkins',position:'G',source:'thesportsdb',externalId:'tsdb_1',fetchedAt:new Date('2026-10-11T08:42:36Z')},
   {sleeperId:'11304',name:'E.J. Jenkins',position:'TE',source:'sleeper',externalId:'sleeper_11304',fetchedAt:new Date('2026-10-10T00:00:00Z')},
  ]
  mocks.many.mockResolvedValue(rows)
  mocks.catalog.mockResolvedValue({posts:[{id:'2109403783620857926',account:'NFL',text:'E.J. Jenkins touchdown',kind:'play',publishedAt:new Date(Date.now()-1000).toISOString()},{id:'2109403783620857927',account:'NFL',text:'Elgton Jenkins pancake block',kind:'play',publishedAt:new Date(Date.now()-1000).toISOString()}],checkedAt:new Date().toISOString()})
  for(const body of [{kind:'player',sport:'NFL',sleeperId:'11304'},{kind:'roster',playerIds:['11304']}]){
   const clips=(await (await POST(request(body))).json()).clips
   expect(clips.map((c:{id:string})=>c.id)).toEqual(['2109403783620857926'])
   expect(clips[0].players).toEqual([{id:'11304',name:'E.J. Jenkins'}])
  }
 })
 it('authorizes league IDs by the caller claimed team before reading rosters',async()=>{
  await POST(request({kind:'leagues',leagueIds:['someone-else']}))
  expect(mocks.teams.mock.calls[0][0].where).toEqual({leagueId:{in:['someone-else']},claimedByUserId:'me'})
  expect(mocks.roster).not.toHaveBeenCalled()
 })
 it('uses the provider crosswalk for owned league spotlights',async()=>{
  mocks.teams.mockResolvedValue([{league:{id:'mine',name:'My League',sport:'NFL',platform:'espn'}}])
  const response=await POST(request({kind:'leagues',leagueIds:['mine']}))
  expect(mocks.crosswalk).toHaveBeenCalledWith('espn','NFL',['espn-id'])
  expect(mocks.many.mock.calls[0][0].where.sleeperId.in).toEqual(['1'])
  expect((await response.json()).clips[0].leagues).toEqual([{id:'mine',name:'My League'}])
 })
 it('throttles and stays disabled without configured ingestion',async()=>{
  mocks.limit.mockReturnValueOnce({success:false,retryAfterSec:60});expect((await POST(request({kind:'roster',playerIds:['1']}))).status).toBe(429)
  mocks.enabled.mockReturnValue(false);expect((await (await POST(request({kind:'roster',playerIds:['1']}))).json()).status).toBe('disabled')
  expect(mocks.catalog).not.toHaveBeenCalled()
 })
})

